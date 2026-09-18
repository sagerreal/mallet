"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/features/auth/hooks";
import { useHydrated } from "@/lib/use-hydrated";

export default function ForgotPasswordPage() {
  // onSubmit does not exist until React attaches. Until then a submit is a native
  // GET that puts credentials in the URL — see lib/use-hydrated.ts.
  const hydrated = useHydrated();
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await requestPasswordReset(String(new FormData(e.currentTarget).get("email")));
    setSent(true);
  };

  if (sent) {
    return (
      <>
        <h1 className="auth-title">Check your inbox</h1>
        <p className="auth-sub">If that account exists, a reset link is on its way.</p>
        <div className="auth-links" style={{ justifyContent: "center" }}>
          <Link href="/login">Back to sign in</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">Enter your email and we&apos;ll send a link.</p>
      <form onSubmit={onSubmit} method="post">
        <label className="auth-field">
          <span>Email</span>
          <input className="auth-input" name="email" enterKeyHint="go" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <button className="auth-submit" type="submit" disabled={!hydrated}>Send reset link</button>
      </form>
      <div className="auth-links" style={{ justifyContent: "center" }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </>
  );
}
