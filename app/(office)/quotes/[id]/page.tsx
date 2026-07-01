"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { ESTIMATE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useQuote, useSendQuote, useAcceptQuote, useDeclineQuote } from "@/features/quotes/hooks";
import { useCreateJobFromEstimate } from "@/features/jobs/hooks";

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const quote = useQuote(id);
  const send = useSendQuote();
  const accept = useAcceptQuote();
  const decline = useDeclineQuote();
  const createJob = useCreateJobFromEstimate();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (quote.isError) return <p className="text-sm text-red">{userMessage(quote.error)}</p>;
  if (quote.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!quote.data) return <p className="text-sm text-ink-muted">Quote not found.</p>;
  const q = quote.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${q.num} — ${q.title ?? "untitled"}`}
        action={
          <span className="flex gap-2">
            {q.status === "draft" ? (
              <Button disabled={send.isPending} onClick={() => send.mutate({ estimateId: id }, { onError })}>
                Send to customer
              </Button>
            ) : null}
            {q.status === "sent" ? (
              <Button disabled={accept.isPending} onClick={() => accept.mutate({ estimateId: id }, { onError })}>
                Mark accepted
              </Button>
            ) : null}
            {q.status === "sent" ? (
              <Button variant="danger" onClick={() => setDeclining(true)}>
                Mark declined
              </Button>
            ) : null}
            {q.status === "accepted" ? (
              <Button
                disabled={createJob.isPending}
                onClick={() =>
                  createJob.mutate(
                    { estimateId: id },
                    { onSuccess: (j) => router.push(`/jobs/${j.id}`), onError },
                  )
                }
              >
                Create job
              </Button>
            ) : null}
          </span>
        }
      />
      <Badge tone={ESTIMATE_STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <Sheet open={declining} title="Decline quote" onClose={() => setDeclining(false)}>
        <div className="space-y-3">
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          <Button
            variant="danger"
            disabled={!reason || decline.isPending}
            onClick={() =>
              decline.mutate({ estimateId: id, reason }, { onSuccess: () => setDeclining(false), onError })
            }
          >
            Confirm decline
          </Button>
        </div>
      </Sheet>
      <Card>
        <ul className="divide-y divide-line text-sm">
          {q.lines.map((l) => (
            <li key={l.id} className="flex justify-between py-2">
              <span>
                {l.description}
                {l.isOptional ? " (optional)" : ""}
              </span>
              <span className="text-ink-muted">×{l.quantity}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd>{formatMoney(q.subtotal.cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Tax</dt>
            <dd>{formatMoney(q.tax.cents)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(q.total.cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Deposit due</dt>
            <dd>{formatMoney(q.depositDue.cents)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
