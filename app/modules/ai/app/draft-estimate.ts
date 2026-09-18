import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { LlmClient } from "../domain/llm-client";
import { extractJsonFromText } from "./extract-json";
import { buildContextBlocks, EMPTY_ESTIMATE_CONTEXT, type EstimateContext } from "./estimate-context";

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

// ---- refine loop -------------------------------------------------------------

/** The office's correction to an earlier draft: the lines they saw + what's wrong. */
export interface DraftRefineInput {
  readonly previousLines: readonly EstimateLineDraft[];
  readonly feedback: string;
}

/**
 * A durable fact the model extracted from the correction — rendered as a
 * one-tap chip in the composer ("Update 'X' labor to 5h in your pricebook?").
 * labor_hours → pricebook write-back (L1); rule → quoting_rules (L2).
 */
export type DraftProposal =
  | { readonly kind: "labor_hours"; readonly serviceName: string; readonly hours: number }
  | { readonly kind: "rule"; readonly rule: string };

export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("labor_hours"),
    serviceName: z.string().min(1).max(200),
    hours: z.number().positive().max(1_000),
  }),
  z.object({ kind: z.literal("rule"), rule: z.string().min(1).max(300) }),
]);

/** Most proposals a single refine run may carry into the composer. */
export const MAX_PROPOSALS = 5;

/**
 * Lenient proposal parse, shared by both drafters. Proposals are an optional
 * side-channel — a malformed one must never cost the office the (valid)
 * regenerated lines it already paid the model for. Each item is parsed
 * individually: invalid items are dropped, valid ones kept (capped at
 * MAX_PROPOSALS); a non-array payload yields [].
 */
export const parseProposals = (raw: unknown): DraftProposal[] => {
  if (!Array.isArray(raw)) return [];
  const valid: DraftProposal[] = [];
  for (const item of raw) {
    if (valid.length >= MAX_PROPOSALS) break;
    const parsed = proposalSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
};

/** Renders the refine block appended to either drafter's prompt. */
export const buildRefineBlock = (refine: DraftRefineInput): string => {
  const rows = refine.previousLines
    .slice(0, 30)
    .map((l) => `- ${l.description.slice(0, 160)} ×${l.quantity} @ $${(l.rateCents / 100).toFixed(2)}`);
  return [
    "## Refine an earlier draft",
    "The office reviewed your previous draft and gave a correction. Regenerate the FULL",
    "estimate with the correction applied (keep everything that was right).",
    "Previous draft:",
    ...rows,
    `Correction from the office: "${refine.feedback.slice(0, 1_000)}"`,
    "",
    "If — and only if — the correction states a durable, service-general fact (a labor-hours",
    "or pricing norm for a service, or a standing rule for jobs like this), ALSO return it in",
    "`proposals`: {kind:'labor_hours', serviceName, hours} for a pricebook scalar, or",
    "{kind:'rule', rule} for a one-sentence conditional. Job-specific details (this customer,",
    "this address, this one unit) are NOT proposals. When in doubt, return none.",
  ].join("\n");
};

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
// Deliberately customer-facing fields only: no cost basis, no markup (Owen's call).
export interface CatalogServiceContext {
  readonly name: string;
  readonly unitPriceCents: number;
  readonly category: string | null;
  readonly laborHours: number | null;
}

// The shape the model is asked to fill in (unit prices in whole USD). `proposals`
// carries durable facts extracted from a refine correction — always optional in
// the schema, but only consumed (and only prompted for) on refine runs.
// NOTE: this full schema exists for the tool's JSON Schema (what the model is
// shown). Parsing is split: LINES are strict (an unusable draft must fail into
// the fallback/BAD_GATEWAY path), PROPOSALS are lenient (parseProposals drops
// invalid items instead of sinking the run).
const submitEstimateInputSchema = z.object({
  lines: z.array(draftLineInputSchema).min(1).max(10),
  proposals: z.array(proposalSchema).max(MAX_PROPOSALS).optional(),
});

const submitEstimateLinesSchema = z.object({
  lines: z.array(draftLineInputSchema).min(1).max(10),
});

interface SubmitEstimateInput {
  readonly lines: z.infer<typeof draftLineInputSchema>[];
  readonly proposals: DraftProposal[];
}

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

// Renders the full org context (job info, pricebook, labor rates, rules, won quotes) after the
// base instructions, plus the refine block when the office is correcting an earlier draft.
// Retrieval only — this never triggers an extra model call; it just enriches the single
// existing one. Block building lives in estimate-context.ts (shared with the tiered drafter
// so both price from the same knowledge).
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

/**
 * Attempt to parse a SubmitEstimateInput from an arbitrary unknown value.
 * Lines are strict (null on failure → fallback path); proposals are parsed
 * per-item and invalid ones dropped — see parseProposals.
 */
const parseSubmitInput = (raw: unknown): SubmitEstimateInput | null => {
  const result = submitEstimateLinesSchema.safeParse(raw);
  if (!result.success) return null;
  const proposalsRaw =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).proposals : undefined;
  return { lines: result.data.lines, proposals: parseProposals(proposalsRaw) };
};

/** One draft run's outcome: the lines, plus refine-extracted proposals (empty outside refine). */
export interface EstimateDraftResult {
  readonly lines: EstimateLineDraft[];
  readonly proposals: DraftProposal[];
}

// Proposals are a refine-loop feature: outside a refine run the model was never
// instructed to extract them, so anything it volunteers is dropped.
const toResult = (raw: SubmitEstimateInput, refining: boolean): EstimateDraftResult => ({
  lines: mapLines(raw),
  proposals: refining ? raw.proposals : [],
});

/**
 * Call the LLM once to produce a structured estimate from a plain-English
 * job description. Returns the drafted lines (rateCents) plus any durable-fact
 * `proposals` when `refine` carried an office correction.
 * `context` carries the org's real knowledge (job info, pricebook, labor
 * rates, rules, won quotes) — retrieval only, no extra model call.
 * Throws `TRPCError(BAD_GATEWAY)` if the model returns nothing parseable;
 * propagates `LlmError` for the router to map to the appropriate TRPC code.
 */
export const draftEstimateLines = async (
  llm: LlmClient,
  description: string,
  context: EstimateContext = EMPTY_ESTIMATE_CONTEXT,
  refine?: DraftRefineInput,
): Promise<EstimateDraftResult> => {
  const turn = await llm.next({
    system: buildSystemPrompt(context, refine),
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
      if (parsed) return toResult(parsed, refine !== undefined);
    }
  }

  // Fallback: model returned text with embedded JSON (shouldn't happen with a
  // well-instructed model + a single tool, but handle gracefully).
  for (const block of turn.blocks) {
    if (block.type === "text") {
      const parsed = extractJsonFromText(block.text, parseSubmitInput);
      if (parsed) return toResult(parsed, refine !== undefined);
    }
  }

  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: "AI couldn't draft an estimate — try rephrasing",
  });
};
