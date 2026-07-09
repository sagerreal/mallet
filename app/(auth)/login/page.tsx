"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/features/auth/hooks";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <p className="auth-sub">Sign in to your Mallet account.</p>
      <form onSubmit={onSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input className="auth-input" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input className="auth-input" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
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
