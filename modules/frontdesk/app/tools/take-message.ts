import { z } from "zod";
import { Phone, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The topics the office triages. A closed set keeps the derived task text and any downstream
// routing predictable; anything the agent can't map lands in "other".
export const MESSAGE_TOPICS = ["billing", "reschedule", "callback", "commercial", "other"] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number];

// The spoken confirmation on success. Functional, not chatty (house rule) and promises only what the
// office actually does — file it and follow up. No dollar amounts, no arrival-time promise.
export const TAKE_MESSAGE_SPEAK =
  "Got it — I've passed that to the office and they'll get back to you.";

// The source stamped on every lead the voice front desk creates, so the office can see where a
// contact came from. Matches the plan's fixed string.
const VOICE_SOURCE = "AI Front Desk";

// Model-supplied arguments, validated at the boundary. `phone` is optional free text (the caller
// may not leave one); we parse it defensively and fall back to null on garbage — a bad phone must
// never block filing the message.
export const takeMessageInput = z.object({
  caller_name: z.string().min(1),
  phone: z.string().optional(),
  topic: z.enum(MESSAGE_TOPICS),
  details: z.string().min(1),
});
export type TakeMessageInput = z.infer<typeof takeMessageInput>;

// The equivalent JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Kept as
// an explicit literal rather than generated so the model-facing contract is reviewable in one place.
const takeMessageParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    caller_name: { type: "string", description: "The caller's name." },
    phone: { type: "string", description: "The caller's callback number, if they give one." },
    topic: {
      type: "string",
      enum: [...MESSAGE_TOPICS],
      description: "What the message is about, for office routing.",
    },
    details: { type: "string", description: "What the caller wants the office to know or do." },
  },
  required: ["caller_name", "topic", "details"],
  additionalProperties: false,
};

// Build the office-task text from a validated message. One pure helper so the exact wording is
// asserted in a unit test and reused nowhere by copy-paste.
export const buildMessageTaskText = (input: TakeMessageInput): string =>
  `Call from ${input.caller_name} — ${input.topic}: ${input.details}`;

// take_message: the caller wants the office to know something or call back. Ensures a lead exists
// (get-or-create, deduped on phone) and files a task linked to that lead. Expected use-case failures
// return a spoken fallback rather than throw — the runner's try/catch covers unexpected throws.
export const takeMessageTool: VoiceTool = {
  name: "take_message",
  description:
    "Take a message for the office and promise a callback. Use for billing questions, " +
    "reschedule/cancel requests, general callbacks, commercial enquiries, or anything the AI " +
    "should not handle directly.",
  parameters: takeMessageParameters,
  input: takeMessageInput,

  async handle(rawInput: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult> {
    const input = takeMessageInput.parse(rawInput);
    const phone = parsePhone(input.phone);

    const ensured = await ctx.deps.ensureCustomer.exec({
      name: input.caller_name,
      phone,
      email: null,
      source: VOICE_SOURCE,
      companyId: null,
      role: null,
      notes: null,
      address: null,
    });
    if (!isOk(ensured)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "take_message", error: ensured.error.message },
        "frontdesk.take_message.ensure_customer_failed",
      );
      return { speak: TAKE_MESSAGE_SPEAK, data: { topic: input.topic, filed: false } };
    }

    const task = await ctx.deps.createTask.exec(
      { leadId: ensured.value.lead.props.id, text: buildMessageTaskText(input), dueDate: null },
      ctx.orgId,
    );
    if (!isOk(task)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "take_message", error: task.error.message },
        "frontdesk.take_message.create_task_failed",
      );
      return { speak: TAKE_MESSAGE_SPEAK, data: { topic: input.topic, filed: false } };
    }

    logger.info(
      { orgId: ctx.orgId, tool: "take_message", leadId: ensured.value.lead.props.id, topic: input.topic },
      "frontdesk.take_message.filed",
    );
    return { speak: TAKE_MESSAGE_SPEAK, data: { topic: input.topic, filed: true } };
  },
};

// Parse a caller-supplied phone into E.164, or null when absent/invalid. A bad number is logged (no
// silent swallow) but never fatal — the message must still be filed.
const parsePhone = (raw: string | undefined): Phone | null => {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = Phone.parse(raw);
  if (isOk(parsed)) return parsed.value;
  logger.info({ tool: "take_message" }, "frontdesk.take_message.invalid_phone");
  return null;
};
