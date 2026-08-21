// Public surface for the agent-tasks module — the only sanctioned import seam.
//
// NOTE: the router (`api/agent-task-router.ts`) does not exist yet. Its export is deliberately
// left out — a barrel referencing a missing file fails `pnpm typecheck` for every consumer. Add it
// here once that task lands.
export { AgentTask, type AgentTaskProps, type AgentTaskStatus } from "./domain/agent-task";
export type { AgentTaskRepository, AgentTaskFilter, StoredExecution } from "./domain/agent-task-repository";
export { DrizzleAgentTaskRepository } from "./infra/drizzle-agent-task-repository";
export { runAgentTaskTick, type TickSummary, type TickDeps } from "./infra/agent-task-runner";
export * from "./app/agent-task-config";
