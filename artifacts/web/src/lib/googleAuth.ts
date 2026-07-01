declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT_ID = "wesal-google-identity";

let googleClientIdPromise: Promise<string | null> | null = null;
let googleScriptPromise: Promise<void> | null = null;

async function fetchGoogleClientId() {
  const envClientId = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "").trim();
  if (envClientId) return envClientId;

  if (!googleClientIdPromise) {
    googleClientIdPromise = fetch(`${import.meta.env.BASE_URL}api/auth/google/config`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json() as { clientId?: string | null };
        return typeof data.clientId === "string" && data.clientId.trim() ? data.clientId.trim() : null;
      })
      .catch(() => null);
  }

  return googleClientIdPromise;
}

async function loadGoogleScript() {
  if (window.google?.accounts?.id) return;

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("تعذر تحميل مكتبة Google.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = GOOGLE_SCRIPT_ID;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("تعذر تحميل مكتبة Google."));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
}

export async function startGoogleIdentitySignIn(
  onCredential: (credential: string) => void,
  onError?: (message: string) => void,
) {
  const clientId = await fetchGoogleClientId();
  if (!clientId) {
    throw new Error("تسجيل الدخول بحساب Google غير مهيأ حالياً.");
  }

  await loadGoogleScript();

  const googleAccounts = window.google?.accounts?.id;
  if (!googleAccounts) {
    throw new Error("تعذر تهيئة تسجيل الدخول بحساب Google.");
  }

  googleAccounts.initialize({
    client_id: clientId,
    callback: (response) => {
      if (!response.credential) {
        onError?.("لم يتم استلام رمز Google.");
        return;
      }
      onCredential(response.credential);
    },
  });
  googleAccounts.prompt();
}
