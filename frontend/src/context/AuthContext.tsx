import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { tokenStore } from "@/api/client";
import { authApi } from "@/api/endpoints";
import type { Role, User } from "@/types/userData";

interface AuthContextValue {
  user: User | null;
  /** Скорочення для сумісності: email поточного користувача */
  email: string | null;
  role: Role | "GUEST";
  ready: boolean;
  /** Право на особисті дані за матрицею RBAC (Спостерігач, Модератор) */
  canUsePersonal: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      setUser(await authApi.me());
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- початкова перевірка сесії
    void refresh();
    const onUnauthorized = () => {
      tokenStore.clear();
      setUser(null);
    };
    window.addEventListener("star:unauthorized", onUnauthorized);
    return () => window.removeEventListener("star:unauthorized", onUnauthorized);
  }, [refresh]);

  async function login(email: string, password: string) {
    const res = await authApi.login(email, password);
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  }

  async function register(email: string, password: string) {
    await authApi.register(email, password);
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {
      /* сесія вже недійсна */
    }
    tokenStore.clear();
    setUser(null);
  }

  const role = user?.role ?? "GUEST";
  return (
    <AuthContext.Provider
      value={{
        user, email: user?.email ?? null, role, ready,
        canUsePersonal: role === "OBSERVER" || role === "MODERATOR",
        login, register, logout, refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth має використовуватись всередині AuthProvider");
  return ctx;
}
