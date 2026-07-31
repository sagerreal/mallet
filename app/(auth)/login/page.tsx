"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/features/auth/hooks";
import { useHydrated } from "@/lib/use-hydrated";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // onSubmit does not exist until React attaches. Until then a submit is a native
  // GET that puts the password in the URL — see lib/use-hydrated.ts.
  const hydrated = useHydrated();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const failure = await signIn(String(form.get("email")), String(form.get("password")));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    router.replace("/");
  };

  return (
    <>
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Sign in to your Elas account.</p>
      <form onSubmit={onSubmit} method="post">
        <label className="auth-field">
          <span>Email</span>
          <input className="auth-input" name="email" enterKeyHint="next" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input className="auth-input" name="password" enterKeyHint="go" type="password" required autoComplete="current-password" placeholder="••••••••" />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy || !hydrated}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="auth-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/signup">Create account</Link>
      </div>
    </>
  );
}
