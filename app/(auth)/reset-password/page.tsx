"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { updatePassword } from "@/features/auth/hooks";
import { useHydrated } from "@/lib/use-hydrated";

export default function ResetPasswordPage() {
  // onSubmit does not exist until React attaches. Until then a submit is a native
  // GET that puts credentials in the URL — see lib/use-hydrated.ts.
  const hydrated = useHydrated();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const failure = await updatePassword(String(new FormData(e.currentTarget).get("password")));
    if (failure) {
      setError(failure);
      return;
    }
    router.replace("/");
  };

  return (
    <Card>
      <form onSubmit={onSubmit} method="post" className="stack-3">
        <Field label="New password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        {error ? <p style={{ fontSize: "var(--type-sm)", color: "var(--red)" }}>{error}</p> : null}
        <Button type="submit" style={{ width: "100%" }} disabled={!hydrated}>Set password</Button>
      </form>
    </Card>
  );
}
