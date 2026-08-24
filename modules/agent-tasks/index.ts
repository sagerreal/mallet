// Public surface for the agent-tasks module — the only sanctioned import seam.
export { createAgentTaskRouter } from "./api/agent-task-router";
export { AgentTask, type AgentTaskProps, type AgentTaskStatus } from "./domain/agent-task";
export type { AgentTaskRepository, AgentTaskFilter, StoredExecution } from "./domain/agent-task-repository";
export { CreateAgentTaskUseCase, type CreateAgentTaskCommand } from "./app/create-agent-task";
export { DrizzleAgentTaskRepository } from "./infra/drizzle-agent-task-repository";
export { runAgentTaskTick, type TickSummary, type TickDeps } from "./infra/agent-task-runner";
export * from "./app/agent-task-config";
// The per-shop autonomy setting and the pure policy that gates unattended tool approval.
// Settings imports only the AutonomyLevel TYPE from here (type-only — a value import of this
// barrel would drag the task router/runner's eager DB-config load into settings' unit tests, so
// settings' infra re-declares the value-level default/narrowing locally instead of importing
// DEFAULT_AUTONOMY/isAutonomyLevel). The agent-task runner (Task 17) imports the real values:
// autoApproves/canRunUnattended.
export {
  autoApproves,
  canRunUnattended,
  isAutonomyLevel,
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY,
  type AutonomyLevel,
} from "./domain/autonomy";
