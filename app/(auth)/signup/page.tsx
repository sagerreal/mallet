"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signUp } from "@/features/auth/hooks";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const failure = await signUp(String(form.get("email")), String(form.get("password")), String(form.get("orgName")));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm text-ink-muted">We sent a confirmation link. Open it, then sign in.</p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Business name"><Input name="orgName" required maxLength={80} /></Field>
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">Create account</Button>
        <p className="text-center text-sm"><Link className="text-ink-muted underline" href="/login">Back to sign in</Link></p>
      </form>
    </Card>
  );
}
