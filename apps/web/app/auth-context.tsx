"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type UserRole = "creator" | "brand" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: "active" | "banned";
};

type AuthContextValue = {
  accessToken: string | null;
  error: string | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  register(
    email: string,
    password: string,
    role: Exclude<UserRole, "admin">,
    referralCode?: string
  ): Promise<AuthUser>;
  resendVerification(email: string): Promise<void>;
  switchRole(role: Exclude<UserRole, "admin">): Promise<void>;
  user: AuthUser | null;
  verifyEmail(token: string): Promise<AuthUser>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyAuth = useCallback((payload: { accessToken: string; user: AuthUser }) => {
    setAccessToken(payload.accessToken);
    setUser(payload.user);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const payload = await apiRequest<{ accessToken: string; user: AuthUser }>(
      "/auth/refresh",
      {
        method: "POST"
      }
    );
    applyAuth(payload);
  }, [applyAuth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
      .catch(() => {
        setAccessToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      error,
      loading,
      user,
      async login(email, password) {
        applyAuth(
          await apiRequest<{ accessToken: string; user: AuthUser }>("/auth/login", {
            body: JSON.stringify({ email, password }),
            method: "POST"
          })
        );
      },
      async logout() {
        await apiRequest<void>("/auth/logout", { method: "POST" }, accessToken);
        setAccessToken(null);
        setUser(null);
      },
      refresh,
      async register(email, password, role, referralCode) {
        const payload = await apiRequest<{ user: AuthUser }>("/auth/register", {
          body: JSON.stringify({ email, password, role, referralCode }),
          method: "POST"
        });
        return payload.user;
      },
      async resendVerification(email) {
        await apiRequest("/auth/resend-verification", {
          body: JSON.stringify({ email }),
          method: "POST"
        });
      },
      async switchRole(role) {
        const payload = await apiRequest<{ accessToken: string; user: AuthUser }>(
          "/auth/me/role",
          {
            body: JSON.stringify({ role }),
            method: "PATCH"
          },
          accessToken
        );
        applyAuth(payload);
      },
      async verifyEmail(token) {
        const payload = await apiRequest<{ user: AuthUser }>("/auth/verify-email", {
          body: JSON.stringify({ token }),
          method: "POST"
        });
        return payload.user;
      }
    }),
    [accessToken, applyAuth, error, loading, refresh, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string | null
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.error?.code ?? "REQUEST_FAILED");
  }

  return payload as T;
}
