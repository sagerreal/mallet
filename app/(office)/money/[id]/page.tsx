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

  if (invoice.isError) return <p style={{ fontSize: "var(--type-sm)", color: "var(--red)" }}>{userMessage(invoice.error)}</p>;
  if (invoice.isLoading) return <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)" }}>Loading…</p>;
  if (!invoice.data) return <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)" }}>Invoice not found.</p>;
  const inv = invoice.data;
  const payable = inv.status === "sent" || inv.status === "partial";

  return (
    <div className="stack-4">
      <PageHeader
        title={`${inv.num} — ${inv.title ?? "untitled"}`}
        action={
          <span style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "neutral"}>{inv.status}</Badge>
        <span style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)" }}>Due {formatDate(inv.dueAt)}</span>
      </div>
      {error ? <p style={{ fontSize: "var(--type-sm)", color: "var(--red)" }}>{error}</p> : null}
      {cardLink.data ? (
        <Card style={{ fontSize: "var(--type-sm)" }}>
          <p style={{ fontWeight: 500 }}>Card payment link (send to the customer):</p>
          <a style={{ wordBreak: "break-all", color: "var(--blue)", textDecoration: "underline" }} href={cardLink.data.url} target="_blank" rel="noreferrer">{cardLink.data.url}</a>
        </Card>
      ) : null}
      <RecordPaymentSheet invoiceId={id} dueCents={inv.due.cents} open={recording} onClose={() => setRecording(false)} />
      <Card>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: "var(--type-sm)" }}>
          {inv.lines.map((l, i) => (
            <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-2) 0", borderTop: i > 0 ? "1px solid var(--line)" : undefined }}>
              <span>{l.description}</span><span style={{ color: "var(--ink-2)" }}>×{l.quantity}</span>
            </li>
          ))}
        </ul>
        <dl className="stack-1" style={{ margin: "var(--space-3) 0 0", borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)", fontSize: "var(--type-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 500 }}><dt>Total</dt><dd>{formatMoney(inv.total.cents)}</dd></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "var(--ink-2)" }}>Paid</dt><dd>{formatMoney(inv.amountPaid.cents)}</dd></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "var(--ink-2)" }}>Balance due</dt><dd>{formatMoney(inv.due.cents)}</dd></div>
        </dl>
      </Card>
      {inv.payments.length > 0 ? (
        <Card>
          <h2 style={{ margin: "0 0 var(--space-2)", fontSize: "inherit", fontFamily: "var(--font-space-grotesk)", fontWeight: 600 }}>Payments</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: "var(--type-sm)" }}>
            {inv.payments.map((p, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-2) 0", borderTop: i > 0 ? "1px solid var(--line)" : undefined }}><span>{p.method.replace("_", " ")}</span><span>{formatMoney(p.amount.cents)}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
