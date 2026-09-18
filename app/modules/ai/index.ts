// Public surface for the AI agent module — the only sanctioned import seam (architecture rule).
export { createAiRouter } from "./api/ai-router";
export { createFieldCopilotRouter } from "./api/field-copilot-router";
export { buildMcpServer } from "./api/mcp-server";
export { authenticateMcpRequest } from "./api/mcp-auth";
export { AnthropicLlmClient } from "./infra/anthropic-llm-client";
export { runAgentTurn } from "./app/run-agent-turn";
export type { AgentResult, ToolMeta, ExecuteTool, PendingAction, RunAgentParams } from "./app/run-agent-turn";
export { buildAgentTools } from "./infra/agent-tools";
// The one-line "here is what I am about to do" shown before a mutating tool runs. Exported so
// every approval surface (in-app panel, SMS confirmation) describes an action identically.
export { describeProposal } from "./domain/proposal-summary";
export type { LlmClient, LlmRequest, AssistantTurn, AgentMessage, AssistantBlock, Effort } from "./domain/llm-client";
export { LlmError } from "./domain/llm-client";
export type { AgentTool, ToolContext, ToolDeps, ToolOutcome, RiskTier } from "./domain/tool";
// THE one tool executor every driver of the loop goes through — see build-execute-tool.ts for
// the replay ledger and untrusted-content guards it carries.
export { buildExecuteTool, TOOL_RESULT_OPEN, TOOL_RESULT_CLOSE, type ExecutionLedger, type BuildExecuteToolParams } from "./app/build-execute-tool";
// Least-privilege catalog filter for drivers with no transport-layer role gate (a cron route).
export { toolsForRole } from "./domain/tool-filter";
// SYSTEM_PROMPT is currently reached by a RELATIVE import inside modules/ai (ai-router does
// `from "../domain/system-prompt"`). A later driver in another module needs it too, and ESLint's
// no-restricted-imports blocks `@mallet/ai/domain/*` — so the barrel has to carry it.
export { SYSTEM_PROMPT } from "./domain/system-prompt";
