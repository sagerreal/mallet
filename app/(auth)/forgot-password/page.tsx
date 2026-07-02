"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/auth/hooks";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await requestPasswordReset(String(new FormData(e.currentTarget).get("email")));
    setSent(true); // same response whether or not the account exists — no oracle
  };

  return (
    <Card>
      {sent ? (
        <p className="text-sm">If that account exists, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Button type="submit" className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-3 text-center text-sm"><Link className="text-ink-muted underline" href="/login">Back to sign in</Link></p>
    </Card>
  );
}
