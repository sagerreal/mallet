"use client";
import { useState, type FormEvent } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useCreateCustomer } from "./hooks";

export function NewCustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCustomer();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate(
      { name: String(form.get("name")), phone: String(form.get("phone")) || undefined },
      { onSuccess: onClose, onError: (err) => setError(userMessage(err)) },
    );
  };

  return (
    <Sheet open={open} title="New customer" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name"><Input name="name" required /></Field>
        <Field label="Phone"><Input name="phone" type="tel" placeholder="+1 555 000 0000" /></Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button type="submit" disabled={create.isPending}>Add customer</Button>
      </form>
    </Sheet>
  );
}
