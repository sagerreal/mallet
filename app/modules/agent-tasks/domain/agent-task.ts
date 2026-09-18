import {
  err, ok, validation, type AgentTaskId, type OrgId, type Result, type UserId,
  type ValidationError,
} from "@mallet/shared/types";
import type { Role } from "@mallet/identity";
import { MAX_ATTEMPTS, NOTE_MAX, TITLE_MAX } from "../app/agent-task-config";

/**
 * modules/agent-tasks/domain/agent-task.ts
 * One piece of durable work the AI employee owns.
 *
 * The state machine lives here, not in the runner, so an illegal transition is unrepresentable
 * and so the rules are covered by the unit suite (CI does not run integration tests).
 *
 * `done` is terminal on purpose: a finished task is finished, and a new ask is a new task. That
 * is what keeps the Done column honest as a record of work actually completed.
 *
 * Terminal is absorbing for EVERY transition, including the failure paths. `needsYou` and
 * `recordFailure` cannot return `Result` (see their doc comments) so a terminal task is not
 * refused, it is a no-op: the same instance comes back, unchanged, version included. A repair
 * script or a runner bug calling either on a finished task must not be able to un-finish it.
 */
export type AgentTaskStatus = "working" | "needs_you" | "done" | "closed";

export interface AgentTaskProps {
  readonly id: AgentTaskId;
  readonly orgId: OrgId;
  readonly title: string;
  readonly status: AgentTaskStatus;
  readonly nextActionAt: Date | null;
  readonly nextActionNote: string | null;
  readonly origin: "chat";
  /** The real user who filed it. The runner acts as this person and stamps them as the actor. */
  readonly createdBy: UserId;
  /** Snapshotted at creation so a later demotion cannot widen what this task may do. */
  readonly createdByRole: Role;
  readonly version: number;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly leaseId: string | null;
  readonly lockedUntil: Date | null;
  readonly transcriptBytes: number;
  readonly stepsTaken: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const TERMINAL: readonly AgentTaskStatus[] = ["done", "closed"];

const validateTitle = (title: string): Result<string, ValidationError> => {
  const trimmed = title.trim();
  if (trimmed.length === 0) return err(validation("a task needs a title", "title"));
  if (trimmed.length > TITLE_MAX) {
    return err(validation(`a task title is at most ${TITLE_MAX} characters`, "title"));
  }
  return ok(trimmed);
};

/** Notes are clamped, never rejected — see needsYou: the failure path must not itself fail. */
const clampNote = (note: string): string => note.trim().slice(0, NOTE_MAX);

export class AgentTask {
  private constructor(private readonly p: AgentTaskProps) {}

  get props(): AgentTaskProps {
    return this.p;
  }

  static create(props: AgentTaskProps): Result<AgentTask, ValidationError> {
    const title = validateTitle(props.title);
    if (!title.ok) return title;
    if (props.nextActionNote !== null && props.nextActionNote.length > NOTE_MAX) {
      return err(validation(`a note is at most ${NOTE_MAX} characters`, "nextActionNote"));
    }
    if (TERMINAL.includes(props.status) && props.nextActionAt !== null) {
      return err(validation("a finished task cannot be scheduled", "nextActionAt"));
    }
    if (props.attempts < 0 || props.stepsTaken < 0 || props.version < 0) {
      return err(validation("counters cannot be negative", "attempts"));
    }
    return ok(new AgentTask({ ...props, title: title.value }));
  }

  private next(patch: Partial<AgentTaskProps>, now: Date): AgentTask {
    return new AgentTask({ ...this.p, ...patch, version: this.p.version + 1, updatedAt: now });
  }

  /** The agent said when it will continue. This is the only way a task stays alive. */
  scheduleNext(at: Date, note: string, now: Date): Result<AgentTask, ValidationError> {
    if (TERMINAL.includes(this.p.status)) {
      return err(validation("this task is already finished", "status"));
    }
    return ok(
      this.next(
        {
          status: "working",
          nextActionAt: at,
          nextActionNote: clampNote(note),
          stepsTaken: this.p.stepsTaken + 1,
          attempts: 0,
          lastError: null,
        },
        now,
      ),
    );
  }

  /**
   * Come back to this later WITHOUT counting the wake against any budget.
   *
   * The runner's back-off for a RETRYABLE provider failure. No work happened, so neither the
   * attempt budget (MAX_ATTEMPTS) nor the step budget (MAX_STEPS_PER_TASK) may be spent on it, and
   * the accumulated failure trail must survive: `scheduleNext` would spend a step AND reset
   * `attempts`/`lastError`, so one rate-limited provider would hand every task in the org to a
   * human after MAX_STEPS_PER_TASK blips — the same poisoning the attempt budget is spared.
   */
  deferTo(at: Date, note: string, now: Date): Result<AgentTask, ValidationError> {
    if (TERMINAL.includes(this.p.status)) {
      return err(validation("this task is already finished", "status"));
    }
    return ok(
      this.next({ status: "working", nextActionAt: at, nextActionNote: clampNote(note) }, now),
    );
  }

  /**
   * Hand the task to a human. Cannot fail: this is the disposition for an approval, a stall, a
   * spent attempt budget and a transcript cap, and a task nobody can reach is worse than any
   * bad note. Terminal is absorbing: called on a `done`/`closed` task it is a silent no-op
   * (same instance, no version bump) — the caller asked for a state the task is already past.
   */
  needsYou(note: string, now: Date): AgentTask {
    if (TERMINAL.includes(this.p.status)) return this;
    return this.next(
      { status: "needs_you", nextActionAt: null, nextActionNote: clampNote(note) },
      now,
    );
  }

  finish(summary: string, now: Date): Result<AgentTask, ValidationError> {
    if (TERMINAL.includes(this.p.status)) {
      return err(validation("this task is already finished", "status"));
    }
    return ok(
      this.next({ status: "done", nextActionAt: null, nextActionNote: clampNote(summary) }, now),
    );
  }

  /** A human replied or approved: run it on the next tick, with a clean slate. */
  resume(now: Date): Result<AgentTask, ValidationError> {
    if (TERMINAL.includes(this.p.status)) {
      return err(validation("this task is finished — start a new one", "status"));
    }
    return ok(
      this.next({ status: "working", nextActionAt: now, attempts: 0, lastError: null }, now),
    );
  }

  close(now: Date): Result<AgentTask, ValidationError> {
    if (TERMINAL.includes(this.p.status)) {
      return err(validation("this task is already finished", "status"));
    }
    return ok(this.next({ status: "closed", nextActionAt: null }, now));
  }

  /**
   * A run failed for real. The task keeps its place until the budget is spent, then asks a human
   * — never a silent poison row, because the task list IS the dead-letter surface. Terminal is
   * absorbing here too: a `done`/`closed` task returns unchanged rather than being flipped back
   * to `needs_you` — this cannot return `Result` for the same reason `needsYou` cannot.
   */
  recordFailure(lastError: string, now: Date): AgentTask {
    if (TERMINAL.includes(this.p.status)) return this;
    const attempts = this.p.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      return this.next(
        {
          attempts,
          lastError,
          status: "needs_you",
          nextActionAt: null,
          nextActionNote: "I got stuck on this and stopped. Take a look?",
        },
        now,
      );
    }
    return this.next({ attempts, lastError }, now);
  }

  /**
   * Bookkeeping both writers own (the runner per wake, `reply` per interactive turn); never a
   * status change.
   *
   * Terminal is absorbing here too, like `needsYou` and `recordFailure`: on a `done`/`closed` task
   * this is a silent no-op returning the same instance. Without that guard it still bumped `version`
   * and `updatedAt` on a finished task, and — worse — a caller chaining it before `resume()` in a
   * lost race got the aggregate's BAD_REQUEST refusal ("start a new one") instead of the CONFLICT
   * the drawer is built to recover from. A byte count on a task nobody will read again is worth
   * nothing; not being able to tell a lost race from bad input costs a real recovery path.
   */
  withTranscriptBytes(bytes: number, now: Date): AgentTask {
    if (TERMINAL.includes(this.p.status)) return this;
    return this.next({ transcriptBytes: bytes }, now);
  }

  /** Finished for good. A new ask is a new task. */
  isTerminal(): boolean {
    return TERMINAL.includes(this.p.status);
  }

  /**
   * A worker holds this task RIGHT NOW, so nothing else may drive its conversation.
   *
   * A lease whose `lockedUntil` has PASSED counts as absent, not held. An expired lease is not a
   * live worker, and treating it as one would strand the task behind a dead lock that nothing else
   * ever clears — the claim's own predicate ignores a stale `locked_until` for exactly this reason,
   * and every path the runner controls releases its lease explicitly, so a stale lease means a
   * hard-killed process rather than work in progress.
   */
  isLeaseLive(now: Date): boolean {
    return this.p.leaseId !== null && this.p.lockedUntil !== null && this.p.lockedUntil > now;
  }
}
