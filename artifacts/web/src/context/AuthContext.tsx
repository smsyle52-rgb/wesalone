import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  permissions: string[];
  roleSlugs: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  workspaceId: string | null;
  isLoading: boolean;
  onboardingCompleted: boolean;
  setAuth: (user: AuthUser, wsId: string, opts?: { onboardingCompleted?: boolean }) => void;
  clearAuth: () => void;
  hasPermission: (perm: string) => boolean;
  setOnboardingCompleted: (v: boolean) => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.user) {
          setUser({
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            emailVerified: data.user.emailVerified,
            permissions: data.user.permissions ?? [],
            roleSlugs: data.user.roleSlugs ?? [],
          });
          setWorkspaceId(data.workspaceId ?? data.workspace?.id ?? null);
          setOnboardingCompleted(data.onboardingCompleted === true);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setAuth = (u: AuthUser, wsId: string, opts?: { onboardingCompleted?: boolean }) => {
    setUser(u);
    setWorkspaceId(wsId);
    if (opts?.onboardingCompleted !== undefined) setOnboardingCompleted(opts.onboardingCompleted);
  };
  const clearAuth = () => { setUser(null); setWorkspaceId(null); setOnboardingCompleted(false); };
  const hasPermission = (perm: string) => user?.permissions.includes(perm) ?? false;

  return (
    <AuthContext.Provider value={{ user, workspaceId, isLoading, onboardingCompleted, setAuth, clearAuth, hasPermission, setOnboardingCompleted }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
