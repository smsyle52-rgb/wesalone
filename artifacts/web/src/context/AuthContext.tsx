import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { DEFAULT_ONBOARDING_STATUS, normalizeOnboardingStatus, type OnboardingStatus } from "@/lib/onboarding";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  permissions: string[];
  roleSlugs: string[];
  isPlatformAdmin?: boolean;
}

interface AuthCtx {
  user: AuthUser | null;
  workspaceId: string | null;
  isLoading: boolean;
  onboardingStatus: OnboardingStatus;
  onboardingCompleted: boolean;
  setAuth: (user: AuthUser, wsId: string, opts?: { onboardingCompleted?: boolean; onboardingStatus?: unknown }) => void;
  clearAuth: () => void;
  hasPermission: (perm: string) => boolean;
  setOnboardingCompleted: (v: boolean) => void;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

async function readSessionPayload(response: Response) {
  const text = await response.text().catch(() => "");
  if (!response.ok || !text.trim()) return null;

  try {
    return JSON.parse(text) as {
      user?: AuthUser;
      workspaceId?: string | null;
      workspace?: { id?: string | null } | null;
      onboardingCompleted?: boolean;
      onboardingStatus?: unknown;
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>(DEFAULT_ONBOARDING_STATUS);

  const applyAuthPayload = (data: {
    user?: AuthUser;
    workspaceId?: string | null;
    workspace?: { id?: string | null } | null;
    onboardingCompleted?: boolean;
    onboardingStatus?: unknown;
  }) => {
    if (!data?.user) return;
    setUser({
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      emailVerified: data.user.emailVerified,
      permissions: data.user.permissions ?? [],
      roleSlugs: data.user.roleSlugs ?? [],
      isPlatformAdmin: data.user.isPlatformAdmin === true,
    });
    setWorkspaceId(data.workspaceId ?? data.workspace?.id ?? null);
    setOnboardingStatus(normalizeOnboardingStatus(data.onboardingStatus, data.onboardingCompleted === true));
  };

  const refreshAuth = async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include" }).catch(() => null);
    if (!response?.ok) return;
    const data = await readSessionPayload(response);
    if (data?.user) applyAuthPayload(data);
  };

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include" })
      .then((r) => readSessionPayload(r))
      .then((data) => {
        if (data?.user) applyAuthPayload(data);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setAuth = (u: AuthUser, wsId: string, opts?: { onboardingCompleted?: boolean; onboardingStatus?: unknown }) => {
    setUser(u);
    setWorkspaceId(wsId);
    setOnboardingStatus(normalizeOnboardingStatus(opts?.onboardingStatus, opts?.onboardingCompleted === true));
  };
  const clearAuth = () => { setUser(null); setWorkspaceId(null); setOnboardingStatus(DEFAULT_ONBOARDING_STATUS); };
  const hasPermission = (perm: string) => user?.permissions.includes(perm) ?? false;
  const setOnboardingCompleted = (value: boolean) => {
    setOnboardingStatus((current) => value ? { ...current, completed: true, currentStep: 3 } : DEFAULT_ONBOARDING_STATUS);
  };
  const onboardingCompleted = onboardingStatus.completed;

  return (
    <AuthContext.Provider value={{ user, workspaceId, isLoading, onboardingStatus, onboardingCompleted, setAuth, clearAuth, hasPermission, setOnboardingCompleted, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
