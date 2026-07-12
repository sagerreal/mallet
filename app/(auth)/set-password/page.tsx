"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { completeInvite } from "@/features/auth/hooks";

// Landing screen for invited team members after they click their invite link.
// The Supabase session is already active (established by /auth/callback).
// Setting a password here completes account creation; then /welcome runs the
// org-join provisioning (v1.identity.signup) and routes the user into the app.
export default function SetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const failure = await completeInvite(String(form.get("password")), String(form.get("fullName")));
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    // /welcome calls v1.identity.signup which joins the pending org_invites row and provisions
    // the user row, then redirects to /my-day (tech) or /dashboard (office/owner).
    router.replace("/welcome");
  };

  return (
    <>
      <h1 className="auth-title">Set your password</h1>
      <p className="auth-sub">Choose a password to finish joining your team.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Your name">
            <Input
              name="fullName"
              type="text"
              required
              maxLength={80}
              autoComplete="name"
              placeholder="Mike Rivera"
            />
          </Field>
          <Field label="Password">
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="8+ characters"
            />
          </Field>
          {error ? <p className="text-sm text-red">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Set password and continue"}
          </Button>
        </form>
      </Card>
    </>
  );
}
