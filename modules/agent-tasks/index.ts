// Public surface for the agent-tasks module — the only sanctioned import seam.
//
// NOTE: the router (Task 10, `api/agent-task-router.ts`) and the runner (Task 12,
// `infra/agent-task-runner.ts`) do not exist yet. Their exports are deliberately left out —
// a barrel referencing a missing file fails `pnpm typecheck` for every consumer. Add them here
// once those tasks land.
export { AgentTask, type AgentTaskProps, type AgentTaskStatus } from "./domain/agent-task";
export type { AgentTaskRepository, AgentTaskFilter, StoredExecution } from "./domain/agent-task-repository";
export { DrizzleAgentTaskRepository } from "./infra/drizzle-agent-task-repository";
export * from "./app/agent-task-config";
