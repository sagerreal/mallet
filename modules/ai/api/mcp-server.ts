import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool, type ToolAnnotations, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { logger } from "@mallet/shared/observability";
import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";
import { buildAgentTools } from "../infra/agent-tools";
import type { AgentTool, ToolDeps } from "../domain/tool";

// Which tools are exposed to EXTERNAL MCP hosts. Pilot = read-only tools only. Mutating tools are
// held back: a raw MCP host is the "loop" and may auto-approve, and MCP annotations are untrusted
// hints — so money/dispatch tools must not be exposed until a SERVER-enforced confirm flow exists
// (ADR 0006). This is a hard filter, not just a hidden listing.
const isExposed = (tool: AgentTool): boolean => !tool.mutating;

// Honest annotations for cooperative hosts (still untrusted by spec).
const annotationsFor = (tool: AgentTool): ToolAnnotations =>
  tool.mutating ? { readOnlyHint: false, destructiveHint: true, openWorldHint: true } : { readOnlyHint: true };

// The tools/call execution: find the (exposed) tool, run it inside a short withTenant(orgId) tx with
// an outbox-bound bus — the SAME path as the tRPC API + in-process agent. orgId comes from the
// verified Principal, NEVER from the caller's arguments. A hidden/mutating or unknown tool is a
// clean isError result (not a protocol error). Extracted so it's directly testable under live RLS.
export const callToolForPrincipal = async (
  principal: Principal,
  deps: Pick<AppDeps, "clock" | "ids" | "notificationSender" | "paymentLinkGateway">,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const tool = buildAgentTools()
    .filter(isExposed)
    .find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };

  try {
    const outcome = await withTenant(principal.orgId, (tx) => {
      const toolDeps: ToolDeps = {
        bus: new OutboxEventBus(tx, principal.orgId),
        clock: deps.clock,
        ids: deps.ids,
        notificationSender: deps.notificationSender,
        paymentLinkGateway: deps.paymentLinkGateway,
      };
      return tool.handle(args, { tx, orgId: principal.orgId, principal, deps: toolDeps });
    });
    return outcome.ok
      ? { content: [{ type: "text", text: outcome.summary }] }
      : { content: [{ type: "text", text: outcome.error }], isError: true };
  } catch (error) {
    // Expected failures come back as `outcome.ok === false`. An UNEXPECTED throw (DB driver error,
    // connection-retry exhaustion in withTenant) must NOT reach the untrusted MCP host — the SDK
    // echoes `error.message` verbatim, which would leak raw Postgres text (table/column/constraint
    // names). Log the detail server-side (redacted + tenant-correlated via ambient context) and
    // return a generic isError result instead.
    logger.error({ tool: name, err: error instanceof Error ? error.message : String(error) }, "mcp tool execution failed");
    return { content: [{ type: "text", text: "internal error executing tool" }], isError: true };
  }
};

// A stateless MCP Server bound to ONE authenticated principal. Registers the tool list + tools/call
// (delegating to callToolForPrincipal). One fresh Server per request in the route.
export const buildMcpServer = (principal: Principal, deps: AppDeps): Server => {
  const tools = buildAgentTools().filter(isExposed);
  const server = new Server({ name: "mallet", version: "1" }, { capabilities: { tools: {} } });
  // The SDK's default onerror is a no-op; route protocol-level failures (send-response, unknown
  // message) through our logger so they aren't silently swallowed on the external-facing surface.
  server.onerror = (error): void => logger.error({ err: error instanceof Error ? error.message : String(error) }, "mcp server error");

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(
      (t): Tool => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Tool["inputSchema"], annotations: annotationsFor(t) }),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request): Promise<CallToolResult> =>
    callToolForPrincipal(principal, deps, request.params.name, request.params.arguments ?? {}),
  );

  return server;
};
