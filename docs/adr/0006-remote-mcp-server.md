# ADR 0006: Remote MCP server

- **Status:** Accepted (read-only tools + static-key auth; OAuth + mutating-tool confirm-flow deferred)
- **Date:** 2026-07-01
- **Context:** Publish Mallet as a standalone remote **MCP server** so external MCP hosts (the Claude Messages API MCP connector, Cursor, VS Code, and our own agent-as-client) can call the same tool registry the in-process agent uses — authenticated, and running under each caller org's RLS. Design chosen from a 3-angle research workflow (hosting-in-Next / remote-MCP auth / tool-confirmation) + synthesis.

## Decision

### 1. Official SDK, stateless, Web-standard transport — a single Next route

`@modelcontextprotocol/sdk@1.29.0`, the low-level `Server` + `WebStandardStreamableHTTPServerTransport` (Web `Request` → `Response`, `sessionIdGenerator: undefined`, `enableJsonResponse: true`), served from **`app/mcp/route.ts`** (`POST` handles JSON-RPC; `GET` → 405). One fresh `Server` + transport per request (stateless). We **rejected** `mcp-handler`: it peer-pins SDK 1.26 and its `registerTool` wants a **zod-v3** raw shape, but the app is on **zod 4** and our tools already emit JSON Schema via `z.toJSONSchema`. The low-level `Server` + `setRequestHandler(ListTools/CallTool)` passes our JSON-Schema `inputSchema` straight through with zero conversion and no express/redis deps.

### 2. Reuse the existing tool registry + the proven tenant-scoped executor

`buildMcpServer(principal, deps)` lists tools from **`buildAgentTools()`** (the same registry the agent loop uses) and dispatches `tools/call` through **`callToolForPrincipal`**, which runs the tool inside a short **`withTenant(principal.orgId)`** tx with an outbox-bound bus — byte-for-byte the same `ToolContext`/`ToolDeps` construction as the in-process agent (`ai-router.ts` `drive()`). `orgId` comes **only** from the authenticated Principal, never from the caller's arguments (the prompt-injection guard). A tool result maps to `{ content: [{type:"text", …}], isError? }`; unknown/hidden tools are a clean `isError` result, not a protocol error. An **unexpected throw** inside the tx (a raw DB/driver error) is caught and mapped to a generic `internal error executing tool` `isError` — the SDK would otherwise echo `error.message` verbatim to the untrusted host — with the real detail logged server-side.

### 3. Auth: static per-tenant API keys (a distinct verifier)

`Authorization: Bearer mallet_sk_<random>`, verified per request. **This is a new path, not the Supabase JWT one** — `SupabaseTokenVerifier.verify` calls `supabase.auth.getUser`, which only accepts short-lived Supabase JWTs an external host cannot mint/refresh. So:

- A new **`api_keys`** table (`org_id`, `hashed_key` unique, `role`, `label`, `revoked_at`, `last_used_at`) — the raw key is shown **once** and never stored; only its SHA-256 hash. RLS ENABLE+FORCE + a `FOR ALL org_id = current_org_id()` policy.
- A new **`app_resolve_api_key(hash)`** SECURITY DEFINER function (mirrors `app_resolve_principal`) so the least-privilege runtime role resolves a key cross-tenant through one narrow, audited seam — no BYPASSRLS connection.
- **`ApiKeyAuthenticator`** (behind the `ApiKeyVerifier` port): reject anything not prefixed `mallet_sk_` (before any DB hit), else hash + resolve → `Principal { userId: key.id, orgId, role }`. Any failure → `null` → the route returns `401` (never `403` that leaks existence). Keys are issued via `scripts/issue-mcp-key.mjs`.

This works **today** with the Claude Messages API MCP connector (`authorization_token`) and Cursor / VS Code / Claude Code (custom `Authorization` header). It does **not** target the Claude.ai / Claude Desktop *consumer* custom-connector UI, which requires full OAuth 2.1 — deferred.

### 4. Read-only tools only; mutating tools held back (server-enforced, not a hint)

The pilot exposes **only the read tools** (`customer_list`, `invoice_list`, `estimate_list`). Mutating tools (`quote_draft`, `invoice_send`) are **filtered out of the registry** for the MCP surface — a hard server-side filter, so they resolve to an unknown-tool error even if requested. Rationale: MCP tool annotations (`readOnlyHint`/`destructiveHint`) are **untrusted hints**, and a raw MCP host **is** the loop and may auto-approve — the in-process agent's human-approval gate does **not** exist on the raw MCP path. So Mallet must not rely on host confirmation for money/dispatch. We still set honest annotations for cooperative hosts (reads → `readOnlyHint: true`).

## Deferred

- **A server-enforced propose→confirm-token flow** in the mutating use-cases (first call returns `isError` + a short-lived token + human summary; second call executes only with a valid token) — the follow-on that unblocks exposing `quote_draft`/`invoice_send` over MCP regardless of host behavior.
- **OAuth 2.1** resource-server support (DCR, PKCE, RFC 9728 metadata) — only needed for the Claude.ai/Desktop consumer UI; add additively behind the same `authenticateMcpRequest` seam (branch on token shape).
- **Per-key rate limiting** (required before GA, not pilot-blocking for a few trusted keys), a **key-management UI** (pilot issues keys via the script), SSE/session resumability (stateless JSON responses suffice), and `last_used_at` updating.

## Consequences

- The MCP surface reuses one tool registry + one tenant-scoped executor with the in-process agent — no second business-logic or tenancy surface.
- The MCP SDK is confined to `mcp-server.ts` + the route; the auth path reuses the identity module's port pattern.
- Verified by integration tests (live RLS): a read tool is org-scoped, mutating tools are not exposed, and the route 401s without a valid key and passes a valid one. `/mcp` registers in the build.
- **Endpoint:** `POST https://<app-host>/mcp` with a `mallet_sk_` bearer. Public URL finalized at deploy.
- **Adversarial review (2026-07-01)** confirmed 4 findings, all fixed: (1) unexpected throws in `callToolForPrincipal` are contained to a generic `isError` (no raw-DB-text leak); (2) the whole request runs under `runWithContext` + `enrichRequestContext(orgId/userId)` so MCP logs are correlated and tenant-attributed; (3) the route wraps auth in try/catch so a transient DB error at credential resolution fails closed to the well-formed 401 (not a 500); (4) a resolved key with a drifted (out-of-range) role returns `null` (fail closed) instead of throwing. The "any failure → 401" contract in §3 is now genuinely enforced for thrown errors too. Hermetic regression tests added (`mcp-server.test.ts` throw-containment; `api-key-authenticator.test.ts` row/role handling).
