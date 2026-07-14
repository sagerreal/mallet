import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { asOrgId, asUserId, type OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import type { ToolInvocationLedger } from "../domain/call-record";
import type { VoiceTool, VoiceToolContext, VoiceToolDeps, VoiceToolResult } from "./tools/tool-result";
import {
  RunToolCallsUseCase,
  FALLBACK_UNKNOWN_TOOL,
  FALLBACK_INVALID_ARGS,
  FALLBACK_EXECUTION_ERROR,
  AUTO_FOLLOWUP_TASK_TEXT,
  type RunToolCallsBaseContext,
  type VoiceToolDepsFactory,
} from "./run-tool-calls";

// ---------------------------------------------------------------------------
// Fixtures + fakes
// ---------------------------------------------------------------------------

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CALL_ID = "vapi-call-1";

const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  role: "office",
};

const BASE: RunToolCallsBaseContext = { tx: {} as never, orgId: ORG, principal: PRINCIPAL };

// In-memory ledger. `find` returns a prior result once seeded; `save` records the row. A spy on
// each lets tests assert idempotency (replay hit → no re-execute) + persistence.
class FakeLedger implements ToolInvocationLedger {
  readonly rows = new Map<string, { tool: string; result: unknown }>();
  readonly findSpy = vi.fn();
  readonly saveSpy = vi.fn();

  private key(vapiCallId: string, toolCallId: string): string {
    return `${vapiCallId}:${toolCallId}`;
  }
  seed(vapiCallId: string, toolCallId: string, tool: string, result: unknown): void {
    this.rows.set(this.key(vapiCallId, toolCallId), { tool, result });
  }
  async find(vapiCallId: string, toolCallId: string): Promise<{ result: unknown } | null> {
    this.findSpy(vapiCallId, toolCallId);
    const row = this.rows.get(this.key(vapiCallId, toolCallId));
    return row ? { result: row.result } : null;
  }
  async save(input: {
    orgId: OrgId;
    vapiCallId: string;
    toolCallId: string;
    tool: string;
    result: unknown;
  }): Promise<void> {
    this.saveSpy(input);
    this.rows.set(this.key(input.vapiCallId, input.toolCallId), {
      tool: input.tool,
      result: input.result,
    });
  }
}

// Records every createTask call so we can assert the auto follow-up on an execution throw.
const createdTasks: { text: string; orgId: string }[] = [];

const fakeDeps: VoiceToolDeps = {
  ensureCustomer: {} as never,
  createTask: {
    async exec(cmd: { text: string }, orgId: string) {
      createdTasks.push({ text: cmd.text, orgId });
      return { ok: true, value: {} as never } as never;
    },
  } as never,
  bus: { async emit() {} },
  clock: { now: () => new Date("2026-07-14T00:00:00Z") },
  ids: { newId: () => "id-1" },
};

const depsFactory: VoiceToolDepsFactory = () => fakeDeps;

// A configurable fake tool with a spied handler.
const makeTool = (
  name: string,
  behavior: (ctx: VoiceToolContext) => Promise<VoiceToolResult>,
  input: z.ZodType = z.object({ ok: z.literal(true) }),
): VoiceTool & { handleSpy: ReturnType<typeof vi.fn> } => {
  const handleSpy = vi.fn(async (_i: unknown, ctx: VoiceToolContext) => behavior(ctx));
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object" },
    input,
    handle: handleSpy,
    handleSpy,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunToolCallsUseCase", () => {
  let ledger: FakeLedger;
  beforeEach(() => {
    ledger = new FakeLedger();
    createdTasks.length = 0;
  });

  it("success path executes, returns speak, and saves to the ledger", async () => {
    const tool = makeTool("echo", async () => ({ speak: "done", data: { ok: true } }));
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(tool.handleSpy).toHaveBeenCalledTimes(1);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.toolCallId).toBe("tc-1");
    expect(JSON.parse(out.results[0]!.result)).toMatchObject({ speak: "done", data: { ok: true } });
    expect(ledger.saveSpy).toHaveBeenCalledTimes(1);
  });

  it("a ledger hit returns the stored result and does NOT re-execute", async () => {
    const tool = makeTool("echo", async () => ({ speak: "fresh" }));
    ledger.seed(CALL_ID, "tc-1", "echo", { speak: "stored" });
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(tool.handleSpy).toHaveBeenCalledTimes(0);
    expect(JSON.parse(out.results[0]!.result)).toEqual({ speak: "stored" });
    expect(ledger.saveSpy).toHaveBeenCalledTimes(0);
  });

  it("an unknown tool returns the unknown-tool fallback and never throws", async () => {
    const runner = new RunToolCallsUseCase([], ledger, depsFactory);
    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "nope", arguments: {} }],
      ctx: BASE,
    });
    expect(JSON.parse(out.results[0]!.result).speak).toBe(FALLBACK_UNKNOWN_TOOL);
    expect(createdTasks).toHaveLength(0);
  });

  it("invalid args return the invalid-args fallback, do NOT execute, and file no task", async () => {
    const tool = makeTool("echo", async () => ({ speak: "should not run" }));
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: false } }],
      ctx: BASE,
    });

    expect(tool.handleSpy).toHaveBeenCalledTimes(0);
    expect(JSON.parse(out.results[0]!.result).speak).toBe(FALLBACK_INVALID_ARGS);
    expect(createdTasks).toHaveLength(0);
  });

  it("a handler throw returns the execution fallback + files an auto follow-up task, no throw", async () => {
    const tool = makeTool("boom", async () => {
      throw new Error("kaboom");
    });
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "boom", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(JSON.parse(out.results[0]!.result).speak).toBe(FALLBACK_EXECUTION_ERROR);
    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0]!.text).toBe(AUTO_FOLLOWUP_TASK_TEXT);
    expect(createdTasks[0]!.orgId).toBe(ORG);
    expect(ledger.saveSpy).toHaveBeenCalledTimes(1);
  });

  it("processes two tool calls in one message", async () => {
    const echo = makeTool("echo", async () => ({ speak: "one" }));
    const pong = makeTool("pong", async () => ({ speak: "two" }));
    const runner = new RunToolCallsUseCase([echo, pong], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [
        { id: "tc-1", name: "echo", arguments: { ok: true } },
        { id: "tc-2", name: "pong", arguments: { ok: true } },
      ],
      ctx: BASE,
    });

    expect(out.results.map((r) => r.toolCallId)).toEqual(["tc-1", "tc-2"]);
    expect(JSON.parse(out.results[0]!.result).speak).toBe("one");
    expect(JSON.parse(out.results[1]!.result).speak).toBe("two");
    expect(ledger.saveSpy).toHaveBeenCalledTimes(2);
  });

  it("still returns the spoken result when the ledger save throws (logged, not fatal)", async () => {
    const tool = makeTool("echo", async () => ({ speak: "done" }));
    const brokenLedger: ToolInvocationLedger = {
      async find() {
        return null;
      },
      async save() {
        throw new Error("ledger offline");
      },
    };
    const runner = new RunToolCallsUseCase([tool], brokenLedger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(JSON.parse(out.results[0]!.result).speak).toBe("done");
  });

  it("carries `data` through a replay hit", async () => {
    const tool = makeTool("echo", async () => ({ speak: "fresh" }));
    ledger.seed(CALL_ID, "tc-1", "echo", { speak: "stored", data: { emergency: true } });
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(JSON.parse(out.results[0]!.result)).toEqual({
      speak: "stored",
      data: { emergency: true },
    });
    expect(tool.handleSpy).toHaveBeenCalledTimes(0);
  });

  it("falls back defensively when a stored ledger row is malformed", async () => {
    const tool = makeTool("echo", async () => ({ speak: "fresh" }));
    ledger.seed(CALL_ID, "tc-1", "echo", { not_speak: 42 });
    const runner = new RunToolCallsUseCase([tool], ledger, depsFactory);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(JSON.parse(out.results[0]!.result).speak).toBe(FALLBACK_EXECUTION_ERROR);
  });

  it("does not mask the spoken fallback when the auto follow-up task also fails", async () => {
    const tool = makeTool("boom", async () => {
      throw new Error("kaboom");
    });
    const throwingDeps: VoiceToolDeps = {
      ...fakeDeps,
      createTask: {
        async exec() {
          throw new Error("task db offline");
        },
      } as never,
    };
    const runner = new RunToolCallsUseCase([tool], ledger, () => throwingDeps);

    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: "tc-1", name: "boom", arguments: { ok: true } }],
      ctx: BASE,
    });

    expect(JSON.parse(out.results[0]!.result).speak).toBe(FALLBACK_EXECUTION_ERROR);
  });
});
