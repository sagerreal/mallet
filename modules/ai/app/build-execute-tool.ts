import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
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
  readonly principal: Principal;
  /** Opens the short per-call tenant transaction and builds the ToolContext. Injected so this
   *  module has no database import and can be unit-tested. */
  readonly runInTenant: <T>(fn: (ctx: ToolContext) => Promise<T>) => Promise<T>;
  /** Wrap results in the untrusted markers. On for the durable runner; off for the surfaces
   *  a human is watching, so their behaviour and their tests are untouched. */
  readonly delimitResults?: boolean;
  readonly ledger?: ExecutionLedger;
}

const delimit = (summary: string): string =>
  `${TOOL_RESULT_OPEN}\n${summary}\n${TOOL_RESULT_CLOSE}`;

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

      if (!outcome.ok) return outcome;
      return params.delimitResults ? { ok: true, summary: delimit(outcome.summary) } : outcome;
    });
  };
};
