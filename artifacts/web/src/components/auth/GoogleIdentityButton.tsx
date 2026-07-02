import { useEffect, useRef, useState } from "react";
import { GoogleButton } from "@/components/auth/WesalAuthLayout";
import { renderGoogleIdentityButton } from "@/lib/googleAuth";

type Props = {
  busy: boolean;
  disabled?: boolean;
  text: "signin_with" | "signup_with";
  label: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
};

export default function GoogleIdentityButton({ busy, disabled = false, text, label, onCredential, onError }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function mountButton() {
      if (!containerRef.current || disabled || busy) return;
      setReady(false);
      try {
        await renderGoogleIdentityButton({
          container: containerRef.current,
          text,
          onCredential,
          onError,
        });
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) {
          setReady(false);
          onError((error as Error).message);
        }
      }
    }

    void mountButton();

    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [busy, disabled, onCredential, onError, text]);

  const blocked = busy || disabled;

  return (
    <div className="relative">
      <div className={blocked ? "opacity-50 pointer-events-none" : ""}>
        <div ref={containerRef} className="[&_div]:mx-auto [&_div]:min-h-[44px] [&_iframe]:max-w-full" />
      </div>
      {(!ready || blocked) && (
        <div className="absolute inset-0">
          <GoogleButton
            label={label}
            onClick={() => {}}
            loading={busy}
            disabled
          />
        </div>
      )}
    </div>
  );
}
