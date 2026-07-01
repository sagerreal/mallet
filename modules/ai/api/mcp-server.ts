import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool, type ToolAnnotations, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
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
};

// A stateless MCP Server bound to ONE authenticated principal. Registers the tool list + tools/call
// (delegating to callToolForPrincipal). One fresh Server per request in the route.
export const buildMcpServer = (principal: Principal, deps: AppDeps): Server => {
  const tools = buildAgentTools().filter(isExposed);
  const server = new Server({ name: "mallet", version: "1" }, { capabilities: { tools: {} } });

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
