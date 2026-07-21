"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { updatePassword } from "@/features/auth/hooks";

export default function ResetPasswordPage() {
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
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="New password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        {error ? <p className="text-sm" style={{ color: "var(--red)" }}>{error}</p> : null}
        <Button type="submit" className="w-full">Set password</Button>
      </form>
    </Card>
  );
}
