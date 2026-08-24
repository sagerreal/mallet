import { z } from "zod";
import type { AgentTaskId } from "@mallet/shared/types";
import type { ToolMeta, ToolOutcome } from "@mallet/ai";
import { clampNextStep } from "../domain/next-step";
import { MIN_STEP_MINUTES, NOTE_MAX, TICK_CADENCE_MINUTES } from "../app/agent-task-config";

/**
 * modules/agent-tasks/infra/task-control-tools.ts
 * How the agent paces itself: "wake me then" and "I'm done".
 *
 * A CLOSURE CATALOG, not entries in buildAgentTools(): the task id is baked in so the model
 * supplies no ids and cannot address another task, and these never reach the in-app assistant,
 * the MCP server or the SMS agent, where no task exists. The shape follows field-read-tools.ts.
 *
 * mutating: false, deliberately. The approval gate is all-or-nothing per assistant turn, so a
 * mutating finish_task alongside a mutating invoice_send would halt both — and an agent that
 * needs a human's permission to stop working is not a design, it is a deadlock.
 *
 * They write nothing themselves. They RECORD an intent the runner reads once the turn ends, so
 * the task row is written exactly once per wake, by the runner, under the lease it holds.
 *
 * Two verbs only — schedule_next_step and finish_task. "Park" is finish_task with nothing
 * scheduled; a third state nobody can define is worse than two that are obvious.
 */
export type TaskControlOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "scheduled"; readonly at: Date; readonly note: string }
  | { readonly kind: "finished"; readonly summary: string };

const scheduleInput = z.object({
  when: z.string().min(4),
  note: z.string().trim().min(1).max(NOTE_MAX),
});
const finishInput = z.object({ summary: z.string().trim().min(1).max(NOTE_MAX) });

export interface TaskControlDeps {
  readonly now: () => Date;
}

export interface TaskControlTools {
  readonly meta: ToolMeta[];
  handle(name: string, input: unknown): Promise<ToolOutcome>;
  outcome(): TaskControlOutcome;
}

export const buildTaskControlTools = (taskId: AgentTaskId, deps: TaskControlDeps): TaskControlTools => {
  let outcome: TaskControlOutcome = { kind: "none" };

  const meta: ToolMeta[] = [
    {
      name: "schedule_next_step",
      description:
        `Come back to this task later. Say WHEN as an ISO 8601 timestamp and what you will do. ` +
        `The scheduler runs every ${TICK_CADENCE_MINUTES} minutes, so anything sooner than ` +
        `${MIN_STEP_MINUTES} minutes from now is moved to ${MIN_STEP_MINUTES} minutes from now — ` +
        `do not promise the shop a time you cannot keep. Call this OR finish_task before you stop, ` +
        `or the task goes back to the shop as unanswered.`,
      inputSchema: {
        type: "object",
        properties: {
          when: { type: "string", description: "ISO 8601 timestamp, e.g. 2026-08-21T16:00:00Z" },
          note: { type: "string", description: "One line: what you will do when you wake up." },
        },
        required: ["when", "note"],
      } as Record<string, unknown>,
      mutating: false,
    },
    {
      name: "finish_task",
      description:
        "Close this task out. Say what happened in one or two sentences — the shop reads this as " +
        "the record of what you did. Use this when the work is done, and also when there is nothing " +
        "further you can do without the shop.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string", description: "What happened." } },
        required: ["summary"],
      } as Record<string, unknown>,
      mutating: false,
    },
  ];

  const handle = async (name: string, input: unknown): Promise<ToolOutcome> => {
    if (name !== "schedule_next_step" && name !== "finish_task") {
      return { ok: false, error: `unknown tool: ${name}` };
    }
    // The first pacing call in a turn decides. A model that keeps changing its mind would
    // otherwise leave the runner guessing which intent was real.
    if (outcome.kind !== "none") {
      return { ok: false, error: "you already said how this task continues — carry on or stop" };
    }

    if (name === "finish_task") {
      const parsed = finishInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: "finish_task needs a one-line summary" };
      outcome = { kind: "finished", summary: parsed.data.summary };
      return { ok: true, summary: `Task closed out: ${parsed.data.summary}` };
    }

    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "schedule_next_step needs an ISO timestamp in `when` and a `note`" };
    }
    const clamped = clampNextStep(new Date(parsed.data.when), deps.now());
    outcome = { kind: "scheduled", at: clamped.at, note: parsed.data.note };
    const suffix =
      clamped.clamped === "min"
        ? ` (moved to the soonest the scheduler can serve, ${MIN_STEP_MINUTES} minutes from now)`
        : clamped.clamped === "max"
          ? " (moved back to the furthest this can be scheduled)"
          : "";
    return { ok: true, summary: `Will pick this up at ${clamped.at.toISOString()}${suffix}. Task ${taskId}.` };
  };

  return { meta, handle, outcome: (): TaskControlOutcome => outcome };
};
