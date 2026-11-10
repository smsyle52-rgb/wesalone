import { authHeaders, requestPasswordReset, signInWithEmail } from './auth-endpoints';

// jest.mock calls below are hoisted above this import by babel-jest.
jest.mock('@/config/env', () => ({
  env: { apiBaseUrl: 'https://wesal.one', wsUrl: 'https://wesal.one/ws/' },
}));
jest.mock('./auth-token', () => ({ setAuthToken: jest.fn(() => Promise.resolve()) }));

describe('authHeaders', () => {
  it('always sends the backend origin so cookie-carrying requests pass the CSRF check', () => {
    expect(authHeaders()).toEqual({ Origin: 'https://wesal.one' });
    expect(authHeaders({ 'Content-Type': 'application/json' })).toEqual({
      Origin: 'https://wesal.one',
      'Content-Type': 'application/json',
    });
  });
});

describe('signInWithEmail', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts credentials with an Origin header', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: { id: '1' } }), {
          status: 200,
          headers: { 'set-auth-token': 'tok' },
        }),
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await signInWithEmail('a@b.co', 'secret').catch(() => undefined);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wesal.one/api/auth/sign-in/email');
    expect((init.headers as Record<string, string>).Origin).toBe('https://wesal.one');
  });
});

describe('requestPasswordReset', () => {
  it('posts to the request-password-reset route with the web reset page as redirect', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await requestPasswordReset('a@b.test');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/request-password-reset$/);
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.test',
      redirectTo: '/auth/reset-password',
    });
  });
});
