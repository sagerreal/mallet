import type { JsonValue } from "@mallet/shared/ports";

// Human-readable one-liner for a mutating-tool proposal — what the person approving actually reads.
// Pure (no DB): derived only from the frozen args, so the summary shown is the summary stored.
// Falls back to compact JSON for tools without a bespoke renderer.
// IMPORTANT: no raw PII (phone/email/UUID-only), no raw cents — use money() for all dollar amounts.

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

interface QuoteLine {
  readonly quantity?: number;
  readonly rateCents?: number;
  readonly isOptional?: boolean;
}

interface InvoiceLine {
  readonly quantity?: number;
  readonly rateCents?: number;
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

const describeQuoteSend = (args: Record<string, JsonValue>): string =>
  `Send estimate ${String(args.estimateId ?? "?")} to the customer — transitions it from draft to sent.`;

const describeNotificationSendInvoiceReminder = (args: Record<string, JsonValue>): string => {
  const channel = typeof args.channel === "string" ? args.channel : "?";
  return `Send an invoice reminder via ${channel} for invoice ${String(args.invoiceId ?? "?")}.`;
};

const describeJobSchedule = (args: Record<string, JsonValue>): string => {
  const title = typeof args.title === "string" && args.title ? ` "${args.title}"` : "";
  const start = typeof args.scheduledStart === "string" ? ` starting ${args.scheduledStart}` : "";
  return `Schedule a new field job${title} for customer ${String(args.leadId ?? "?")}${start}.`;
};

const describeJobAssign = (args: Record<string, JsonValue>): string => {
  if (args.assigneeUserId === null || args.assigneeUserId === undefined) {
    return `Unassign job ${String(args.jobId ?? "?")} from its current crew member.`;
  }
  return `Assign job ${String(args.jobId ?? "?")} to a crew member.`;
};

const describeTaskCreate = (args: Record<string, JsonValue>): string => {
  const text = typeof args.text === "string" ? `"${args.text}"` : "?";
  const due = typeof args.dueDate === "string" ? ` due ${args.dueDate}` : "";
  return `Create task ${text}${due}.`;
};

const describeCustomerCreate = (args: Record<string, JsonValue>): string => {
  const name = typeof args.name === "string" ? `"${args.name}"` : "?";
  return `Create (or return existing) customer ${name}.`;
};

const describeInvoiceDraft = (args: Record<string, JsonValue>): string => {
  const lines = Array.isArray(args.lines) ? (args.lines as readonly JsonValue[]).filter(isRecord) : [];
  const subtotal = lines.reduce((sum: number, l) => {
    const line = l as InvoiceLine;
    return sum + (line.quantity ?? 0) * (line.rateCents ?? 0);
  }, 0);
  const title = typeof args.title === "string" && args.title ? ` "${args.title}"` : "";
  const terms = typeof args.termsDays === "number" ? ` (net ${args.termsDays})` : "";
  return `Draft invoice${title} for customer ${String(args.leadId ?? "?")} — ${lines.length} line item(s), subtotal ${money(subtotal)}${terms}. Creates a DRAFT (not sent until invoice_send).`;
};

const describeInvoiceCreateFromJob = (args: Record<string, JsonValue>): string =>
  `Create a draft invoice from completed job ${String(args.jobId ?? "?")}. Idempotent — calling twice returns the same invoice.`;

const describeScheduleVisit = (args: Record<string, JsonValue>): string => {
  const date = typeof args.scheduledDate === "string" ? args.scheduledDate : "?";
  const start = typeof args.scheduledStart === "string" ? args.scheduledStart : "?";
  const duration = typeof args.durationHours === "number" ? `${args.durationHours}h` : "?";
  return `Add a visit to job ${String(args.jobId ?? "?")} on ${date} at ${start} for ${duration}.`;
};

const describeInvoiceRecordPayment = (args: Record<string, JsonValue>): string => {
  const amount = typeof args.amountCents === "number" ? money(args.amountCents) : "?";
  const method = typeof args.method === "string" ? args.method : "?";
  return `Record a ${amount} ${method} payment on invoice ${String(args.invoiceId ?? "?")}. SENSITIVE: marks money as received.`;
};

const describeInvoiceVoid = (args: Record<string, JsonValue>): string =>
  `Void (cancel) invoice ${String(args.invoiceId ?? "?")}. DESTRUCTIVE — irreversible.`;

const describeTimesheetApproveWeek = (args: Record<string, JsonValue>): string => {
  const dates = Array.isArray(args.dates) ? (args.dates as JsonValue[]).filter((d) => typeof d === "string").join(", ") : "?";
  return `Approve timesheet entries for a crew member on: ${dates}. SENSITIVE: payroll approval.`;
};

// --- job lifecycle -----------------------------------------------------------------------------
// These had no renderer, so the card a person approved read "Run job_complete with input
// {"jobId":"98add6a8-…"}" — the tool's internal name and a raw id, for the commonest action in the
// product. Every mutating tool now has a case; `mutatingToolsAllDescribed` in the test file fails
// the build if a new one arrives without one.

const describeJobStart = (args: Record<string, JsonValue>): string =>
  `Mark job ${String(args.jobId ?? "?")} as started — work is under way.`;

const describeJobComplete = (args: Record<string, JsonValue>): string =>
  `Mark job ${String(args.jobId ?? "?")} COMPLETE — the work is finished. Also closes any visit on it still open.`;

const describeJobCancel = (args: Record<string, JsonValue>): string =>
  `Cancel job ${String(args.jobId ?? "?")} — reason: ${String(args.reason ?? "?")}. The work will not happen.`;

const describeJobReschedule = (args: Record<string, JsonValue>): string =>
  `Move job ${String(args.jobId ?? "?")} to ${String(args.scheduledStart ?? "?")} – ${String(args.scheduledEnd ?? "?")}.`;

const describeVisitPatch = (args: Record<string, JsonValue>): string => {
  const parts = [
    args.assigneeUserId === null ? "unassign the technician" : typeof args.assigneeUserId === "string" ? "change who is going" : null,
    typeof args.scheduledDate === "string" ? `move it to ${args.scheduledDate}` : args.scheduledDate === null ? "take it off the schedule" : null,
    typeof args.scheduledStart === "string" ? `start ${args.scheduledStart}` : null,
  ].filter(Boolean);
  const what = parts.length > 0 ? parts.join(", ") : "update it";
  return `On job ${String(args.jobId ?? "?")}, visit ${String(args.visitId ?? "?")}: ${what}. This is what the board and the technician's day actually show.`;
};

// --- tasks -------------------------------------------------------------------------------------

const describeTaskSetDone = (args: Record<string, JsonValue>): string =>
  args.done === false
    ? `Reopen task ${String(args.taskId ?? "?")}.`
    : `Mark task ${String(args.taskId ?? "?")} done.`;

const describeTaskUpdate = (args: Record<string, JsonValue>): string => {
  const parts = [
    typeof args.text === "string" ? `reword it to "${args.text}"` : null,
    args.dueDate === null ? "clear its due date" : typeof args.dueDate === "string" ? `set it due ${args.dueDate}` : null,
    args.leadId === null ? "unlink its customer" : typeof args.leadId === "string" ? "relink its customer" : null,
  ].filter(Boolean);
  return `Edit task ${String(args.taskId ?? "?")}: ${parts.length > 0 ? parts.join(", ") : "no visible change"}.`;
};

const describeTaskRemove = (args: Record<string, JsonValue>): string =>
  `Delete task ${String(args.taskId ?? "?")}. DESTRUCTIVE — the record that it existed is lost; prefer marking it done.`;

// --- customers and money -----------------------------------------------------------------------

const describeCustomerUpdate = (args: Record<string, JsonValue>): string => {
  // Named, not valued: a phone number or address on an approval card is PII on screen.
  // customerUpdateInput keys its target on `customerId`, not `leadId` — reading the wrong key
  // rendered "Edit customer ?" and listed `customerId` itself as a changed field.
  const fields = Object.keys(args).filter((k) => k !== "customerId");
  return `Edit customer ${String(args.customerId ?? "?")} — changing: ${fields.length > 0 ? fields.join(", ") : "nothing"}.`;
};

const describeInvoiceUpdate = (args: Record<string, JsonValue>): string => {
  const lines = Array.isArray(args.lines) ? (args.lines as readonly JsonValue[]).filter(isRecord) : null;
  const linePart = lines
    ? ` REPLACES all line items with ${lines.length} line(s), total ${money(lines.reduce((sum: number, l) => {
        const line = l as InvoiceLine;
        return sum + (line.quantity ?? 0) * (line.rateCents ?? 0);
      }, 0))}.`
    : "";
  const fields = Object.keys(args).filter((k) => k !== "invoiceId" && k !== "lines");
  return `Edit invoice ${String(args.invoiceId ?? "?")}${fields.length > 0 ? ` — changing: ${fields.join(", ")}` : ""}.${linePart}`;
};

const describeQuoteAccept = (args: Record<string, JsonValue>): string => {
  const tier = typeof args.chosenTier === "string" ? ` (${args.chosenTier} tier)` : "";
  return `Record estimate ${String(args.estimateId ?? "?")} as ACCEPTED${tier} — this also creates the job and puts it on the board.`;
};

const describeQuoteDecline = (args: Record<string, JsonValue>): string =>
  `Record estimate ${String(args.estimateId ?? "?")} as DECLINED — reason: ${String(args.reason ?? "?")}. Moves the lead to lost.`;

export const describeProposal = (tool: string, args: Record<string, JsonValue>): string => {
  switch (tool) {
    case "quote_draft":
      return describeQuoteDraft(args);
    case "invoice_send":
      return describeInvoiceSend(args);
    case "quote_send":
      return describeQuoteSend(args);
    case "notification_send_invoice_reminder":
      return describeNotificationSendInvoiceReminder(args);
    case "job_schedule":
      return describeJobSchedule(args);
    case "job_assign":
      return describeJobAssign(args);
    case "task_create":
      return describeTaskCreate(args);
    case "customer_create":
      return describeCustomerCreate(args);
    case "invoice_draft":
      return describeInvoiceDraft(args);
    case "invoice_create_from_job":
      return describeInvoiceCreateFromJob(args);
    case "schedule_visit":
      return describeScheduleVisit(args);
    case "invoice_record_payment":
      return describeInvoiceRecordPayment(args);
    case "invoice_void":
      return describeInvoiceVoid(args);
    case "timesheet_approve_week":
      return describeTimesheetApproveWeek(args);
    case "job_start":
      return describeJobStart(args);
    case "job_complete":
      return describeJobComplete(args);
    case "job_cancel":
      return describeJobCancel(args);
    case "job_reschedule":
      return describeJobReschedule(args);
    case "visit_patch":
      return describeVisitPatch(args);
    case "task_set_done":
      return describeTaskSetDone(args);
    case "task_update":
      return describeTaskUpdate(args);
    case "task_remove":
      return describeTaskRemove(args);
    case "customer_update":
      return describeCustomerUpdate(args);
    case "invoice_update":
      return describeInvoiceUpdate(args);
    case "quote_accept":
      return describeQuoteAccept(args);
    case "quote_decline":
      return describeQuoteDecline(args);
    default:
      return `Run ${tool} with input ${JSON.stringify(args)}`;
  }
};
