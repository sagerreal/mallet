"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useCustomers } from "@/features/customers/hooks";
import { useDraftQuote } from "@/features/quotes/hooks";
import { LineEditor, type LineDraft } from "@/features/quotes/line-editor";

const toCents = (dollars: string): number => Math.round(parseFloat(dollars || "0") * 100);
const toBps = (percent: string): number => Math.round(parseFloat(percent || "0") * 100);

export default function NewQuotePage() {
  const router = useRouter();
  const preselected = useSearchParams().get("leadId") ?? "";
  const customers = useCustomers();
  const draft = useDraftQuote();
  const [leadId, setLeadId] = useState(preselected);
  const [title, setTitle] = useState("");
  const [taxPct, setTaxPct] = useState("");
  const [depPct, setDepPct] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: 1, rateDollars: "" }]);
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    draft.mutate(
      {
        leadId,
        // Default to first line description so jobs inherit a readable title when none is set.
        title: title || lines[0]?.description || undefined,
        taxBps: taxPct ? toBps(taxPct) : undefined,
        depBps: depPct ? toBps(depPct) : undefined,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          rateCents: toCents(l.rateDollars),
        })),
      },
      { onSuccess: (q) => router.push(`/quotes/${q.id}`), onError: (err) => setError(userMessage(err)) },
    );

  return (
    <div>
      <PageHeader title="New quote" />
      <Card className="space-y-3">
        <Field label="Customer">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)} required>
            <option value="">Choose a customer…</option>
            {(customers.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax %">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
            />
          </Field>
          <Field label="Deposit %">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={depPct}
              onChange={(e) => setDepPct(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Line items">
          <LineEditor lines={lines} onChange={setLines} />
        </Field>
        {error ? <p className="text-sm text-red">{error}</p> : null}
        <Button onClick={submit} disabled={!leadId || draft.isPending}>
          Create draft
        </Button>
      </Card>
    </div>
  );
}
