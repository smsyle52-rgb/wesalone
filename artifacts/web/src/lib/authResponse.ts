type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
};

const GENERIC_AUTH_ERROR = "تعذر إكمال العملية الآن. يرجى المحاولة بعد لحظات.";
const DEPLOY_RESPONSE_ERROR = "الخدمة لم تجهز بعد أو أن توجيه الخادم غير مكتمل. يرجى المحاولة بعد لحظات.";

function extractMessage(payload: ApiErrorPayload | null, fallback: string): string {
  const message = payload?.error ?? payload?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export async function readAuthResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: ApiErrorPayload | null = null;

  if (text.trim()) {
    try {
      payload = JSON.parse(text) as ApiErrorPayload;
    } catch {
      if (/the deploy/i.test(text)) {
        throw new Error(DEPLOY_RESPONSE_ERROR);
      }
      throw new Error(response.ok ? GENERIC_AUTH_ERROR : fallback);
    }
  }

  if (!response.ok) {
    throw new Error(extractMessage(payload, fallback));
  }

  return (payload ?? {}) as T;
}
