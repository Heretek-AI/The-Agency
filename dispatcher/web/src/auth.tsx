import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, type Role, type SessionUser } from "./api.ts";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  login: () => Promise.reject(new Error("auth provider is not mounted")),
  logout: () => Promise.reject(new Error("auth provider is not mounted")),
});

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const queryClient = useQueryClient();
  const [loginError, setLoginError] = useState<string | null>(null);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      setLoginError(null);
      try {
        const user = await api.login(username.trim(), password);
        queryClient.setQueryData(["session"], user);
      } catch (err) {
        const message = err instanceof Error ? err.message : "login failed";
        setLoginError(message);
        throw err;
      }
    },
    [queryClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    await api.logout();
    queryClient.setQueryData(["session"], null);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user: session.data ?? null,
        loading: session.isLoading,
        error: loginError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useRole(): Role | null {
  return useContext(AuthContext).user?.role ?? null;
}
