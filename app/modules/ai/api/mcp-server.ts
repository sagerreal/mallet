import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool, type ToolAnnotations, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withTenant } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import type { Principal } from "@mallet/identity";
import { buildAgentTools } from "../infra/agent-tools";
import type { AgentTool } from "../domain/tool";
import { handleMutatingCall, buildToolContext, type McpDeps } from "./mcp-confirm";

// All current tools wrap ownerOrOffice tRPC procedures — a tech-role key gets a clean refusal, at
// the EXECUTOR (not just the listing), before any DB work. Checked first on both the propose and
// confirm legs of a mutating call.
const roleAllowed = (principal: Principal): boolean => principal.role === "owner" || principal.role === "office";

// Honest annotations for cooperative hosts (still untrusted hints by spec — the server-side confirm
// gate, not these, is what actually protects mutating tools).
const annotationsFor = (tool: AgentTool): ToolAnnotations =>
  tool.mutating ? { readOnlyHint: false, destructiveHint: true, openWorldHint: false } : { readOnlyHint: true };

// The listed spec for a tool. Mutating tools advertise the two-step confirm flow: their schema gains
// an optional confirmToken property and their description explains the propose→confirm sequence, so
// an external model knows the first call returns a proposal rather than executing.
const toolSpec = (t: AgentTool): Tool => {
  if (!t.mutating) return { name: t.name, description: t.description, inputSchema: t.inputSchema as Tool["inputSchema"], annotations: annotationsFor(t) };
  const base = t.inputSchema as { properties?: Record<string, object> };
  const inputSchema: Tool["inputSchema"] = {
    ...t.inputSchema,
    type: "object",
    properties: {
      ...base.properties,
      confirmToken: {
        type: "string",
        description: "Token from a prior proposal. Omit on the first call to receive a proposal + token (no action taken); to execute, repeat the call with the SAME arguments plus this confirmToken.",
      },
    },
  };
  return {
    name: t.name,
    description: `${t.description} TWO-STEP: the first call returns a proposal and a confirmToken without taking action; get the user's approval, then call again with confirmToken to execute.`,
    inputSchema,
    annotations: annotationsFor(t),
  };
};

// The tools/call execution: gate the role, find the tool, then run it — read tools directly inside a
// short withTenant(orgId) tx (the SAME path as the tRPC API + in-process agent), mutating tools
// through the server-enforced propose→confirm gate (mcp-confirm.ts). orgId comes from the verified
// Principal, NEVER from the caller's arguments. Unknown tools are a clean isError result (not a
// protocol error). Extracted so it's directly testable under live RLS.
export const callToolForPrincipal = async (
  principal: Principal,
  deps: McpDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  if (!roleAllowed(principal)) {
    return { content: [{ type: "text", text: "this key's role does not permit tool calls" }], isError: true };
  }
  const tool = buildAgentTools().find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };

  try {
    if (tool.mutating) return await handleMutatingCall(tool, args, principal, deps);

    const outcome = await withTenant(principal.orgId, (tx) => tool.handle(args, buildToolContext(tx, principal, deps)));
    return outcome.ok
      ? { content: [{ type: "text", text: outcome.summary }] }
      : { content: [{ type: "text", text: outcome.error }], isError: true };
  } catch (error) {
    // Expected failures come back as clean isError results above. An UNEXPECTED throw (DB driver
    // error, connection-retry exhaustion in withTenant) must NOT reach the untrusted MCP host — the
    // SDK echoes `error.message` verbatim, which would leak raw Postgres text (table/column/
    // constraint names). Log the detail server-side (redacted + tenant-correlated via ambient
    // context) and return a generic isError result instead.
    logger.error({ tool: name, err: error instanceof Error ? error.message : String(error) }, "mcp tool execution failed");
    return { content: [{ type: "text", text: "internal error executing tool" }], isError: true };
  }
};

// A stateless MCP Server bound to ONE authenticated principal. Registers the tool list + tools/call
// (delegating to callToolForPrincipal). One fresh Server per request in the route.
export const buildMcpServer = (principal: Principal, deps: McpDeps): Server => {
  const tools = roleAllowed(principal) ? buildAgentTools() : [];
  const server = new Server({ name: "mallet", version: "1" }, { capabilities: { tools: {} } });
  // The SDK's default onerror is a no-op; route protocol-level failures (send-response, unknown
  // message) through our logger so they aren't silently swallowed on the external-facing surface.
  server.onerror = (error): void => logger.error({ err: error instanceof Error ? error.message : String(error) }, "mcp server error");

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(toolSpec) }));

  server.setRequestHandler(CallToolRequestSchema, (request): Promise<CallToolResult> =>
    callToolForPrincipal(principal, deps, request.params.name, request.params.arguments ?? {}),
  );

  return server;
};
