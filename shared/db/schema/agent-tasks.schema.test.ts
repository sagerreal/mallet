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

  it("exposes the composite unique a child table's FK can target", () => {
    expect(cfg.uniqueConstraints.some((u) => u.name === "agent_tasks_org_id_uq")).toBe(true);
  });

  it("orders the conversation by a bigserial seq, not a timestamp", () => {
    const msgs = getTableConfig(agentTaskMessages);
    expect(msgs.name).toBe("agent_task_messages");
    const seq = msgs.columns.find((c) => c.name === "seq");
    expect(seq).toBeDefined();
    expect(seq?.notNull).toBe(true);
  });

  it("keys the execution ledger on the provider's tool_use id", () => {
    const led = getTableConfig(agentToolExecutions);
    expect(led.name).toBe("agent_tool_executions");
    expect(led.uniqueConstraints.some((u) => u.name === "agent_tool_executions_org_use_uq")).toBe(true);
  });
});
