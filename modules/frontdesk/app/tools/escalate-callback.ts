import { z } from "zod";
import { Phone, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The spoken confirmation on success — functional, not chatty (house rule). Promises only what
// the office actually does: flag it and call back. No dollar amounts, no arrival-time promise,
// no "I" as a subject (the AI is a router here, not a person making a commitment).
export const ESCALATE_CALLBACK_SPEAK =
  "I've flagged this for the office — someone will call you back shortly.";

// The source stamped on every lead the voice front desk creates (matches the other voice tools).
const VOICE_SOURCE = "AI Front Desk";

// Model-supplied arguments, validated at the boundary. `phone` is optional free text (the caller
// may not have one handy); we parse it defensively and fall back to null — a bad phone must never
// block filing the callback task.
export const escalateCallbackInput = z.object({
  caller_name: z.string().min(1),
  phone: z.string().optional(),
  reason: z.string().min(1),
});
export type EscalateCallbackInput = z.infer<typeof escalateCallbackInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal
// so the model-facing contract is reviewable in one place (matches the house style of other tools).
const escalateCallbackParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    caller_name: { type: "string", description: "The caller's name." },
    phone: { type: "string", description: "The caller's callback number, if they give one." },
    reason: {
      type: "string",
      description:
        "Why the AI is handing off — insurance/claim/warranty, out-of-scope, same-day emergency " +
        "with no slot, or the caller asked for a person.",
    },
  },
  required: ["caller_name", "reason"],
  additionalProperties: false,
};

// Build the HIGH-PRIORITY callback task text from validated input. Pure helper so the exact
// wording is asserted in a unit test and reused nowhere by copy-paste. The "CALL BACK — " prefix
// is the urgency convention (the tasks domain has NO priority field), matching emergencyTaskText's
// "EMERGENCY — " pattern.
export const buildCallbackTaskText = (
  input: Pick<EscalateCallbackInput, "caller_name" | "reason">,
): string => `CALL BACK — ${input.caller_name}: ${input.reason}`;

// escalate_callback: the AI cannot handle the request and a human must call back. Ensures a lead
// exists (get-or-create, deduped on phone) and files a HIGH-PRIORITY callback task linked to that
// lead. Expected use-case failures return a spoken fallback rather than throw — the runner's
// try/catch covers unexpected throws. The disposition derives from the tool NAME (not `data`).
export const escalateCallbackTool: VoiceTool = {
  name: "escalate_callback",
  description:
    "Flag a caller for a human callback when the AI cannot help — insurance/claim/warranty " +
    "questions, out-of-scope services, same-day emergencies with no available slot, or the " +
    "caller explicitly asks to speak with a person. Files a CALL BACK task in the office queue.",
  parameters: escalateCallbackParameters,
  input: escalateCallbackInput,

  async handle(rawInput: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult> {
    // The runner already validated args against `input` (this tool's zod schema) and passes the
    // parsed value, so we narrow the already-validated object rather than re-parsing.
    const input = rawInput as EscalateCallbackInput;
    const phone = parsePhone(input.phone);

    const ensured = await ctx.deps.ensureCustomer.exec({
      name: input.caller_name,
      phone,
      email: null,
      source: VOICE_SOURCE,
      companyId: null,
      role: null,
      notes: input.reason,
      address: null,
    });
    if (!isOk(ensured)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "escalate_callback", error: ensured.error.message },
        "frontdesk.escalate_callback.ensure_customer_failed",
      );
      return { speak: ESCALATE_CALLBACK_SPEAK, data: { filed: false } };
    }

    const task = await ctx.deps.createTask.exec(
      { leadId: ensured.value.lead.props.id, text: buildCallbackTaskText(input), dueDate: null },
      ctx.orgId,
    );
    if (!isOk(task)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "escalate_callback", error: task.error.message },
        "frontdesk.escalate_callback.create_task_failed",
      );
      return { speak: ESCALATE_CALLBACK_SPEAK, data: { filed: false } };
    }

    logger.info(
      { orgId: ctx.orgId, tool: "escalate_callback", leadId: ensured.value.lead.props.id },
      "frontdesk.escalate_callback.filed",
    );
    return { speak: ESCALATE_CALLBACK_SPEAK, data: { filed: true } };
  },
};

// Parse a caller-supplied phone into E.164, or null when absent/invalid. A bad number is logged
// (no silent swallow) but never fatal — the callback task must still be filed.
const parsePhone = (raw: string | undefined): Phone | null => {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = Phone.parse(raw);
  if (isOk(parsed)) return parsed.value;
  logger.info({ tool: "escalate_callback" }, "frontdesk.escalate_callback.invalid_phone");
  return null;
};
