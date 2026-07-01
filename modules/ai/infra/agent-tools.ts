import { z } from "zod";
import { toPage, isOk, asLeadId, asInvoiceId } from "@mallet/shared/types";
import { ListLeadsUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { ListInvoicesUseCase, DrizzleInvoiceRepository, SendInvoiceUseCase } from "@mallet/invoicing";
import { ListEstimatesUseCase, DrizzleEstimateRepository, DraftEstimateUseCase } from "@mallet/quoting";
import type { AgentTool, ToolContext, ToolOutcome } from "../domain/tool";
import { ENTITY_NOT_FOUND } from "../domain/tool";

// MCP-shaped tool registry: each tool reuses the SAME use-case the tRPC API calls, constructed from
// the per-call tenant tx (one business-logic surface). Read tools run unattended; mutating:true tools
// pause for human approval before the loop ever executes them. Summaries return human names + INV-/
// EST- numbers and the ids the model needs to chain. Tenant scoping is enforced by ctx (withTenant);
// org/tenant fields never appear in an input schema.

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema; // Anthropic input_schema wants the bare object
  return s;
};

const invalid = (issues: z.ZodError["issues"]): ToolOutcome => ({
  ok: false,
  error: `invalid input: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
});

// --- input schemas (also the model-facing JSON schema) ---
const listInput = z.object({ limit: z.number().int().min(1).max(50).optional() });
const invoiceListInput = listInput.extend({ status: z.enum(["draft", "sent", "partial", "paid", "void"]).optional() });
const estimateListInput = listInput.extend({ status: z.enum(["draft", "sent", "accepted", "declined"]).optional() });
// Upper bounds keep a frozen proposal (and any model-supplied input) inside sane business limits —
// a confirm-token can't commit an absurd 10,000-line or $10M-rate estimate.
const quoteDraftInput = z.object({
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
const invoiceSendInput = z.object({ invoiceId: z.string().uuid() });

const customerListTool: AgentTool = {
  name: "customer_list",
  description: "List the org's customers/leads (most recent first). Returns each customer's name, phone, stage, and id. Use the id to reference a customer in other tools.",
  inputSchema: jsonSchema(listInput),
  input: listInput,
  mutating: false,
  async handle(input, ctx: ToolContext): Promise<ToolOutcome> {
    const parsed = listInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListLeadsUseCase(new DrizzleLeadRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
    });
    if (page.items.length === 0) return { ok: true, summary: "No customers found." };
    return {
      ok: true,
      summary: page.items.map((l) => `${l.props.name} — ${l.props.phone ?? "no phone"} — stage ${l.props.stage} [id: ${l.props.id}]`).join("\n"),
    };
  },
};

const invoiceListTool: AgentTool = {
  name: "invoice_list",
  description: "List the org's invoices (most recent first), optionally filtered by status. Returns each invoice's number, status, total, and balance due, with its id.",
  inputSchema: jsonSchema(invoiceListInput),
  input: invoiceListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListInvoicesUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.status ? { status: parsed.data.status } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No invoices found." };
    return {
      ok: true,
      summary: page.items.map((inv) => `${inv.props.num} — ${inv.props.status} — total ${money(inv.props.total)}, due ${money(inv.due())} [id: ${inv.props.id}]`).join("\n"),
    };
  },
};

const estimateListTool: AgentTool = {
  name: "estimate_list",
  description: "List the org's estimates/quotes (most recent first), optionally filtered by status. Returns each estimate's number, status, and total, with its id.",
  inputSchema: jsonSchema(estimateListInput),
  input: estimateListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = estimateListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListEstimatesUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.status ? { status: parsed.data.status } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No estimates found." };
    return { ok: true, summary: page.items.map((e) => `${e.props.num} — ${e.props.status} — total ${money(e.total())} [id: ${e.props.id}]`).join("\n") };
  },
};

const quoteDraftTool: AgentTool = {
  name: "quote_draft",
  description: "Draft a new estimate/quote for a customer (found via customer_list). Provide line items; tax and deposit are optional percentages in basis points (1000 = 10%). Creates a DRAFT — it is not sent to the customer until separately sent.",
  inputSchema: jsonSchema(quoteDraftInput),
  input: quoteDraftInput,
  mutating: true,
  // What the human approved is "a quote for THIS customer" — if the lead is renamed/re-staged (or
  // vanishes) between propose and confirm, the confirm gate refuses and asks for a fresh proposal.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = quoteDraftInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = quoteDraftInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Verify the customer exists (matches invoice_send's not-found handling) so a bad/typo'd leadId
    // is a clean, self-correctable error rather than a masked FK-violation throw — this guards the
    // in-process agent path too, not just the MCP propose-leg refusal.
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.leadId} not found — use customer_list to find the right id` };
    const uc = new DraftEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      leadId: asLeadId(parsed.data.leadId),
      title: parsed.data.title ?? null,
      discBps: 0,
      taxBps: parsed.data.taxBps ?? 0,
      depBps: parsed.data.depBps ?? 0,
      validDays: null,
      lines: parsed.data.lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: l.rateCents, costCents: 0, isOptional: l.isOptional ?? false, needsPhoto: false })),
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Drafted estimate ${result.value.props.num} — total ${money(result.value.total())} (id: ${result.value.props.id}).` };
  },
};

const invoiceSendTool: AgentTool = {
  name: "invoice_send",
  description: "Mark an invoice as sent to the customer (found via invoice_list). This transitions the invoice to 'sent' and starts its payment terms.",
  inputSchema: jsonSchema(invoiceSendInput),
  input: invoiceSendInput,
  mutating: true,
  // The human approved sending THIS invoice at THIS total/status — if it was edited, paid against,
  // or voided between propose and confirm, the confirm gate refuses rather than send stale terms.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceSendInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const invoice = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return invoice ? `invoice:${invoice.props.id}:${invoice.props.status}:${invoice.props.total}:${invoice.props.amountPaid}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceSendInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new SendInvoiceUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ invoiceId: asInvoiceId(parsed.data.invoiceId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Sent invoice ${result.value.props.num}.` };
  },
};

// The curated tool surface. Grow it as real field-service tasks reveal gaps — not one tool per API.
export const buildAgentTools = (): AgentTool[] => [customerListTool, invoiceListTool, estimateListTool, quoteDraftTool, invoiceSendTool];
