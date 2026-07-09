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
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().max(10_000),
        rateCents: z.number().int().min(0).max(10_000_000),
        isOptional: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
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
