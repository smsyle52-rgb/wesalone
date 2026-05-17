# Rate Limiting

Khadamatak uses in-memory Express rate limiters in the API container as a first production guard.

Current limits:

- `POST /api/auth/login` and `POST /api/auth/register`: 10 requests per 15 minutes per IP.
- `/api/webhooks/*`: 600 requests per minute per IP.
- Other `/api/*` routes: 300 requests per minute per active session, falling back to IP when no session exists.

This keeps the current Cloud Run deployment simple. When traffic grows or multiple API instances must share limits exactly, move the limiter store to Redis or Memorystore and keep the same key strategy:

- Auth routes: IP key.
- Webhooks: IP key plus provider-specific guards when live channels are enabled.
- Authenticated API routes: workspace ID + user ID.

Do not log request bodies or secret headers from rate-limit handlers.
