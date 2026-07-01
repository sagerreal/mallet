# ADR 0005: AI agent core — unified tool-use loop

- **Status:** Accepted (agent core + read/action tools; MCP-server publish, streaming, more tools deferred)
- **Date:** 2026-07-01
- **Context:** Phase 3. The platform's AI is an **agent**, not chat-and-response: the model is given tools (Mallet's own capabilities) and drives a tool-use loop until the task is done. Design chosen from a 5-angle research workflow (loop anatomy, MCP, current frameworks, production concerns, Anthropic mechanics) + synthesis, then confirmed with the human on the two decisions that deviated from the initial ask (see below).

## Decision

### 1. A single manual tool-use loop (`modules/ai`)

The agent is one `while` loop (`runAgentTurn`): call the model with the running transcript + tool specs → if it returns `tool_use`, execute the tools, feed the results back → loop until a terminal stop reason. This is the industry-consensus shape (Anthropic Agent SDK, OpenAI Agents SDK, Vercel AI SDK, pydantic-ai all reduce to it). We use a **manual** loop, not the SDK's auto tool-runner, precisely because we need human-approval gating, per-call `withTenant`, and audit — Anthropic's own guidance says use the manual loop for exactly these.

- Exits on **any** non-`tool_use` stop reason (a common loop bug is only checking `end_turn`). `refusal` → a `refused` result (not retried). Iteration/`maxIters` cap → one final **tool-less** synthesis call so the user gets a wrap-up, never a dangling loop.
- The loop is generic (`LlmClient` port + tool metadata + an injected `execute` fn), so it's unit-tested with a fake model + fake tools — no network. The `AnthropicLlmClient` adapter is the **only** file importing the SDK (Opus 4.8, adaptive thinking, `output_config.effort`, streaming, and prompt-caching the frozen tools+system prefix — the main pilot cost lever). Verified against live Anthropic with an opt-in smoke test.

### 2. Native in-process tools, MCP-shaped — not MCP as the internal transport

**The human asked for "MCP tools."** Research + the human's follow-up settled on: our first-party tools run **in-process as native Claude tool-use**, executed on our server under our RLS + approval gating — **not** via Anthropic's hosted MCP connector, which executes tools on Anthropic's infrastructure and would remove the client-side seam where we enforce `withTenant`/RLS and gate money/dispatch. The tool registry is kept **MCP-shaped** (`name` / `description` / JSON-Schema `inputSchema` + an `is_error` result channel) so **publishing Mallet as a standalone MCP server** (for Claude Desktop / partners) is an additive next slice, not a rewrite. Same menu the model sees either way; the only question is who executes the chosen tool, and for our own agent that must be us.

### 3. Tools reuse the existing use-cases; tenancy is enforced by the seam, not the model

Each tool handler constructs the **same use-case the tRPC router calls**, from the per-call tenant tx — one business-logic surface, not two. `input_schema` comes from the existing Zod validators (`z.toJSONSchema`), so tool inputs validate at the boundary exactly like the API.

The agent entry is a tRPC procedure on **`ownerOrOfficeNoTx`** (auth + role, but **no** `orgTx`): the loop must not hold one Postgres transaction open across many model round-trips. Instead each tool call opens its **own short `withTenant(orgId)` tx** with an outbox-bound `OutboxEventBus` — so a tool's side effects are durable + atomic exactly like a request, and `orgId` comes **only** from the verified `Principal`, never a model-visible argument (the prompt-injection guard). Tool input schemas therefore never contain org/tenant fields. Proven by an integration test: a tool sees only its org's data under live RLS.

### 4. Human-approval gating for mutating tools

Tools are `mutating: true` (create/send/dispatch/charge) or read-only. Read tools run unattended; a mutating tool **pauses the loop** — `runAgentTurn` returns `needs_approval` with the pending action(s) and the transcript, and never executes the tool until the caller resumes with the approved `tool_use` ids (deny feeds an `is_error` result back so the model re-plans). This is why the manual loop is required. Errors are returned to the model as actionable text (`is_error`) so it self-corrects — never a raw provider/DB message (no PII).

### 5. Runaway guards + observability

`maxIters` cap (default 15) → final synthesis. (A per-run USD/wall-clock budget is a fast follow — see open questions.) Every request runs under the existing observability context; usage (incl. `cacheReadTokens`) is returned per turn.

## Deferred

- **Publish Mallet as an MCP server** (protocol endpoint + auth) so external hosts use the same registry — the immediate next slice.
- **Streaming** the loop's progress to the UI (subscription/SSE), a **server-side session store** for approval-resume (today the transcript round-trips to the client as an opaque string — bounded risk: org is re-derived server-side + tools re-gate, so a tampered transcript can't cross tenants or bypass approval; a signed/stored session is the hardening), a **per-run cost budget** + beta task budgets, an **agent_tool_calls audit table**, **more tools** (scheduling/dispatch, payments, notifications) grown from real-task evals, **model tiering** (Haiku for cheap sub-steps), **tool-search/prompt-cache** hardening once the tool count grows, and the **field-tech + photo (vision)** entry (same loop, tech-scoped tools + system prompt).

## Review hardening (2026-07-01)

The slice's adversarial review confirmed 9 findings (deduped to 4). Fixed:

- **Dangling `tool_use` on the cap synthesis (HIGH):** the loop alternates model-call / resolve iterations, so with an **odd** `maxIters` (the default was 15) a read-tool loop exits right after a model-call iteration that left an **unanswered** assistant `tool_use`. The final tool-less synthesis then sent that dangling `tool_use` with no matching `tool_result` → Anthropic 400 → a 500 on the exact wrap-up path meant to prevent a runaway. Fixed: `synthesizeFinal` answers any dangling `tool_use` with a synthetic error `tool_result` before the synthesis call. The unit test missed it because the fake LLM didn't validate `tool_use`/`tool_result` pairing — added a **validating fake** (throws on a dangling `tool_use`, like the real API) + an odd-`maxIters` regression test.
- **Uncaught provider errors → opaque 500 (MED):** `llm.next()` throwing (429/5xx/network) propagated as an unhandled 500 (and, in dev, raw provider text). Fixed: the adapter catches the SDK error, logs the status/type/request-id **server-side only** (never the request body), and throws a domain **`LlmError { retryable }`**; the router maps it to `TOO_MANY_REQUESTS` / `BAD_GATEWAY` with a generic message.
- **Unvalidated resume transcript (MED):** the resume transcript was cast without structural validation, so a malformed element threw a `TypeError` → 500. Fixed: a Zod schema mirroring the `AgentMessage` union validates it → clean `BAD_REQUEST` (regression test covers a malformed + a non-JSON transcript).
- **Refusal on the synthesis turn (LOW):** the cap wrap-up didn't check `refusal` and reported it as `completed`. Fixed: `synthesizeFinal` returns `refused` on a refusal (regression test added).

## Consequences

- The AI is **optional**: unset `ANTHROPIC_API_KEY` → `llmClient` is null → `v1.ai.*` returns `PRECONDITION_FAILED`.
- The Anthropic SDK is confined to one adapter; use-cases/loop depend only on the `LlmClient` port.
- The tool surface is **hand-curated (5 tools now: 3 read, 2 action)**, not one-per-endpoint — Anthropic's explicit guidance (token bloat + tool-selection accuracy degrade past ~30-50 tools).
