import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { LlmClient } from "../domain/llm-client";
import {
  draftLineInputSchema,
  buildRefineBlock,
  parseProposals,
  proposalSchema,
  MAX_PROPOSALS,
} from "./draft-estimate";
import type { EstimateLineDraft, DraftRefineInput, DraftProposal } from "./draft-estimate";
import { extractJsonFromText } from "./extract-json";
import { buildContextBlocks, EMPTY_ESTIMATE_CONTEXT, type EstimateContext } from "./estimate-context";

// ---------------------------------------------------------------------------
// One-shot LLM-powered Good/Better/Best estimate drafter.
// ---------------------------------------------------------------------------
// Mirrors draft-estimate.ts: a single round-trip with a forced
// `submit_tiered_estimate` tool. The tool returns THREE tiers (good/better/
// best, 2–6 lines each, an optional one-line note) plus the key the model
// recommends. Parses the first tool_use block; falls back to parsing the same
// JSON shape out of any text block; throws a clean TRPCError when neither
// path yields a valid payload. Unconfigured (no LLM client wired) throws
// PRECONDITION_FAILED — the guard lives here so it is unit-testable.
// ---------------------------------------------------------------------------

export type DraftTierKey = "good" | "better" | "best";

export interface EstimateTierDraft {
  /** One-line description of what the option covers ("" when the model omitted it). */
  readonly note: string;
  readonly lines: EstimateLineDraft[];
}

export interface EstimateTiersDraft {
  readonly recommended: DraftTierKey;
  readonly good: EstimateTierDraft;
  readonly better: EstimateTierDraft;
  readonly best: EstimateTierDraft;
  /** Refine-extracted durable facts — always [] outside a refine run. */
  readonly proposals: DraftProposal[];
}

// The shape the model is asked to fill in (unit prices in whole USD). Line
// bounds come from draftLineInputSchema — the same caps as the single-line
// drafter, mirroring what the draft boundary + domain accept.
const tierInputSchema = z.object({
  note: z.string().min(1).max(200).optional(),
  lines: z.array(draftLineInputSchema).min(2).max(6),
});

// `proposals` mirrors the single drafter: always optional in the schema, only
// prompted for (and only consumed) on refine runs. This full schema exists for
// the tool's JSON Schema (what the model is shown); parsing splits strict
// tiers from lenient proposals — see parseSubmitInput below.
const submitTieredEstimateInputSchema = z.object({
  recommended: z.enum(["good", "better", "best"]),
  good: tierInputSchema,
  better: tierInputSchema,
  best: tierInputSchema,
  proposals: z.array(proposalSchema).max(MAX_PROPOSALS).optional(),
});

const submitTieredEstimateTiersSchema = z.object({
  recommended: z.enum(["good", "better", "best"]),
  good: tierInputSchema,
  better: tierInputSchema,
  best: tierInputSchema,
});

type TierInput = z.infer<typeof tierInputSchema>;

interface SubmitTieredEstimateInput extends z.infer<typeof submitTieredEstimateTiersSchema> {
  readonly proposals: DraftProposal[];
}

const BASE_SYSTEM_PROMPT = [
  "You are an estimator for a US home/field-service business (HVAC, plumbing, electrical, etc.).",
  "Given a short job description, produce THREE options for the same job:",
  "- good — fix it: the straightforward repair that solves today's problem.",
  "- better — fix it AND prevent it: the repair plus the work that stops it recurring.",
  "- best — replace or upgrade: the long-term replacement/upgrade path.",
  "For each option:",
  "- Separate labor and materials lines (and any other relevant lines).",
  "- Each line should have a clear description, a sensible quantity, and a unit price",
  "  in whole US dollars.",
  "- Do not include tax.",
  "- Return 2–6 lines, plus a one-line note saying what the option covers.",
  "Set `recommended` to the option you would honestly recommend for this job.",
  "",
  "IMPORTANT: You MUST call the submit_tiered_estimate tool with your answer.",
  "Do not write prose — only call the tool.",
].join("\n");

// Same org context as the single drafter (estimate-context.ts) — the tiers used to run on
// "typical trade pricing" alone while the UI claimed pricebook grounding; both drafters now
// consume identical knowledge. The refine block (shared builder) appends the office's
// correction when they're fixing an earlier draft.
const buildSystemPrompt = (context: EstimateContext, refine?: DraftRefineInput): string => {
  const blocks = buildContextBlocks(context);
  const parts = [BASE_SYSTEM_PROMPT];
  if (blocks === "") {
    parts.push("", "This shop has no pricebook yet — price from typical trade pricing.");
  } else {
    parts.push("", blocks);
  }
  if (refine) parts.push("", buildRefineBlock(refine));
  return parts.join("\n");
};

// JSON Schema for the submit_tiered_estimate tool (stripped of $schema for Anthropic).
const submitTieredEstimateJsonSchema = (() => {
  const s = z.toJSONSchema(submitTieredEstimateInputSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const mapTier = (raw: TierInput): EstimateTierDraft => ({
  note: raw.note ?? "",
  lines: raw.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    rateCents: Math.round(l.unitPriceUsd * 100),
  })),
});

const mapTiers = (raw: SubmitTieredEstimateInput, refining: boolean): EstimateTiersDraft => ({
  recommended: raw.recommended,
  good: mapTier(raw.good),
  better: mapTier(raw.better),
  best: mapTier(raw.best),
  // Proposals are a refine-loop feature — dropped when the model volunteers them unprompted.
  proposals: refining ? raw.proposals : [],
});

/**
 * Attempt to parse a SubmitTieredEstimateInput from an arbitrary unknown value.
 * Tiers are strict (null on failure → fallback path); proposals are parsed
 * per-item and invalid ones dropped — shared parseProposals (draft-estimate.ts).
 */
const parseSubmitInput = (raw: unknown): SubmitTieredEstimateInput | null => {
  const result = submitTieredEstimateTiersSchema.safeParse(raw);
  if (!result.success) return null;
  const proposalsRaw =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).proposals : undefined;
  return { ...result.data, proposals: parseProposals(proposalsRaw) };
};

/**
 * Call the LLM once to produce a three-tier (Good/Better/Best) estimate from a
 * plain-English job description. Returns all three tiers (rateCents) plus the
 * model's recommended tier key.
 * Throws `TRPCError(PRECONDITION_FAILED)` when no LLM client is configured and
 * `TRPCError(BAD_GATEWAY)` when the model returns nothing parseable;
 * propagates `LlmError` for the router to map to the appropriate TRPC code.
 */
export const draftEstimateTiers = async (
  llm: LlmClient | null | undefined,
  description: string,
  context: EstimateContext = EMPTY_ESTIMATE_CONTEXT,
  refine?: DraftRefineInput,
): Promise<EstimateTiersDraft> => {
  if (!llm) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
  }

  const turn = await llm.next({
    system: buildSystemPrompt(context, refine),
    tools: [
      {
        name: "submit_tiered_estimate",
        description:
          "Submit the three-option (Good/Better/Best) estimate. Always call this tool.",
        inputSchema: submitTieredEstimateJsonSchema,
      },
    ],
    messages: [{ role: "user", kind: "text", text: description }],
    effort: "low",
  });

  // Primary path: the model called submit_tiered_estimate.
  for (const block of turn.blocks) {
    if (block.type === "tool_use" && block.name === "submit_tiered_estimate") {
      const parsed = parseSubmitInput(block.input);
      if (parsed) return mapTiers(parsed, refine !== undefined);
    }
  }

  // Fallback: model returned text with embedded JSON (shouldn't happen with a
  // well-instructed model + a single tool, but handle gracefully).
  for (const block of turn.blocks) {
    if (block.type === "text") {
      const parsed = extractJsonFromText(block.text, parseSubmitInput);
      if (parsed) return mapTiers(parsed, refine !== undefined);
    }
  }

  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: "AI couldn't draft the three options — try rephrasing",
  });
};
