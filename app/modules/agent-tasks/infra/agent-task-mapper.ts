import { agentTasks, agentTaskMessages } from "@mallet/shared/db/schema";
import { asAgentTaskId, asOrgId, asUserId } from "@mallet/shared/types";
import type { AgentMessage } from "@mallet/ai";
import type { Role } from "@mallet/identity";
import { AgentTask, type AgentTaskStatus } from "../domain/agent-task";

export type AgentTaskRow = typeof agentTasks.$inferSelect;
export type AgentTaskMessageRow = typeof agentTaskMessages.$inferSelect;

/** Corrupt data throws: a row that violates the aggregate's rules is not an expected condition. */
export const toDomain = (row: AgentTaskRow): AgentTask => {
  const result = AgentTask.create({
    id: asAgentTaskId(row.id),
    orgId: asOrgId(row.orgId),
    title: row.title,
    status: row.status as AgentTaskStatus,
    nextActionAt: row.nextActionAt,
    nextActionNote: row.nextActionNote,
    origin: "chat",
    createdBy: asUserId(row.createdBy),
    createdByRole: row.createdByRole as Role,
    version: row.version,
    attempts: row.attempts,
    lastError: row.lastError,
    leaseId: row.leaseId,
    lockedUntil: row.lockedUntil,
    transcriptBytes: row.transcriptBytes,
    stepsTaken: row.stepsTaken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
  if (!result.ok) throw new Error(`corrupt agent task ${row.id}: ${result.error.message}`);
  return result.value;
};

/**
 * Rebuild the loop's message from a row. The `blocks` jsonb holds the message's payload verbatim,
 * INCLUDING thinking / redacted_thinking blocks with their signature and data — those must go back
 * to the provider byte-identical or the request is rejected, so nothing here re-encodes them.
 */
export const toMessage = (row: AgentTaskMessageRow): AgentMessage => {
  const payload = row.blocks as Record<string, unknown>;
  if (row.role === "assistant") {
    return { role: "assistant", kind: "assistant", blocks: payload.blocks as never };
  }
  if (row.kind === "tool_results") {
    return { role: "user", kind: "tool_results", results: payload.results as never };
  }
  if (row.kind === "user_blocks") {
    return { role: "user", kind: "user_blocks", blocks: payload.blocks as never };
  }
  return { role: "user", kind: "text", text: String(payload.text ?? "") };
};

/** The inverse: the row columns for one message. */
export const fromMessage = (
  message: AgentMessage,
): { role: string; kind: string; blocks: Record<string, unknown> } => {
  if (message.role === "assistant") {
    return { role: "assistant", kind: "assistant", blocks: { blocks: message.blocks } };
  }
  if (message.kind === "tool_results") {
    return { role: "user", kind: "tool_results", blocks: { results: message.results } };
  }
  if (message.kind === "user_blocks") {
    return { role: "user", kind: "user_blocks", blocks: { blocks: message.blocks } };
  }
  return { role: "user", kind: "text", blocks: { text: message.text } };
};
