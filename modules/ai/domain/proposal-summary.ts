import type { JsonValue } from "@mallet/shared/ports";

// Human-readable one-liner for a mutating-tool proposal — what the person approving actually reads.
// Pure (no DB): derived only from the frozen args, so the summary shown is the summary stored.
// Falls back to compact JSON for tools without a bespoke renderer.

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

interface QuoteLine {
  readonly quantity?: number;
  readonly rateCents?: number;
  readonly isOptional?: boolean;
}

const isRecord = (v: JsonValue | undefined): v is { readonly [key: string]: JsonValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const describeQuoteDraft = (args: Record<string, JsonValue>): string => {
  const lines = Array.isArray(args.lines) ? (args.lines as readonly JsonValue[]).filter(isRecord) : [];
  const subtotal = lines.reduce((sum: number, l) => {
    const line = l as QuoteLine;
    return line.isOptional ? sum : sum + (line.quantity ?? 0) * (line.rateCents ?? 0);
  }, 0);
  const parts = [
    `Draft a quote for customer ${String(args.leadId ?? "?")}`,
    typeof args.title === "string" && args.title ? `"${args.title}"` : null,
    `${lines.length} line item(s), subtotal ${money(subtotal)}`,
    typeof args.taxBps === "number" && args.taxBps > 0 ? `tax ${pct(args.taxBps)}` : null,
    typeof args.depBps === "number" && args.depBps > 0 ? `deposit ${pct(args.depBps)}` : null,
  ];
  return `${parts.filter(Boolean).join(" — ")}. Creates a DRAFT (not sent to the customer).`;
};

const describeInvoiceSend = (args: Record<string, JsonValue>): string =>
  `Mark invoice ${String(args.invoiceId ?? "?")} as SENT to the customer — this starts its payment terms.`;

export const describeProposal = (tool: string, args: Record<string, JsonValue>): string => {
  switch (tool) {
    case "quote_draft":
      return describeQuoteDraft(args);
    case "invoice_send":
      return describeInvoiceSend(args);
    default:
      return `Run ${tool} with input ${JSON.stringify(args)}`;
  }
};
