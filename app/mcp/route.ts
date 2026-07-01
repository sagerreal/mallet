import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer, authenticateMcpRequest } from "@mallet/ai";
import { getAppDeps } from "@/trpc/di";

// Mallet's remote MCP server. External MCP hosts (the Claude Messages API MCP connector, Cursor,
// VS Code, our own agent-as-client) POST JSON-RPC here with `Authorization: Bearer mallet_sk_…`.
// Stateless: one fresh Server + transport per request; each tools/call runs under the key's org RLS.
// A Web-standard transport (Request → Response) fits the App Router handler directly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = (): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });

export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  const principal = await authenticateMcpRequest(request, deps);
  if (!principal) return unauthorized();

  const server = buildMcpServer(principal, deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// Stateless mode has no server-initiated stream; the GET (SSE) upgrade is not offered.
export function GET(): Response {
  return new Response("method not allowed", { status: 405 });
}
