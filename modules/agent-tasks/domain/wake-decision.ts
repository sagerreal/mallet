import type { AgentResult, RiskTier } from "@mallet/ai";
import type { TaskControlOutcome } from "../infra/task-control-tools";
import { MAX_STEPS_PER_TASK, MAX_TRANSCRIPT_BYTES } from "../app/agent-task-config";
// A relative import, not the barrel: `autoApproves` is a VALUE import, and `../index.ts` also
// exports the task router/runner, which eagerly load DB config at import time (see the barrel's
// own comment and wake-outcome.ts's identical reasoning for `classifyTurnFailure`). Reaching one
// file down instead keeps this module's unit tests loadable with no env at all.
import { autoApproves, type AutonomyLevel } from "./autonomy";

/**
 * modules/agent-tasks/domain/wake-decision.ts
 * What one wake decided. Pure — no database, no clock beyond the instant it is handed.
 *
 * The runner is deliberately dumb: it applies this. Keeping the judgement here is what puts it
 * under the unit suite, which is the only suite CI runs.
 */
export type WakeDecision =
  | { readonly kind: "schedule"; readonly at: Date; readonly note: string }
  | { readonly kind: "finish"; readonly summary: string }
  | { readonly kind: "hand_over"; readonly note: string }
  | { readonly kind: "auto_approve"; readonly toolUseIds: readonly string[] };

export interface WakeInput {
  readonly result: AgentResult;
  readonly control: TaskControlOutcome;
  readonly stepsTaken: number;
  readonly transcriptBytes: number;
  readonly now: Date;
  /** The org's live level, read inside the task's own withTenant. */
  readonly level: AutonomyLevel;
  /** The tier of each pending tool, resolved from the catalog by the caller. */
  readonly pendingTiers: readonly { readonly toolUseId: string; readonly tier: RiskTier }[];
}

const HAND_BACK_STALL = "I stopped without deciding what to do next. Have a look?";

export const decideWake = (input: WakeInput): WakeDecision => {
  // Hard ceilings first: they outrank anything the agent asked for. A model that can schedule
  // can also decline to finish, and nothing else stops that.
  if (input.stepsTaken >= MAX_STEPS_PER_TASK) {
    return { kind: "hand_over", note: "I have taken as many steps on this as I should. Over to you." };
  }
  if (input.transcriptBytes > MAX_TRANSCRIPT_BYTES) {
    return { kind: "hand_over", note: "This has run too long for me to keep the whole thread. Over to you." };
  }

  // The agent's own decision wins over whatever it said in prose.
  if (input.control.kind === "finished") {
    return { kind: "finish", summary: input.control.summary };
  }
  if (input.control.kind === "scheduled") {
    return { kind: "schedule", at: input.control.at, note: input.control.note };
  }

  if (input.result.status === "needs_approval") {
    // All-or-nothing: the loop refuses to run a turn where ANY mutating tool_use is
    // un-adjudicated, so a mixed turn cannot be half-approved. One un-approvable tool sends the
    // whole turn to a human, which is also the honest thing to show them. An EMPTY pendingTiers
    // (the caller found no pending rows) never auto-approves either — `every` on an empty array
    // is vacuously true, and `length > 0` is what stops that from auto-approving nothing.
    const everyOneAllowed =
      input.pendingTiers.length > 0 && input.pendingTiers.every((p) => autoApproves(p.tier, input.level));
    if (everyOneAllowed) {
      return { kind: "auto_approve", toolUseIds: input.pendingTiers.map((p) => p.toolUseId) };
    }
    // Always name the tools waiting, not whatever the model said in prose: the reviewer needs
    // to know WHICH call is gated, and the assistant's text (often addressed past the gate, e.g.
    // "I'd send this") does not reliably say that. This also names the OFFENDING tool when a
    // mixed turn is handed over for exactly one bad call.
    const tools = input.result.pending.map((p) => p.tool).join(", ");
    return { kind: "hand_over", note: `I need your OK to run: ${tools}` };
  }
  if (input.result.status === "refused") {
    return { kind: "hand_over", note: "I could not do this one. Over to you." };
  }

  // Completed, but the agent never paced itself: a question, not work in flight.
  const text = input.result.text.trim();
  return { kind: "hand_over", note: text.length > 0 ? text : HAND_BACK_STALL };
};
