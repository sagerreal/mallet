import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { LlmClient } from "../domain/llm-client";
import { extractJsonFromText } from "./extract-json";

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

// One line of model output, capped to what the draft boundary + domain accept:
// description ≤ 500 chars, quantity ≤ 10,000 at 2-decimal precision (the domain's
// numeric(12,2) guard — EstimateLine.create rejects finer), unit price ≤ $1,000,000.
// Out-of-bounds model output fails the parse here, so it takes the existing
// fallback/BAD_GATEWAY path instead of dying later at the tRPC draft boundary
// (which would silently roll back the optimistic estimate after the redirect).
// Shared with the tiered drafter (draft-estimate-tiers.ts) — one set of caps.
export const draftLineInputSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(10_000).multipleOf(0.01),
  unitPriceUsd: z.number().nonnegative().max(1_000_000),
});

// One line of the org's real pricebook, passed in as retrieval context so the model prices
// from the shop's actual book instead of inventing "typical trade pricing". Bounded top-N —
// the caller (the router) is responsible for capping how many it fetches.
export interface CatalogServiceContext {
  readonly name: string;
  readonly unitPriceCents: number;
  readonly category: string | null;
}

// The shape the model is asked to fill in (unit prices in whole USD).
const submitEstimateInputSchema = z.object({
  lines: z.array(draftLineInputSchema).min(1).max(10),
});

type SubmitEstimateInput = z.infer<typeof submitEstimateInputSchema>;

const BASE_SYSTEM_PROMPT = [
  "You are an estimator for a US home/field-service business (HVAC, plumbing, electrical, etc.).",
  "Given a short job description, produce a realistic itemised estimate:",
  "- Separate labor and materials lines (and any other relevant lines).",
  "- Each line should have a clear description, a sensible quantity, and a unit price",
  "  in whole US dollars.",
  "- Do not include tax.",
  "- Return 2–6 lines.",
  "",
  "IMPORTANT: You MUST call the submit_estimate tool with your answer.",
  "Do not write prose — only call the tool.",
].join("\n");

// Renders the org's pricebook (when non-empty) as a system-prompt block instructing the model
// to price from it, and appends pricing-source rules. Retrieval only — this never triggers an
// extra model call; it just enriches the single existing one.
const buildSystemPrompt = (catalog: readonly CatalogServiceContext[]): string => {
  if (catalog.length === 0) {
    return [BASE_SYSTEM_PROMPT, "", "This shop has no pricebook yet — price from typical trade pricing."].join("\n");
  }
  const catalogLines = catalog.map((s) => {
    const price = (s.unitPriceCents / 100).toFixed(2);
    return s.category ? `- ${s.name} [${s.category}]: $${price}` : `- ${s.name}: $${price}`;
  });
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "## This shop's pricebook",
    "Prefer these exact prices for any line that matches a catalog service below (match by",
    "description/intent, not exact wording). For any line that is NOT in the catalog, prefix its",
    "description with \"Off-book: \" so the office knows to double-check that price, and price it",
    "from typical trade pricing.",
    ...catalogLines,
  ].join("\n");
};

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
 * Call the LLM once to produce a structured estimate from a plain-English
 * job description. Returns an array of `EstimateLineDraft` (with rateCents).
 * When `catalog` is non-empty, the system prompt instructs the model to price
 * from the org's real pricebook (retrieval only — no extra model call).
 * Throws `TRPCError(BAD_GATEWAY)` if the model returns nothing parseable;
 * propagates `LlmError` for the router to map to the appropriate TRPC code.
 */
export const draftEstimateLines = async (
  llm: LlmClient,
  description: string,
  catalog: readonly CatalogServiceContext[] = [],
): Promise<EstimateLineDraft[]> => {
  const turn = await llm.next({
    system: buildSystemPrompt(catalog),
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
      const parsed = extractJsonFromText(block.text, parseSubmitInput);
      if (parsed) return mapLines(parsed);
    }
  }

  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: "AI couldn't draft an estimate — try rephrasing",
  });
};
