import { z } from "zod";
import { Phone, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The spoken confirmation on success — functional, not chatty (house rule). Promises only what the
// office actually does: text back a written quote. No dollar amounts (the AI never prices a quote —
// the estimator drafts it from the lead), no arrival-time promise.
export const REQUEST_QUOTE_SPEAK =
  "I've got the details — the office will text you a written quote shortly.";

// The source stamped on every lead the voice front desk creates (matches take_message + book_visit).
const VOICE_SOURCE = "AI Front Desk";

// Appended to the quote task text when the caller left no valid phone, so the office knows to reach
// them another way before the estimator drafts.
export const NO_PHONE_NOTE = "(no valid phone captured)";

// Model-supplied arguments, validated at the boundary. `phone` is required free text (a written
// quote goes to a number), but a garbage value must never block capturing the lead + quote task —
// we parse defensively and fall back to null, noting it in the task so the office follows up.
export const requestQuoteInput = z.object({
  caller_name: z.string().min(1),
  phone: z.string(),
  address: z.string().optional(),
  scope_details: z.string().min(1),
});
export type RequestQuoteInput = z.infer<typeof requestQuoteInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal so
// the model-facing contract is reviewable in one place (matches the house style of the other tools).
const requestQuoteParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    caller_name: { type: "string", description: "The caller's full name." },
    phone: { type: "string", description: "The caller's number for the written quote." },
    address: { type: "string", description: "The service address, if the caller gives one." },
    scope_details: {
      type: "string",
      description: "What the caller wants quoted, in their own words — the job's scope.",
    },
  },
  required: ["caller_name", "phone", "scope_details"],
  additionalProperties: false,
};

// Build the office quote-task text. Pure helper so the exact wording is asserted in a unit test and
// never copy-pasted. `hasPhone` false appends the missing-number note so the office can chase it.
export const buildQuoteTaskText = (scopeDetails: string, hasPhone: boolean): string =>
  hasPhone ? `Quote request — ${scopeDetails}` : `Quote request — ${scopeDetails} ${NO_PHONE_NOTE}`;

// request_quote: the caller wants a written quote for a job the AI does not price. Ensures a lead
// (get-or-create, deduped on phone) and files a quote task linked to it — the task IS the office
// queue the estimator drafts from. The tool NAME (not any result.data) is what disposition.ts maps
// to quote_request, so `data` stays empty. A bad phone still captures the lead (null phone) + a task
// that notes it, so no request is dropped. Expected use-case failures return a spoken fallback
// rather than throw — the runner's try/catch is the backstop for unexpected throws.
export const requestQuoteTool: VoiceTool = {
  name: "request_quote",
  description:
    "Capture a written-quote request for a job the AI should not price on the call (big or " +
    "custom work). Use once you have the caller's name, number, and what they want quoted; the " +
    "office texts back a written quote.",
  parameters: requestQuoteParameters,
  input: requestQuoteInput,

  async handle(rawInput: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult> {
    // The runner already validated args against `input`; narrow the already-validated object.
    const input = rawInput as RequestQuoteInput;
    const phone = parsePhone(input.phone);

    const ensured = await ctx.deps.ensureCustomer.exec({
      name: input.caller_name,
      phone,
      email: null,
      source: VOICE_SOURCE,
      companyId: null,
      role: null,
      notes: input.scope_details,
      address: input.address ?? null,
    });
    if (!isOk(ensured)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "request_quote", error: ensured.error.message },
        "frontdesk.request_quote.ensure_customer_failed",
      );
      return { speak: REQUEST_QUOTE_SPEAK, data: {} };
    }

    const task = await ctx.deps.createTask.exec(
      {
        leadId: ensured.value.lead.props.id,
        text: buildQuoteTaskText(input.scope_details, phone !== null),
        dueDate: null,
      },
      ctx.orgId,
    );
    if (!isOk(task)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "request_quote", error: task.error.message },
        "frontdesk.request_quote.create_task_failed",
      );
      return { speak: REQUEST_QUOTE_SPEAK, data: {} };
    }

    logger.info(
      { orgId: ctx.orgId, tool: "request_quote", leadId: ensured.value.lead.props.id, hasPhone: phone !== null },
      "frontdesk.request_quote.filed",
    );
    return { speak: REQUEST_QUOTE_SPEAK, data: {} };
  },
};

// Parse a caller-supplied phone into E.164, or null when invalid. A bad number is logged (no silent
// swallow) but never fatal — the quote request must still be captured for the office to follow up.
const parsePhone = (raw: string): Phone | null => {
  if (raw.trim().length === 0) return null;
  const parsed = Phone.parse(raw);
  if (isOk(parsed)) return parsed.value;
  logger.info({ tool: "request_quote" }, "frontdesk.request_quote.invalid_phone");
  return null;
};
