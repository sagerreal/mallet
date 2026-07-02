"use client";
import { use, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/format";
import { INVOICE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useInvoice, useSendInvoice, useVoidInvoice, useCardPaymentLink } from "@/features/invoices/hooks";
import { RecordPaymentSheet } from "@/features/invoices/record-payment-sheet";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoice = useInvoice(id);
  const send = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const cardLink = useCardPaymentLink();
  const [recording, setRecording] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (invoice.isError) return <p className="text-sm text-red">{userMessage(invoice.error)}</p>;
  if (invoice.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!invoice.data) return <p className="text-sm text-ink-muted">Invoice not found.</p>;
  const inv = invoice.data;
  const payable = inv.status === "sent" || inv.status === "partial";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${inv.num} — ${inv.title ?? "untitled"}`}
        action={
          <span className="flex flex-wrap gap-2">
            {inv.status === "draft" ? <Button disabled={send.isPending} onClick={() => send.mutate({ invoiceId: id }, { onError })}>Send invoice</Button> : null}
            {payable ? <Button onClick={() => setRecording(true)}>Record payment</Button> : null}
            {payable ? (
              <Button variant="quiet" disabled={cardLink.isPending} onClick={() => cardLink.mutate({ invoiceId: id }, { onError })}>
                Card payment link
              </Button>
            ) : null}
            {inv.status === "draft" || inv.status === "sent" ? (
              confirmVoid
                ? <Button variant="danger" disabled={voidInvoice.isPending} onClick={() => voidInvoice.mutate({ invoiceId: id }, { onError })}>Confirm void</Button>
                : <Button variant="danger" onClick={() => setConfirmVoid(true)}>Void</Button>
            ) : null}
          </span>
        }
      />
      <div className="flex items-center gap-3">
        <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "neutral"}>{inv.status}</Badge>
        <span className="text-sm text-ink-muted">Due {formatDate(inv.dueAt)}</span>
      </div>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      {cardLink.data ? (
        <Card className="text-sm">
          <p className="font-medium">Card payment link (send to the customer):</p>
          <a className="break-all text-blue underline" href={cardLink.data.url} target="_blank" rel="noreferrer">{cardLink.data.url}</a>
        </Card>
      ) : null}
      <RecordPaymentSheet invoiceId={id} dueCents={inv.due.cents} open={recording} onClose={() => setRecording(false)} />
      <Card>
        <ul className="divide-y divide-line text-sm">
          {inv.lines.map((l, i) => <li key={i} className="flex justify-between py-2"><span>{l.description}</span><span className="text-ink-muted">×{l.quantity}</span></li>)}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between font-medium"><dt>Total</dt><dd>{formatMoney(inv.total.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Paid</dt><dd>{formatMoney(inv.amountPaid.cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Balance due</dt><dd>{formatMoney(inv.due.cents)}</dd></div>
        </dl>
      </Card>
      {inv.payments.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-display font-semibold">Payments</h2>
          <ul className="divide-y divide-line text-sm">
            {inv.payments.map((p, i) => (
              <li key={i} className="flex justify-between py-2"><span>{p.method.replace("_", " ")}</span><span>{formatMoney(p.amount.cents)}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
