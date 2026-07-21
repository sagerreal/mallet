"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useRecordPayment } from "./hooks";

const METHODS = ["cash", "check", "card_terminal", "ach", "card"] as const;

export function RecordPaymentSheet({ invoiceId, dueCents, open, onClose }: { invoiceId: string; dueCents: number; open: boolean; onClose: () => void }) {
  const record = useRecordPayment();
  const [error, setError] = useState<string | null>(null);
  // One key per sheet-open: retries of THIS submission dedupe server-side at the payments ledger.
  const idempotencyKey = useMemo(() => (open ? crypto.randomUUID() : ""), [open]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    record.mutate(
      {
        invoiceId,
        amountCents: Math.round(parseFloat(String(form.get("amount"))) * 100),
        method: form.get("method") as (typeof METHODS)[number],
        idempotencyKey,
      },
      { onSuccess: onClose, onError: (err) => setError(userMessage(err)) },
    );
  };

  return (
    <Sheet open={open} title="Record payment" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Amount ($)">
          <Input name="amount" type="number" min={0.01} step={0.01} defaultValue={(dueCents / 100).toFixed(2)} required />
        </Field>
        <Field label="Method">
          <Select name="method" defaultValue="cash">
            {METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
          </Select>
        </Field>
        {error ? <p className="text-sm" style={{ color: "var(--red)" }}>{error}</p> : null}
        <Button type="submit" disabled={record.isPending}>Record payment</Button>
      </form>
    </Sheet>
  );
}
