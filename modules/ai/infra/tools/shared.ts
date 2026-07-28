import { z } from "zod";
import type { ToolOutcome } from "../../domain/tool";

// ---------------------------------------------------------------------------
// Shared helpers and input schemas used across read-tools and write-tools.
// ---------------------------------------------------------------------------

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema; // Anthropic input_schema wants the bare object
  return s;
};

export const invalid = (issues: z.ZodError["issues"]): ToolOutcome => ({
  ok: false,
  error: `invalid input: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
});

// --- shared base schemas ---
export const listInput = z.object({ limit: z.number().int().min(1).max(50).optional() });
export const invoiceListInput = listInput.extend({ status: z.enum(["draft", "sent", "partial", "paid", "void"]).optional() });
export const estimateListInput = listInput.extend({ status: z.enum(["draft", "sent", "accepted", "declined"]).optional() });

// --- read tool input schemas ---
export const customerGetInput = z.object({ customerId: z.string().uuid() });
// Lookup by the thing a shop actually has in hand. LeadRepository.findByPhone has always existed
// and no tool reached it, so "who is calling from 781-385-0591" had no answer and customer_get
// accepted only a UUID nobody says out loud.
export const customerFindInput = z.object({ phone: z.string().min(7).max(32) });
// Reassigning or re-timing a VISIT. job_assign sets jobs.assignee_user_id, which the dispatch
// board, the Jobs list and a tech's day do NOT read — they read the visit. So "put Mike on
// tomorrow's Henderson job" through job_assign changed a field nobody looks at while answering
// "assigned", and the wrong tech turned up.
export const quoteAcceptInput = z.object({
  estimateId: z.string().uuid(),
  // Good/Better/Best. Omitted on a tiered quote the domain defaults to the RECOMMENDED tier,
  // which is the office accept path; rejected outright on a single-format quote.
  chosenTier: z.enum(["good", "better", "best"]).optional(),
});
export const quoteDeclineInput = z.object({
  estimateId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
export const visitPatchInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  // Every field optional; null CLEARS it (unplacing a visit back to the unscheduled pile is a
  // real dispatch action, not a mistake).
  assigneeUserId: z.string().uuid().nullable().optional(),
  scheduledDate: z.string().max(10).nullable().optional(),
  scheduledStart: z.string().max(8).nullable().optional(),
  scheduledEnd: z.string().max(8).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export const estimateGetInput = z.object({ estimateId: z.string().uuid() });
export const invoiceGetInput = z.object({ invoiceId: z.string().uuid() });
export const jobListInput = listInput.extend({ status: z.enum(["scheduled", "in_progress", "complete", "canceled"]).optional() });
export const jobGetInput = z.object({ jobId: z.string().uuid() });
export const taskListInput = listInput.extend({ done: z.boolean().optional() });
export const memberListInput = z.object({});
export const companyListInput = listInput;
export const companyGetInput = z.object({ companyId: z.string().uuid() });
export const timesheetListInput = listInput.extend({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const notificationDueRemindersInput = listInput;

// --- write tool input schemas ---
// Upper bounds keep a frozen proposal inside sane business limits.
export const quoteDraftInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().max(200).optional(),
  taxBps: z.number().int().min(0).max(10_000).optional(),
  depBps: z.number().int().min(0).max(10_000).optional(),
  // Discount in basis points (500 = 5%). Was hardcoded to 0, so the agent could not honour "give
  // them 10% off" on a quote it was otherwise building correctly.
  discBps: z.number().int().min(0).max(10_000).optional(),
  // How long the quote stands. Hardcoded null, so every agent-drafted quote was open-ended.
  validDays: z.number().int().min(1).max(365).optional(),
  // Good/Better/Best. The whole tiered format was unreachable: the agent could READ a tiered quote
  // and had no way to produce one. Set recommendedTier to make the quote tiered — the domain then
  // requires every line to carry a tier.
  recommendedTier: z.enum(["good", "better", "best"]).optional(),
  tierNames: z
    .object({ good: z.string().max(60), better: z.string().max(60), best: z.string().max(60) })
    .optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().max(10_000),
        rateCents: z.number().int().min(0).max(10_000_000),
        // Cost, for margin. Hardcoded 0, so every agent-drafted job reported 100% margin.
        costCents: z.number().int().min(0).max(10_000_000).optional(),
        isOptional: z.boolean().optional(),
        tier: z.enum(["good", "better", "best"]).optional(),
      }),
    )
    .min(1)
    .max(100),
});
// Correcting an OPEN invoice in place. Without this the only way to change net terms or fix a
// wrong line was void-and-redraft, which burns an invoice number and leaves a void row in the
// ledger for what was a typo.
export const invoiceUpdateInput = z.object({
  invoiceId: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  termsDays: z.number().int().min(0).max(365).optional(),
  depositPaidCents: z.number().int().min(0).max(100_000_000).optional(),
  // FULL replacement set when supplied — the use case replaces the display lines wholesale, so a
  // partial list silently deletes the rest. The tool description says so in those words.
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().max(10_000),
        rateCents: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
});
// Editing an existing customer. customer_create could only create; a changed phone or a new
// address had no path at all.
export const customerUpdateInput = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  role: z.string().max(100).nullable().optional(),
});
export const invoiceSendInput = z.object({ invoiceId: z.string().uuid() });
export const quoteSendInput = z.object({ estimateId: z.string().uuid() });
export const notificationSendInvoiceReminderInput = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(["sms", "email"]),
});
export const jobScheduleInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().max(200).optional(),
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  scheduledEnd: z.string().datetime({ offset: true }).optional(),
  assigneeUserId: z.string().uuid().optional(),
});
export const jobAssignInput = z.object({
  jobId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});
export const taskCreateInput = z.object({
  text: z.string().min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
});
export const customerCreateInput = z.object({
  name: z.string().min(1).max(200),
  // EnsureCustomerUseCase has always accepted these four; the tool hardcoded them to null, so a
  // customer created by the agent had no way to be phoned, emailed or driven to. For a service
  // business that is not a partial record, it is an unusable one — and the assistant reported it
  // as "there is no address field", which is false: leads.address exists.
  phone: z.string().max(32).optional().nullable(),
  email: z.string().max(320).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  source: z.string().max(100).optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  role: z.string().max(100).optional().nullable(),
});
export const invoiceDraftInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().max(200).optional().nullable(),
  termsDays: z.number().int().min(0).max(365).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().max(10_000),
        rateCents: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(100),
});
export const invoiceCreateFromJobInput = z.object({ jobId: z.string().uuid() });
export const scheduleVisitInput = z.object({
  jobId: z.string().uuid(),
  assigneeUserId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledStart: z.string().regex(/^\d{2}:\d{2}$/),
  durationHours: z.number().positive().max(24),
});

// --- sensitive write tool input schemas (Phase C) ---
// NOTE: idempotencyKey is NOT in the model-facing schema — it is minted SERVER-SIDE at propose time
// via enrichArgs and frozen into the stored args. A re-confirm replays the same stored key so the
// underlying ON CONFLICT DO NOTHING guard prevents any double-charge.
export const invoiceRecordPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().min(1).max(100_000_000),
  method: z.enum(["cash", "check", "card", "ach", "card_terminal"]),
});
// Internal schema used by handle() after enrichArgs injects the key at propose time.
export const invoiceRecordPaymentWithKeyInput = invoiceRecordPaymentInput.extend({
  idempotencyKey: z.string().uuid(),
});
export const invoiceVoidInput = z.object({ invoiceId: z.string().uuid() });
export const timesheetApproveWeekInput = z.object({
  techUserId: z.string().uuid(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(7),
});
