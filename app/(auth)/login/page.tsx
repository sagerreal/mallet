"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
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
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">Sign in</Button>
        <div className="flex justify-between text-sm">
          <Link className="text-ink-muted underline" href="/forgot-password">Forgot password</Link>
          <Link className="text-ink-muted underline" href="/signup">Create account</Link>
        </div>
      </form>
    </Card>
  );
}
