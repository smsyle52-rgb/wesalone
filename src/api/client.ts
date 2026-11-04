import createClient, { type Middleware } from 'openapi-fetch';

import { getAuthToken } from '@/api/auth-token';
import { env } from '@/config/env';

import type { paths } from './generated/schema';

/**
 * Attaches `Authorization: Bearer <token>` to every outgoing request when a token is stored.
 */
const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = await getAuthToken();

    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }

    return request;
  },
};

/**
 * Typed fetch client for the ChatbotX REST API, generated from its OpenAPI spec.
 * Run `pnpm generate:api` to (re)generate src/api/generated/schema.ts against a running backend.
 *
 * All oRPC routes in the generated spec are served under `/api` (auth and the hand-rolled
 * multipart upload route are separate surfaces under plain `/api` — see auth-endpoints.ts and
 * send-message-multipart.ts).
 */
/** Wesal One serves the session-authed REST surface for this app at `/api/mobile` (bearer-only);
 * plain `/api` there is the workspace-token public API. Auth stays at `/api/auth`. */
export const apiRestBaseUrl = `${env.apiBaseUrl}/api/mobile`;

export const apiClient = createClient<paths>({ baseUrl: apiRestBaseUrl });

apiClient.use(authMiddleware);
