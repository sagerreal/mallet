"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/features/auth/hooks";

export default function ForgotPasswordPage() {
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
      <form onSubmit={onSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input className="auth-input" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <button className="auth-submit" type="submit">Send reset link</button>
      </form>
      <div className="auth-links" style={{ justifyContent: "center" }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </>
  );
}
