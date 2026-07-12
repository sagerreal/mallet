"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signUp } from "@/features/auth/hooks";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const failure = await signUp(
      String(form.get("email")),
      String(form.get("password")),
      String(form.get("orgName")),
      String(form.get("fullName")),
    );
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <>
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-sub">We sent a confirmation link. Open it, then sign in.</p>
        <div className="auth-links" style={{ justifyContent: "center" }}>
          <Link href="/login">Back to sign in</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">Get your crew running in minutes.</p>
      <form onSubmit={onSubmit}>
        <label className="auth-field">
          <span>Business name</span>
          <input className="auth-input" name="orgName" required maxLength={80} placeholder="Rivera Plumbing" />
        </label>
        <label className="auth-field">
          <span>Your name</span>
          <input className="auth-input" name="fullName" required maxLength={80} autoComplete="name" placeholder="Mike Rivera" />
        </label>
        <label className="auth-field">
          <span>Email</span>
          <input className="auth-input" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input className="auth-input" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="8+ characters" />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="auth-links" style={{ justifyContent: "center" }}>
        <Link href="/login">Already have an account? Sign in</Link>
      </div>
    </>
  );
}
