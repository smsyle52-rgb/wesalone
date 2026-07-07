/**
 * realtime-pubsub.spec.ts — W4-T2 Postgres LISTEN/NOTIFY cross-instance fan-out
 *
 * Flag-gated (REALTIME_PUBSUB), off by default. These tests cover the
 * publish-side guard logic; the LISTEN connection lifecycle itself needs a
 * real Postgres connection and is exercised operationally, not here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@workspace/db", () => ({
  pool: { query: queryMock, connect: vi.fn() },
}));

describe("W4-T2: publishRealtimeNotify", () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it("is a no-op when REALTIME_PUBSUB is not set (default off)", async () => {
    vi.resetModules();
    delete process.env.REALTIME_PUBSUB;
    const { publishRealtimeNotify } = await import("../lib/realtime");

    await publishRealtimeNotify("ws-1", { type: "message.received" });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it("calls pg_notify when REALTIME_PUBSUB=true and the payload is small", async () => {
    vi.resetModules();
    process.env.REALTIME_PUBSUB = "true";
    const { publishRealtimeNotify } = await import("../lib/realtime");

    await publishRealtimeNotify("ws-1", { type: "message.received" });

    expect(queryMock).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", expect.arrayContaining(["workspace_events"]));
    delete process.env.REALTIME_PUBSUB;
  });

  it("skips NOTIFY (does not throw) when the payload exceeds Postgres's 8000-byte limit", async () => {
    vi.resetModules();
    process.env.REALTIME_PUBSUB = "true";
    const { publishRealtimeNotify } = await import("../lib/realtime");

    const hugePayload = { text: "x".repeat(9000) };
    await expect(publishRealtimeNotify("ws-1", hugePayload)).resolves.toBeUndefined();

    expect(queryMock).not.toHaveBeenCalled();
    delete process.env.REALTIME_PUBSUB;
  });

  it("never throws even if pg_notify itself fails (local delivery must be unaffected)", async () => {
    vi.resetModules();
    process.env.REALTIME_PUBSUB = "true";
    queryMock.mockRejectedValueOnce(new Error("connection reset"));
    const { publishRealtimeNotify } = await import("../lib/realtime");

    await expect(publishRealtimeNotify("ws-1", { type: "x" })).resolves.toBeUndefined();
    delete process.env.REALTIME_PUBSUB;
  });
});
