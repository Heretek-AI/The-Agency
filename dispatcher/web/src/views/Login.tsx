import { useState, type ReactNode } from "react";
import { useAuth } from "../auth.tsx";
import { AnimatedGridPattern, ShimmerButton } from "../magic/magic.tsx";

export function Login(): ReactNode {
  const { login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
    } catch {
      // The error text renders from auth state.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#07090e]">
      <AnimatedGridPattern className="absolute inset-0" />
      <form
        onSubmit={(e) => void submit(e)}
        className="relative z-10 w-[min(24rem,92vw)] rounded-lg border border-[#1f2937] bg-[#0d1118] p-6"
      >
        <h1 className="text-lg font-semibold text-[#e6edf3]">The Agency</h1>
        <p className="mt-1 text-sm text-[#8b949e]">Log in to mission control.</p>
        <label className="mt-4 block text-xs text-[#8b949e]" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          data-testid="login-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded border border-[#1f2937] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3] outline-none focus:border-[#00f0ff]"
        />
        <label className="mt-3 block text-xs text-[#8b949e]" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          data-testid="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-[#1f2937] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3] outline-none focus:border-[#00f0ff]"
        />
        {error !== null && (
          <p data-testid="login-error" role="alert" className="mt-3 text-sm text-[#ff8fab]">
            {error}
          </p>
        )}
        <div className="mt-5">
          <ShimmerButton testId="login-submit" disabled={busy} submit>
            {busy ? "Logging in…" : "Log in"}
          </ShimmerButton>
        </div>
      </form>
    </div>
  );
}
