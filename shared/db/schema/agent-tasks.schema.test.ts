import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentTasks, agentTaskMessages, agentToolExecutions } from "./agent-tasks";

describe("agent_tasks schema", () => {
  const cfg = getTableConfig(agentTasks);

  it("is named agent_tasks", () => {
    expect(cfg.name).toBe("agent_tasks");
  });

  it("carries every column the runner and the board need", () => {
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "attempts", "created_at", "created_by", "created_by_role", "deleted_at", "id",
        "last_error", "lease_id", "locked_until", "next_action_at", "next_action_note",
        "org_id", "origin", "status", "steps_taken", "title", "transcript_bytes",
        "updated_at", "version",
      ].sort(),
    );
  });

  it("defaults a new task to working with no lease and no attempts", () => {
    const col = (n: string) => cfg.columns.find((c) => c.name === n);
    expect(col("status")?.default).toBe("working");
    expect(col("attempts")?.default).toBe(0);
    expect(col("version")?.default).toBe(0);
    expect(col("steps_taken")?.default).toBe(0);
    expect(col("transcript_bytes")?.default).toBe(0);
    expect(col("lease_id")?.notNull).toBe(false);
  });

  // COLUMNS, not just the name. A name-only assertion proves nothing about the guarantee: the
  // constraint could be re-pointed at any pair of columns while keeping its name, and this test
  // would still pass while every child table's composite FK lost its target.
  it("exposes the composite (org_id, id) unique a child table's FK can target", () => {
    const uq = cfg.uniqueConstraints.find((u) => u.name === "agent_tasks_org_id_uq");
    expect(uq).toBeDefined();
    expect(uq?.columns.map((c) => c.name)).toEqual(["org_id", "id"]);
  });

  it("orders the conversation by a bigserial seq, not a timestamp", () => {
    const msgs = getTableConfig(agentTaskMessages);
    expect(msgs.name).toBe("agent_task_messages");
    const seq = msgs.columns.find((c) => c.name === "seq");
    expect(seq).toBeDefined();
    expect(seq?.notNull).toBe(true);
  });

  /**
   * THE ENTIRE REPLAY GUARANTEE, asserted on its COLUMNS.
   *
   * `(org_id, tool_use_id)` is what makes "we already ran this exact tool call" a database fact
   * rather than a hope: `buildExecuteTool` consults it before executing, and `recordExecution`
   * writes with `onConflictDoNothing` against it. Swap it to `(org_id, tool)` and the name still
   * reads right — while the ledger now dedupes by TOOL, so the second `sms_send` of a task is
   * silently swallowed as a replay and never sent. A name-only assertion cannot see that.
   */
  it("keys the execution ledger on (org_id, tool_use_id) — the provider's own id, not the tool name", () => {
    const led = getTableConfig(agentToolExecutions);
    expect(led.name).toBe("agent_tool_executions");
    const uq = led.uniqueConstraints.find((u) => u.name === "agent_tool_executions_org_use_uq");
    expect(uq).toBeDefined();
    expect(uq?.columns.map((c) => c.name)).toEqual(["org_id", "tool_use_id"]);
  });
});
