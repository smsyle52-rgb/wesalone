import { apiRestBaseUrl } from '@/api/client';
import { env } from '@/config/env';

import type { RealtimeEventData } from './events';
import { validateRealtimeEvent } from './parse-event';

/**
 * Client for the Wesal One realtime gateway (uWebSockets, served at `<WS_URL>/rt/workspaces/:id`).
 *
 * Protocol, mirrored from the backend's `@chatbotx.io/realtime-protocol`:
 * - Auth: `GET /api/workspaces/{workspaceId}/realtime/connect-token` (bearer) returns a signed
 *   token valid for 60s, so a fresh one is minted for every (re)connect.
 * - Frames: `{ hb: ... }` heartbeats, or `{ batch: Envelope[], seq: "<ms>-<n>" }`.
 * - Resume: reconnecting with `?lastSeq=<seq>` makes the gateway replay missed events.
 * - Close codes: 4001 revoked (stop), 4002 resync (refetch everything), 4003 overloaded
 *   (`reason` JSON may carry `retryAfter` ms), 4004 reauth (reconnect with a new token).
 */

export const CLOSE_CODE = {
  heartbeatTimeout: 4000,
  revoked: 4001,
  resync: 4002,
  overloaded: 4003,
  reauth: 4004,
} as const;

const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 500;
const MIN_UPTIME_BEFORE_RESET_MS = 10_000;
const SEQ_PATTERN = /^\d+-\d+$/;

/** Thrown when retrying can never succeed (the token mint was refused with 401/403). */
export class RealtimeFatalError extends Error {}

export async function mintConnectToken(workspaceId: string, bearerToken: string): Promise<string> {
  const response = await fetch(
    `${apiRestBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/realtime/connect-token`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (response.status === 401 || response.status === 403) {
    throw new RealtimeFatalError(`Realtime token refused (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Realtime token request failed (${response.status})`);
  }
  const body = (await response.json()) as { token?: unknown } | null;
  if (typeof body?.token !== 'string') {
    throw new Error('Realtime token response missing "token".');
  }
  return body.token;
}

export function buildSocketUrl(workspaceId: string, token: string, lastSeq: string | null) {
  const base = env.wsUrl.endsWith('/') ? env.wsUrl : `${env.wsUrl}/`;
  const url = new URL(`rt/workspaces/${encodeURIComponent(workspaceId)}`, base);
  url.protocol =
    url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
  url.searchParams.set('token', token);
  if (lastSeq) {
    url.searchParams.set('lastSeq', lastSeq);
  }
  return url.toString();
}

/** True when stream id `candidate` is strictly newer than `previous` (Redis stream id order). */
export function isSeqAfter(candidate: string, previous: string): boolean {
  if (!(SEQ_PATTERN.test(candidate) && SEQ_PATTERN.test(previous))) return false;
  const [cm, cs] = candidate.split('-').map(BigInt);
  const [pm, ps] = previous.split('-').map(BigInt);
  return cm > pm || (cm === pm && cs > ps);
}

/**
 * Parses one wire frame into validated events. Returns `null` for heartbeats, malformed frames,
 * and stale/duplicate batches (seq not after `lastSeq`). Unknown event types inside a valid batch
 * (e.g. call events the app has no UI for) are skipped, not treated as errors.
 */
export function readFrame(
  raw: string,
  lastSeq: string | null,
): { events: RealtimeEventData[]; seq: string } | 'invalid' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'invalid';
  if ('hb' in parsed) return null;
  const { batch, seq } = parsed as { batch?: unknown; seq?: unknown };
  if (!Array.isArray(batch) || typeof seq !== 'string' || !SEQ_PATTERN.test(seq)) {
    return 'invalid';
  }
  if (lastSeq && !isSeqAfter(seq, lastSeq)) return null;
  const events: RealtimeEventData[] = [];
  for (const envelope of batch) {
    const event = validateRealtimeEvent(envelope);
    if (event) events.push(event);
  }
  return { events, seq };
}

function retryAfterMs(reason: string): number | null {
  try {
    const parsed = JSON.parse(reason) as { retryAfter?: unknown };
    return typeof parsed.retryAfter === 'number' && parsed.retryAfter >= 0
      ? parsed.retryAfter
      : null;
  } catch {
    return null;
  }
}

type Timer = ReturnType<typeof setTimeout>;

export type WesalSocketOptions = {
  workspaceId: string;
  getBearerToken: () => Promise<string | null>;
  onEvents: (events: RealtimeEventData[]) => void;
  onOpen?: (isReconnect: boolean) => void;
  onClose?: () => void;
  /** Retrying can never succeed on its own (token refused or the session was revoked). */
  onFailed?: (reason: 'revoked' | 'auth') => void;
  /** Server asked for a full refetch (close 4002) or sent a frame we could not read. */
  onResync?: () => void;
};

/** Native-WebSocket transport with jittered exponential reconnect and replay from `lastSeq`. */
export class WesalSocket {
  private socket: WebSocket | null = null;
  private connecting = false;
  private closed = false;
  private failed = false;
  private attempt = 0;
  private hasOpened = false;
  private lastSeq: string | null = null;
  private retryNotBefore: number | null = null;
  private heartbeatTimer: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private uptimeTimer: Timer | null = null;

  constructor(private readonly options: WesalSocketOptions) {}

  connect = (): void => {
    if (this.closed || this.failed || this.connecting || this.socket || this.reconnectTimer) return;
    this.connecting = true;
    this.openSocket()
      .catch((error: unknown) => {
        if (__DEV__) console.warn('[realtime] connect failed', error);
        if (error instanceof RealtimeFatalError) {
          this.fail('auth');
          return;
        }
        this.scheduleReconnect(0, '');
      })
      .finally(() => {
        this.connecting = false;
      });
  };

  /** Closes for good (unmount / sign-out). */
  close = (): void => {
    this.closed = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  };

  /** Drops the socket while the app is backgrounded; `resume` reconnects with replay. */
  suspend = (): void => {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  };

  resume = (): void => {
    if (this.closed || this.failed) return;
    if (this.retryNotBefore !== null && Date.now() < this.retryNotBefore) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  };

  /** Starts over after a terminal failure (the user tapped "retry"). */
  retry = (): void => {
    if (this.closed) return;
    this.failed = false;
    this.attempt = 0;
    this.retryNotBefore = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  };

  private fail(reason: 'revoked' | 'auth'): void {
    this.failed = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.options.onFailed?.(reason);
  }

  private async openSocket(): Promise<void> {
    const bearer = await this.options.getBearerToken();
    if (!bearer) throw new RealtimeFatalError('Not signed in');
    const token = await mintConnectToken(this.options.workspaceId, bearer);
    if (this.closed || this.socket) return;

    const socket = new WebSocket(buildSocketUrl(this.options.workspaceId, token, this.lastSeq));
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.armUptimeReset();
      this.armHeartbeat(socket);
      const isReconnect = this.hasOpened;
      this.hasOpened = true;
      this.options.onOpen?.(isReconnect);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.armHeartbeat(socket);
      if (typeof event.data !== 'string') return;
      const frame = readFrame(event.data, this.lastSeq);
      if (frame === 'invalid') {
        this.options.onResync?.();
        return;
      }
      if (!frame) return;
      this.attempt = 0;
      this.lastSeq = frame.seq;
      if (frame.events.length > 0) this.options.onEvents(frame.events);
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearHeartbeat();
      this.clearUptime();
      this.options.onClose?.();
      this.scheduleReconnect(event.code, event.reason ?? '');
    };
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (this.closed) return;
    if (code === CLOSE_CODE.revoked) {
      this.fail('revoked');
      return;
    }
    if (code === CLOSE_CODE.resync) {
      // Replay cannot cover the gap: start fresh and refetch everything.
      this.lastSeq = null;
      this.options.onResync?.();
    }
    const serverDelay = code === CLOSE_CODE.overloaded ? retryAfterMs(reason) : null;
    const ceiling = Math.min(MAX_RECONNECT_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** this.attempt);
    this.attempt += 1;
    const delay = serverDelay ?? Math.floor(Math.random() * ceiling);
    this.retryNotBefore = serverDelay === null ? null : Date.now() + delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private armHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      if (this.socket === socket) socket.close(CLOSE_CODE.heartbeatTimeout, 'heartbeat-timeout');
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private armUptimeReset(): void {
    this.clearUptime();
    this.uptimeTimer = setTimeout(() => {
      this.uptimeTimer = null;
      this.attempt = 0;
      this.retryNotBefore = null;
    }, MIN_UPTIME_BEFORE_RESET_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearUptime(): void {
    if (this.uptimeTimer) clearTimeout(this.uptimeTimer);
    this.uptimeTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    this.clearUptime();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
