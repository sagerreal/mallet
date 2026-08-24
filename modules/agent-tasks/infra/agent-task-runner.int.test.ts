import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { FixedClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import {
  LlmError, SYSTEM_PROMPT, TOOL_RESULT_OPEN,
  type AssistantBlock, type AssistantTurn, type LlmClient, type LlmRequest,
} from "@mallet/ai";
import { MIN_STEP_MINUTES } from "../app/agent-task-config";
import { DEFAULT_TIMEZONE } from "../domain/wake-context";
import { runAgentTaskTick, type TickDeps } from "./agent-task-runner";

/**
 * modules/agent-tasks/infra/agent-task-runner.int.test.ts
 *
 * WHY EVERY TEST HERE SEEDS A 1990 TIMESTAMP AND PASSES `batch: 1`.
 *
 * The claim is GLOBAL by design (one cross-tenant statement, the whole point of Task 5) and this
 * suite runs against the SHARED production database. Unlike the claim's own suite, the runner does
 * not merely lease what it claims — it runs a turn against it and writes the row back. So a tick
 * that claimed a real customer-facing task would drive it with this file's scripted LLM, exhaust
 * the script, and record a failure on a row this test never created.
 *
 * Two guards, and neither is optional:
 *  - `batch: 1` — exactly one row per tick.
 *  - a DISTINCT 1990 `next_action_at` per test, ascending, so the claim's `ORDER BY next_action_at
 *    ASC` always picks this test's own row: it is older than anything real, and older than every
 *    row an earlier test in this file left behind (each of which ends the test either scheduled
 *    forward, unscheduled, or leased). `beforeAll` asserts nothing due is older still.
 *
 * This suite NEVER mutates a row it did not create. A sibling test earned a Critical finding for
 * globally nulling `next_action_at` to force isolation — `next_action_at` is how the runner knows
 * when to wake a real task, the value cannot be recovered, and doing it here would silently
 * unschedule live customer work. Isolation comes from ordering, not from touching other rows.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn("agent runner integration suite SKIPPED: APP_DATABASE_URL/DATABASE_URL not set.");
}

// Older than any real row could plausibly be, one distinct day per test so the ordering is total.
const ancient = (day: number): string => new Date(Date.UTC(1990, 0, day)).toISOString();

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const turn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({
  stopReason,
  blocks,
  usage,
});
const callTool = (id: string, name: string, input: unknown): AssistantTurn =>
  turn("tool_use", [{ type: "tool_use", id, name, input }]);
const says = (text: string): AssistantTurn => turn("end_turn", [{ type: "text", text }]);

/** A fake provider: no Anthropic call ever leaves this suite. */
class ScriptedLlm implements LlmClient {
  public readonly requests: LlmRequest[] = [];
  constructor(
    private readonly turns: AssistantTurn[],
    /** Wall-clock delay per turn. Only the deadline test uses it — see the note there. */
    private readonly delayMs = 0,
  ) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const t = this.turns.shift();
    if (!t) throw new Error("ScriptedLlm out of turns");
    return t;
  }
}

/** A provider that is down. `retryable` decides back-off versus a spent attempt. */
class FailingLlm implements LlmClient {
  public calls = 0;
  constructor(private readonly retryable: boolean) {}
  async next(): Promise<AssistantTurn> {
    this.calls += 1;
    throw new LlmError(this.retryable);
  }
}

interface TaskRow {
  id: string;
  status: string;
  next_action_at: Date | null;
  next_action_note: string | null;
  version: number;
  attempts: number;
  last_error: string | null;
  lease_id: string | null;
  locked_until: Date | null;
  transcript_bytes: number;
  steps_taken: number;
}

suite("runAgentTaskTick (live RLS, scripted provider)", () => {
  let admin: Sql;
  let orgId = "";
  let ownerId = "";

  const depsWith = (llm: LlmClient, clock: FixedClock, budgetMs?: number): TickDeps => ({
    llm,
    clock,
    ids: uuidGenerator,
    notificationSender: undefined,
    paymentLinkGateway: null,
    systemPrompt: SYSTEM_PROMPT,
    // One row per tick. See the header: the claim is global and this runner WRITES what it claims.
    batch: 1,
    ...(budgetMs === undefined ? {} : { budgetMs }),
  });

  const seedMessage = async (
    taskId: string,
    role: string,
    kind: string,
    blocks: Record<string, unknown>,
  ): Promise<void> => {
    await admin`
      insert into agent_task_messages (org_id, task_id, role, kind, blocks)
      values (${orgId}, ${taskId}, ${role}, ${kind}, ${JSON.stringify(blocks)}::jsonb)`;
  };

  const seedTask = async (
    day: number,
    over: {
      readonly createdByRole?: string;
      readonly attempts?: number;
      readonly leaseId?: string | null;
      readonly lockedUntil?: string | null;
    } = {},
  ): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`
      insert into agent_tasks
        (org_id, title, status, next_action_at, created_by, created_by_role, attempts, lease_id, locked_until)
      values (
        ${orgId}, 'Chase the Hendersons', 'working', ${ancient(day)}, ${ownerId},
        ${over.createdByRole ?? "owner"}, ${over.attempts ?? 0}, ${over.leaseId ?? null},
        ${over.lockedUntil ?? null}
      )
      returning id`;
    return row!.id;
  };

  const readTask = async (id: string): Promise<TaskRow> => {
    const [row] = await admin<TaskRow[]>`
      select id, status, next_action_at, next_action_note, version, attempts, last_error,
             lease_id, locked_until, transcript_bytes, steps_taken
      from agent_tasks where id = ${id}`;
    return row!;
  };

  const readMessages = async (
    id: string,
  ): Promise<{ role: string; kind: string; blocks: Record<string, unknown> }[]> =>
    admin<{ role: string; kind: string; blocks: Record<string, unknown> }[]>`
      select role, kind, blocks from agent_task_messages
      where task_id = ${id} and org_id = ${orgId} order by seq asc`;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('AgentRunner ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'owner@agentrunner.test', 'owner', false) returning id`;
    ownerId = u!.id;

    // The ordering guard this suite's isolation rests on: if anything due is older than 1990, a
    // `batch: 1` tick would claim THAT instead of this file's row and act on a stranger's task.
    // Fail loudly rather than run.
    const [older] = await admin<{ n: number }[]>`
      select count(*)::int as n from agent_tasks
      where status = 'working' and deleted_at is null and next_action_at is not null
        and next_action_at <= now() and (locked_until is null or locked_until < now())
        and next_action_at < ${ancient(1)}`;
    expect(older!.n, "a due agent_task predates this suite's 1990 seeds; ordering isolation is unsafe").toBe(0);
  });

  /**
   * Unschedule the rows THIS SUITE'S OWN THROWAWAY ORG holds, before each test seeds a new one.
   *
   * Read the `where` clause: `org_id = <this file's throwaway org>`. This is emphatically NOT the
   * global `update agent_tasks set next_action_at = null where next_action_at is not null` that
   * earned a sibling test a Critical finding — that one unscheduled every real customer-facing task
   * in the shared production database, irrecoverably. This touches only rows this file created and
   * is about to stop caring about.
   *
   * It is needed because two tests deliberately END with their row still due (the out-of-budget one
   * never starts its task, and the real-failure one keeps its place for the next tick). Left due,
   * those rows are OLDER than the next test's seed, so the `batch: 1` claim would take them
   * instead — the next test would silently assert against the wrong task.
   */
  beforeEach(async () => {
    await admin`update agent_tasks set next_action_at = null where org_id = ${orgId}`;
  });

  afterAll(async () => {
    // Dropped in its own statement, and a failure here must never skip closing a pool. agent_tasks,
    // agent_task_messages and agent_tool_executions all cascade from orgs, so this removes
    // everything this file created and nothing it did not.
    if (orgId) {
      try {
        await admin`delete from orgs where id = ${orgId}`;
      } catch (error) {
        console.error(`agent runner test: failed to delete org ${orgId}`, error);
      }
    }
    if (admin) await admin.end({ timeout: 5 });
    await closeOwnerDb();
    await closeDb();
  });

  it("wakes a due task, runs one turn, and schedules the next step", async () => {
    const clock = new FixedClock(new Date());
    const at = new Date(clock.now().getTime() + 60 * 60_000); // an hour out: past MIN_STEP, unclamped
    const taskId = await seedTask(1);
    const before = await readTask(taskId);
    const llm = new ScriptedLlm([
      callTool("s1", "schedule_next_step", { when: at.toISOString(), note: "call them back" }),
      says("Will do."),
    ]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.claimed).toBe(1);
    expect(summary.scheduled).toBe(1);
    // THE REGRESSION TEST FOR THE VERSION GUARD. If `save` were handed the in-memory aggregate's
    // version instead of the version read from the row, it would match zero rows: the tick would
    // report `raced: 1` and every assertion below would still see `before`.
    expect(summary.raced).toBe(0);

    const after = await readTask(taskId);
    expect(after.status).toBe("working");
    expect(after.next_action_at?.toISOString()).toBe(at.toISOString());
    expect(after.next_action_note).toBe("call them back");
    expect(after.steps_taken).toBe(1);
    expect(after.attempts).toBe(0);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.transcript_bytes).toBeGreaterThan(0);
    // The lease is released with its fencing token, so the next tick is not blocked behind it.
    expect(after.lease_id).toBeNull();
    expect(after.locked_until).toBeNull();

    // The dated line was PERSISTED first, then read back as priorMessages — that is what a wake
    // three days later reasons from, and contextPreamble could never carry it.
    const messages = await readMessages(taskId);
    expect(messages.map((m) => `${m.role}/${m.kind}`)).toEqual([
      "user/text",
      "assistant/assistant",
      "user/tool_results",
      "assistant/assistant",
    ]);
    const seeded = String(messages[0]!.blocks.text);
    // Local, never UTC — the regression ai-router.ts records. The zone itself is covered by its
    // own test below; here it is the fallback zone, since this org has no settings row yet.
    expect(seeded).toContain(DEFAULT_TIMEZONE);
    expect(seeded).not.toContain(clock.now().toISOString());
    // The persisted line is what the model was actually handed, not a preamble computed in memory.
    expect(llm.requests[0]!.messages[0]).toEqual({ role: "user", kind: "text", text: seeded });
  });

  it("hands over a task whose turn asked for an approval", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(2);
    // invoice_send is mutating: the loop halts before the handler ever runs. No human is watching a
    // background wake, so there is nobody to approve — the task goes back to the shop.
    const llm = new ScriptedLlm([callTool("m1", "invoice_send", { invoiceId: randomUUID() })]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.handedOver).toBe(1);
    const after = await readTask(taskId);
    expect(after.status).toBe("needs_you");
    expect(after.next_action_at).toBeNull();
    expect(after.next_action_note).toContain("invoice_send");
    expect(after.lease_id).toBeNull();
    // The mutating tool never executed, so it never earned a ledger row.
    const [ledger] = await admin<{ n: number }[]>`
      select count(*)::int as n from agent_tool_executions where org_id = ${orgId} and tool_use_id = 'm1'`;
    expect(ledger!.n).toBe(0);
  });

  it("hands over a task whose turn went quiet without pacing, fencing the record data it read", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(3);
    const llm = new ScriptedLlm([
      callTool("r1", "customer_list", { limit: 10 }),
      says("Nothing on file for them yet."),
    ]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.handedOver).toBe(1);
    const after = await readTask(taskId);
    expect(after.status).toBe("needs_you");
    expect(after.next_action_at).toBeNull();
    // A completed turn that neither scheduled nor finished is a question, not work in flight.
    expect(after.next_action_note).toBe("Nothing on file for them yet.");

    // delimitResults is ON for this driver only: the tool result the model saw is fenced as data.
    const messages = await readMessages(taskId);
    const results = messages.find((m) => m.kind === "tool_results");
    expect(JSON.stringify(results!.blocks)).toContain(TOOL_RESULT_OPEN);
  });

  it("does not run a task whose creator's role no longer matches the snapshot", async () => {
    const clock = new FixedClock(new Date());
    // The creator's users row says owner; the task was filed as office. A mismatch either way is a
    // hand-over: an owner who was demoted must not wake with owner powers, and the runner must
    // never silently downgrade and carry on.
    const taskId = await seedTask(4, { createdByRole: "office" });
    const llm = new ScriptedLlm([says("this must never be reached")]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.handedOver).toBe(1);
    expect(llm.requests).toHaveLength(0);
    const after = await readTask(taskId);
    expect(after.status).toBe("needs_you");
    expect(after.next_action_at).toBeNull();
    expect(after.next_action_note).toContain("different role");
    expect(after.lease_id).toBeNull();
    // Not even the date line was written: the turn was refused before the transcript was touched.
    expect(await readMessages(taskId)).toHaveLength(0);
  });

  it("replays a tool it already ran instead of executing it a second time", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(5);
    // Stands in for a wake killed between the tool's commit and its transcript write.
    await admin`
      insert into agent_tool_executions (org_id, task_id, tool_use_id, tool, ok, summary)
      values (${orgId}, ${taskId}, 'replay-1', 'customer_list', 'ok', 'REPLAYED SUMMARY')`;
    const llm = new ScriptedLlm([
      callTool("replay-1", "customer_list", { limit: 10 }),
      says("Same as before."),
    ]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.handedOver).toBe(1);
    // The stored summary came back verbatim — the tool did not run, so its real output (and the
    // untrusted markers a live run would have added) is nowhere in the transcript.
    const messages = await readMessages(taskId);
    const results = messages.find((m) => m.kind === "tool_results");
    expect(JSON.stringify(results!.blocks)).toContain("REPLAYED SUMMARY");
    expect(JSON.stringify(results!.blocks)).not.toContain(TOOL_RESULT_OPEN);
    const [ledger] = await admin<{ n: number }[]>`
      select count(*)::int as n from agent_tool_executions where org_id = ${orgId} and tool_use_id = 'replay-1'`;
    expect(ledger!.n).toBe(1);
  });

  it("leaves a task alone while another worker holds its lease", async () => {
    const clock = new FixedClock(new Date());
    const heldBy = randomUUID();
    const locked = new Date(clock.now().getTime() + 4 * 60_000).toISOString();
    // The leased row is the OLDER of the two, so if the claim ignored the lease it would take this
    // one and the decoy would be untouched — the assertions below distinguish the two outcomes.
    const leasedId = await seedTask(6, { leaseId: heldBy, lockedUntil: locked });
    const decoyId = await seedTask(7);
    const before = await readTask(leasedId);
    const llm = new ScriptedLlm([
      callTool("f1", "finish_task", { summary: "sorted it out" }),
      says("Done."),
    ]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.claimed).toBe(1);
    expect(summary.finished).toBe(1);

    const leased = await readTask(leasedId);
    expect(leased.version).toBe(before.version);
    expect(leased.status).toBe("working");
    expect(leased.next_action_at?.toISOString()).toBe(ancient(6));
    expect(leased.lease_id).toBe(heldBy);
    expect(await readMessages(leasedId)).toHaveLength(0);

    const decoy = await readTask(decoyId);
    expect(decoy.status).toBe("done");
    expect(decoy.next_action_note).toBe("sorted it out");
    expect(decoy.lease_id).toBeNull();
  });

  it("backs off a retryable provider failure without spending the attempt or step budget", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(8, { attempts: 2 });
    const llm = new FailingLlm(true);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.backedOff).toBe(1);
    expect(summary.failed).toBe(0);
    expect(llm.calls).toBe(1);
    const after = await readTask(taskId);
    expect(after.status).toBe("working");
    // Neither budget moved: one rate-limited org must not poison every one of its tasks in a tick.
    expect(after.attempts).toBe(2);
    expect(after.steps_taken).toBe(0);
    expect(after.next_action_at?.toISOString()).toBe(
      new Date(clock.now().getTime() + MIN_STEP_MINUTES * 60_000).toISOString(),
    );
    expect(after.lease_id).toBeNull();
  });

  it("spends one attempt on a real failure and keeps the task in the queue", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(9, { attempts: 1 });
    const llm = new FailingLlm(false); // not retryable: a real failure, not a blip

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.failed).toBe(1);
    expect(summary.backedOff).toBe(0);
    const after = await readTask(taskId);
    expect(after.attempts).toBe(2);
    // A low-cardinality discriminator and nothing else — never model output or note text.
    expect(after.last_error).toBe("unhandled");
    // Still due, so the next tick retries it until the budget is spent.
    expect(after.status).toBe("working");
    expect(after.next_action_at?.toISOString()).toBe(ancient(9));
    expect(after.lease_id).toBeNull();
  });

  it("does not append a date line to a transcript that is still owed tool results", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(10);
    // The shape a wake killed between the tool's commit and its transcript write leaves behind —
    // and NOT a crash-only shape: synthesizeFinal pushes its synthetic results with messages.push
    // rather than the reporting append, so at MAX_ITERS_PER_WAKE = 3 an iteration-capped wake
    // leaves the STORED transcript dangling too.
    await seedMessage(taskId, "user", "text", { text: "chase the Hendersons about EST-1041" });
    await seedMessage(taskId, "assistant", "assistant", {
      blocks: [{ type: "tool_use", id: "pend-1", name: "customer_list", input: { limit: 10 } }],
    });
    // Ledger row so the resume replays rather than re-executing, exactly as a real recovery would.
    await admin`
      insert into agent_tool_executions (org_id, task_id, tool_use_id, tool, ok, summary)
      values (${orgId}, ${taskId}, 'pend-1', 'customer_list', 'ok', 'REPLAYED ON RESUME')`;
    const llm = new ScriptedLlm([says("Picking up where I left off.")]);

    const summary = await runAgentTaskTick(depsWith(llm, clock));

    expect(summary.handedOver).toBe(1);
    const messages = await readMessages(taskId);
    // No date line anywhere. Appending one would make the tail a USER turn, the loop would stop
    // recognising the resume, and the provider would get a tool_use with no tool_result — a 400 on
    // every wake, forever, on precisely the crash-recovery path the ledger exists for.
    expect(messages.filter((m) => JSON.stringify(m.blocks).includes("[system] You are working for"))).toHaveLength(0);
    expect(messages.map((m) => `${m.role}/${m.kind}`)).toEqual([
      "user/text",
      "assistant/assistant",
      "user/tool_results",
      "assistant/assistant",
    ]);
    // The loop resolved the pending tool_use FIRST, from the ledger, before calling the provider.
    expect(JSON.stringify(messages[2]!.blocks)).toContain("REPLAYED ON RESUME");
    expect(llm.requests).toHaveLength(1);
  });

  it("stamps the date line with the shop's own timezone, never UTC", async () => {
    const clock = new FixedClock(new Date());
    // A zone whose local date differs from UTC's for most of the day. The regression this guards is
    // recorded in ai-router.ts: toISOString() rolls over at midnight UTC, which is 5pm Pacific, so
    // every evening the agent believed it was already tomorrow and scheduled onto the wrong day.
    // booking is notNull with no default; an empty object satisfies it and nothing here reads it.
    await admin`
      insert into org_settings (org_id, timezone, booking)
      values (${orgId}, 'America/New_York', '{}'::jsonb)
      on conflict (org_id) do update set timezone = 'America/New_York'`;
    const taskId = await seedTask(11);
    const llm = new ScriptedLlm([says("Understood.")]);

    await runAgentTaskTick(depsWith(llm, clock));

    const [line] = await readMessages(taskId);
    const text = String(line!.blocks.text);
    // Read from THIS org's settings row, not the fallback — a second shop in another zone would
    // be told a different local time for the same instant.
    expect(text).toContain("America/New_York");
    expect(text).toContain("AgentRunner"); // the shop's own name, which the model cannot guess
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(clock.now());
    expect(text).toContain(localDate);
    expect(text).not.toContain(clock.now().toISOString());
  });

  it("releases a claimed task it never started once the tick is out of budget", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(12);
    const before = await readTask(taskId);
    const llm = new ScriptedLlm([says("never reached")]);

    // budgetMs 0: the claim itself takes longer than that, so the loop is already over budget on
    // its first row. Nothing is worked, so nothing is written.
    const summary = await runAgentTaskTick(depsWith(llm, clock, 0));

    expect(summary.claimed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(llm.requests).toHaveLength(0);
    const after = await readTask(taskId);
    expect(after.version).toBe(before.version);
    expect(after.attempts).toBe(before.attempts);
    expect(after.status).toBe("working");
    expect(after.next_action_at?.toISOString()).toBe(ancient(12));
    expect(await readMessages(taskId)).toHaveLength(0);
    // The lease goes straight back, so the next tick takes it first instead of waiting the window out.
    expect(after.lease_id).toBeNull();
    expect(after.locked_until).toBeNull();
  });

  it("abandons a turn that outruns the tick budget, spending an attempt and leaving a trail", async () => {
    const clock = new FixedClock(new Date());
    const taskId = await seedTask(13);
    // The provider takes LONGER than the whole budget, so the first onProgress after it lands is
    // guaranteed to be past the deadline however long the claim took. That is what makes this
    // deterministic rather than a race: persist happens at least DELAY ms after the tick started.
    const budgetMs = 4_000;
    const llm = new ScriptedLlm([says("too slow"), says("also too slow")], budgetMs + 500);

    const summary = await runAgentTaskTick(depsWith(llm, clock, budgetMs));

    expect(summary.abandoned).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    const after = await readTask(taskId);
    // A real attempt IS spent here, unlike a provider blip: a task that reliably outlives the
    // function must retire to a human rather than retry forever at full LLM cost.
    expect(after.attempts).toBe(1);
    expect(after.last_error).toBe("tick_budget");
    expect(after.status).toBe("working");
    expect(after.next_action_at?.toISOString()).toBe(ancient(13));
    expect(after.lease_id).toBeNull();
    // The transcript the turn did produce is kept: the date line plus the assistant turn it
    // persisted before the deadline tripped.
    expect((await readMessages(taskId)).length).toBeGreaterThanOrEqual(2);
  });
});
