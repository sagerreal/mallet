import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { LlmClient } from "../domain/llm-client";
import { extractJsonFromText } from "./extract-json";

/**
 * AI-draft a before-you-leave checklist for a job type (AI Foreman 1A.4).
 *
 * The owner types a job name ("Water heater replacement") and the model proposes
 * a short list of on-site steps — the standard, drafted. It is SUGGEST-ONLY: the
 * items land in the checklist editor for the owner to edit/remove/save; nothing is
 * written until they save through the normal create path. Mirrors draft-estimate:
 * a single submit tool, parsed from the turn, with a text-fallback. No dollar
 * amounts (a checklist is a work standard, not a price).
 */

// A drafted item — the same {text, type} shape the checklist editor consumes.
// "check" = verify/do a step; "photo" = capture evidence (callback protection).
const draftedItemSchema = z.object({
  text: z.string().min(1).max(200),
  type: z.enum(["check", "photo"]),
});

export type DraftedChecklistItem = z.infer<typeof draftedItemSchema>;

// Cap well under CHECKLIST_MAX_ITEMS (50) — a before-you-leave list is short by
// design; a wall of 40 steps is noise a tech won't run.
const MAX_DRAFTED_ITEMS = 14;

const submitChecklistInputSchema = z.object({
  items: z.array(draftedItemSchema).min(1).max(MAX_DRAFTED_ITEMS),
});

const submitChecklistJsonSchema = (() => {
  const s = z.toJSONSchema(submitChecklistInputSchema) as Record<string, unknown>;
  delete s["$schema"];
  return s;
})();

const buildSystemPrompt = (jobType: string): string =>
  [
    "You are the field standards lead for a home-services trade shop.",
    `Draft a concise "before you leave" checklist a technician runs on a "${jobType}" job.`,
    "",
    "Rules:",
    "- Each item is a short imperative step (≤ ~12 words), in the order a tech works.",
    '- type "check" = verify or do something; type "photo" = capture a photo as evidence.',
    "- Put photo items on the steps that PROTECT THE SHOP — the ones that cause callbacks or",
    "  disputes if skipped (final install condition, pressure/leak test, code clearances, the",
    "  meter/serial, the area left clean). At least one photo item on a typical job.",
    "- Cover safety, the core work, verification, and leave-behind/cleanup.",
    "- NEVER include prices, dollar amounts, or labor hours — a checklist is a work standard.",
    `- ${MAX_DRAFTED_ITEMS} items max; fewer is better if the job is simple.`,
    "",
    "Return the list by calling submit_checklist. Always call the tool.",
  ].join("\n");

const parseSubmitInput = (raw: unknown): DraftedChecklistItem[] | null => {
  const parsed = submitChecklistInputSchema.safeParse(raw);
  return parsed.success ? parsed.data.items : null;
};

export interface ChecklistDraftResult {
  readonly items: DraftedChecklistItem[];
}

/**
 * Draft checklist items for a job type. Throws `TRPCError(BAD_GATEWAY)` if the
 * model returns nothing parseable; propagates `LlmError` for the router to map.
 */
export const draftChecklist = async (
  llm: LlmClient,
  jobType: string,
): Promise<ChecklistDraftResult> => {
  const turn = await llm.next({
    system: buildSystemPrompt(jobType),
    tools: [
      {
        name: "submit_checklist",
        description: "Submit the before-you-leave checklist items. Always call this tool.",
        inputSchema: submitChecklistJsonSchema,
      },
    ],
    messages: [{ role: "user", kind: "text", text: `Job type: ${jobType}` }],
    effort: "low",
  });

  // Primary path: the model called submit_checklist.
  for (const block of turn.blocks) {
    if (block.type === "tool_use" && block.name === "submit_checklist") {
      const items = parseSubmitInput(block.input);
      if (items) return { items };
    }
  }

  // Fallback: model returned text with embedded JSON.
  for (const block of turn.blocks) {
    if (block.type === "text") {
      const items = extractJsonFromText(block.text, parseSubmitInput);
      if (items) return { items };
    }
  }

  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: "the assistant could not draft a checklist — try rephrasing the job type",
  });
};
