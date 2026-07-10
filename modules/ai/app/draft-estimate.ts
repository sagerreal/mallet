import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { LlmClient } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";

// ---------------------------------------------------------------------------
// One-shot LLM-powered estimate drafter.
// ---------------------------------------------------------------------------
// Sends a single round-trip to the model with a `submit_estimate` tool and
// instructions to always call it. Parses the first tool_use block; falls back
// to parsing a JSON `{lines:[...]}` out of any text block; throws a clean
// TRPCError if neither path yields a valid payload.
// ---------------------------------------------------------------------------

export interface EstimateLineDraft {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number; // integer cents
}

// The shape the model is asked to fill in (unit prices in whole USD).
const submitEstimateInputSchema = z.object({
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPriceUsd: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(10),
});

type SubmitEstimateInput = z.infer<typeof submitEstimateInputSchema>;

const SYSTEM_PROMPT = [
  "You are an estimator for a US home/field-service business (HVAC, plumbing, electrical, etc.).",
  "Given a short job description, produce a realistic itemised estimate:",
  "- Separate labor and materials lines (and any other relevant lines).",
  "- Each line should have a clear description, a sensible quantity, and a unit price",
  "  in whole US dollars based on typical trade pricing.",
  "- Do not include tax.",
  "- Return 2–6 lines.",
  "",
  "IMPORTANT: You MUST call the submit_estimate tool with your answer.",
  "Do not write prose — only call the tool.",
].join("\n");

// JSON Schema for the submit_estimate tool (stripped of $schema for Anthropic).
const submitEstimateJsonSchema = (() => {
  const s = z.toJSONSchema(submitEstimateInputSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const mapLines = (raw: SubmitEstimateInput): EstimateLineDraft[] =>
  raw.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    rateCents: Math.round(l.unitPriceUsd * 100),
  }));

/** Attempt to parse a SubmitEstimateInput from an arbitrary unknown value. */
const parseSubmitInput = (raw: unknown): SubmitEstimateInput | null => {
  const result = submitEstimateInputSchema.safeParse(raw);
  return result.success ? result.data : null;
};

/**
 * Attempt to extract a `{lines:[...]}` JSON object from a text string.
 * Looks for the first `{` … `}` balanced span that parses + validates.
 */
const extractJsonFromText = (text: string): SubmitEstimateInput | null => {
  // Find all candidate JSON substrings by scanning for `{`.
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j += 1) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    try {
      const candidate: unknown = JSON.parse(text.slice(i, j + 1));
      const parsed = parseSubmitInput(candidate);
      if (parsed) return parsed;
    } catch {
      // not valid JSON — keep scanning
    }
  }
  return null;
};

/**
 * Call the LLM once to produce a structured estimate from a plain-English
 * job description. Returns an array of `EstimateLineDraft` (with rateCents).
 * Throws `TRPCError(BAD_GATEWAY)` if the model returns nothing parseable;
 * propagates `LlmError` for the router to map to the appropriate TRPC code.
 */
export const draftEstimateLines = async (
  llm: LlmClient,
  description: string,
): Promise<EstimateLineDraft[]> => {
  const turn = await llm.next({
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_estimate",
        description: "Submit the itemised estimate lines. Always call this tool.",
        inputSchema: submitEstimateJsonSchema,
      },
    ],
    messages: [{ role: "user", kind: "text", text: description }],
    effort: "low",
  });

  // Primary path: the model called submit_estimate.
  for (const block of turn.blocks) {
    if (block.type === "tool_use" && block.name === "submit_estimate") {
      const parsed = parseSubmitInput(block.input);
      if (parsed) return mapLines(parsed);
    }
  }

  // Fallback: model returned text with embedded JSON (shouldn't happen with a
  // well-instructed model + a single tool, but handle gracefully).
  for (const block of turn.blocks) {
    if (block.type === "text") {
      const parsed = extractJsonFromText(block.text);
      if (parsed) return mapLines(parsed);
    }
  }

  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: "AI couldn't draft an estimate — try rephrasing",
  });
};
