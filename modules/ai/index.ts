// Public surface for the AI agent module — the only sanctioned import seam (architecture rule).
export { createAiRouter } from "./api/ai-router";
export { buildMcpServer } from "./api/mcp-server";
export { authenticateMcpRequest } from "./api/mcp-auth";
export { AnthropicLlmClient } from "./infra/anthropic-llm-client";
export { runAgentTurn } from "./app/run-agent-turn";
export type { AgentResult, ToolMeta, ExecuteTool, PendingAction, RunAgentParams } from "./app/run-agent-turn";
export { buildAgentTools } from "./infra/agent-tools";
export type { LlmClient, LlmRequest, AssistantTurn, AgentMessage, AssistantBlock, Effort } from "./domain/llm-client";
export { LlmError } from "./domain/llm-client";
export type { AgentTool, ToolContext, ToolDeps, ToolOutcome } from "./domain/tool";
