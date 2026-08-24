import type { TenantTx } from "@mallet/shared/db/tx";
import type { AgentTool, ToolContext, ToolOutcome } from "../domain/tool";
import type { ExecuteTool } from "./run-agent-turn";

/**
 * modules/ai/app/build-execute-tool.ts
 * THE one tool executor. Every driver of the loop — the in-app assistant, the SMS agent, the
 * durable task runner — must go through this, because the alternative is four copies that
 * already disagree about when enrichArgs runs and whether a replay is possible.
 *
 * In app/, not api/: a unit test cannot import a router (@/trpc/init pulls the config validator,
 * which throws with no env).
 *
 * Returns `ExecuteTool` directly (not a parallel type) — the loop's executor signature already
 * carries the tool_use id as its third argument, so there is nothing left for a wrapper type to add.
 */

/** Markers around content Mallet did not author. The system prompt names them explicitly. */
export const TOOL_RESULT_OPEN = "<<<UNTRUSTED_RECORD_DATA>>>";
export const TOOL_RESULT_CLOSE = "<<<END_UNTRUSTED_RECORD_DATA>>>";

/** What the durable driver supplies to make a tool call replay-safe. */
export interface ExecutionLedger {
  find(toolUseId: string): Promise<{ readonly ok: boolean; readonly summary: string } | null>;
  record(
    tx: TenantTx,
    execution: {
      readonly toolUseId: string;
      readonly tool: string;
      readonly ok: boolean;
      readonly summary: string;
    },
  ): Promise<void>;
}

export interface BuildExecuteToolParams {
  readonly tools: readonly AgentTool[];
  /** Opens the short per-call tenant transaction and builds the ToolContext. Injected so this
   *  module has no database import and can be unit-tested. */
  readonly runInTenant: <T>(fn: (ctx: ToolContext) => Promise<T>) => Promise<T>;
  /** Wrap results in the untrusted markers. On for the durable runner; off for the surfaces
   *  a human is watching, so their behaviour and their tests are untouched. */
  readonly delimitResults?: boolean;
  readonly ledger?: ExecutionLedger;
}

/**
 * A short, obviously-inert stand-in for a boundary marker found INSIDE a tool's own summary.
 * Never equal to either real marker, so it can never itself be mistaken for a boundary.
 */
const NEUTRALIZED_MARKER = "[neutralized-marker]";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPEN_PATTERN = new RegExp(escapeRegExp(TOOL_RESULT_OPEN), "gi");
const CLOSE_PATTERN = new RegExp(escapeRegExp(TOOL_RESULT_CLOSE), "gi");

/**
 * Neutralises any occurrence of either boundary marker that the record itself contains
 * (case-insensitive), BEFORE the real markers are added. Without this, attacker-controlled text
 * — e.g. a lead's `notes` field, `z.string().max(2000)` from an unauthenticated intake POST,
 * re-emitted verbatim by `customer_get` — containing the literal closing marker would close the
 * untrusted block early from the model's point of view, and everything the attacker put after it
 * in that same field would read as if it were outside the untrusted region. Sanitising (rather
 * than a per-call nonce) so the system prompt can keep naming these two fixed strings, which is
 * what keeps its rule easy to state and this behaviour easy to regression-test. The content
 * itself is never dropped — only the marker text is swapped for an inert placeholder.
 */
const sanitizeMarkers = (summary: string): string =>
  summary.replace(OPEN_PATTERN, NEUTRALIZED_MARKER).replace(CLOSE_PATTERN, NEUTRALIZED_MARKER);

const delimit = (summary: string): string =>
  `${TOOL_RESULT_OPEN}\n${sanitizeMarkers(summary)}\n${TOOL_RESULT_CLOSE}`;

/**
 * The boundary applies to FAILURES too. A tool error is not always Mallet's own prose: an error
 * summary routinely quotes the record it failed on ("no customer matches <name>"), and that
 * name came from an unauthenticated intake POST. Returning it undelimited hands the model
 * attacker-authored text OUTSIDE the untrusted region the system prompt teaches it to distrust —
 * which is the whole guard, defeated through the one path nobody wrapped.
 *
 * NOT applied to the REPLAY branch, and that is a deliberate scope line rather than a judgement
 * that it is safe. A replayed summary is the same untrusted record text and arguably deserves the
 * same dressing — but `agent-task-runner.int.test.ts`'s replay case uses the ABSENCE of a marker as
 * its fingerprint for "the tool did not really run", and that assertion was reviewed and approved on
 * that reading. Changing it is a decision for the owner, not a side effect of this fix. RESIDUAL, so
 * it is on the record: a wake recovering from a crash replays undelimited text where a fresh wake
 * would have delimited it.
 */
const delimitOutcome = (outcome: ToolOutcome, on: boolean): ToolOutcome => {
  if (!on) return outcome;
  return outcome.ok
    ? { ok: true, summary: delimit(outcome.summary) }
    : { ok: false, error: delimit(outcome.error) };
};

export const buildExecuteTool = (params: BuildExecuteToolParams): ExecuteTool => {
  const { tools, runInTenant, ledger } = params;

  return async (name, input, toolUseId) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };

    // A tool we already ran for this exact tool_use is replayed, never re-executed. Without this,
    // a process killed between the tool's commit and the transcript write sends the second text.
    if (ledger) {
      const previous = await ledger.find(toolUseId);
      if (previous) {
        // Returned RAW — see the note on `delimitOutcome` for why the replay branch is left alone.
        return previous.ok
          ? { ok: true, summary: previous.summary }
          : { ok: false, error: previous.summary };
      }
    }

    return runInTenant(async (ctx): Promise<ToolOutcome> => {
      const enriched =
        input && typeof input === "object" && tool.enrichArgs
          ? { ...(input as Record<string, unknown>), ...tool.enrichArgs(input as Record<string, unknown>, ctx) }
          : input;

      const outcome = await tool.handle(enriched, ctx);

      // The ledger row commits in the SAME transaction as the business write, so a crash cannot
      // leave "it happened" and "we know it happened" on opposite sides of a commit. Reads are
      // idempotent and do not earn a row.
      if (ledger && tool.mutating) {
        await ledger.record(ctx.tx, {
          toolUseId,
          tool: tool.name,
          ok: outcome.ok,
          summary: outcome.ok ? outcome.summary : outcome.error,
        });
      }

      return delimitOutcome(outcome, params.delimitResults === true);
    });
  };
};
