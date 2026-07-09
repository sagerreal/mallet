# Mallet Agent Chatbox — Design Spec

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Author:** GTM eng (Owen) + Claude

## Goal

Turn the "Ask Mallet" command bar into a real LLM agent: the user types anything in plain language and the agent does it on the platform via tools, pausing for the user's approval on any write. Reuse the curated example prompts and the existing approval/visualization UI. Ship in-app first; the external MCP surface inherits the same tools later.

## Background — what already exists (do NOT rebuild)

Research (2026-07-09) found the backend is ~90% built and production-grade:

- **Agent loop** — `modules/ai/app/run-agent-turn.ts` (`runAgentTurn`): multi-turn tool-use loop (model → `tool_use` → execute → `tool_result` → repeat), max 15 iterations, summarize-on-cap. Read tools auto-run; **write tools pause** with `status: "needs_approval"` + `pending: PendingAction[]`; resumed with `approvedToolUseIds` / `deniedToolUseIds`. Transcript (`AgentMessage[]`) serializes to/from the client as JSON. This is the Claude-Code `query→tool_use→tool_result` loop adapted for a product with an approval gate.
- **tRPC** — `v1.ai.run({ message })` and `v1.ai.resume({ transcript, approvedToolUseIds?, deniedToolUseIds? })`, both `ownerOrOfficeNoTx`. Output: `{ status, text, pending: [{ toolUseId, tool, argsJson }], transcript: string, usage }`. `PRECONDITION_FAILED` when `ANTHROPIC_API_KEY` unset.
- **Tools** — `modules/ai/infra/agent-tools.ts`: 5 tools (`customer_list`, `invoice_list`, `estimate_list` = reads; `quote_draft`, `invoice_send` = writes). Each wraps the same **use-case** the tRPC API uses. A tool's `mutating` flag drives the approval gate. `ToolContext.orgId` comes only from the verified principal — `orgId` is NEVER a tool input (prompt-injection defense). Per-tool execution opens a fresh `withTenant(orgId)` tx + `OutboxEventBus`.
- **Anthropic client** — `modules/ai/infra/anthropic-llm-client.ts`: Opus 4.8, streaming + `.finalMessage()`, adaptive thinking, `output_config.effort`, prompt caching on the last tool + system block (byte-identical across tenants).
- **MCP server** — `app/mcp/route.ts`: HTTP-streamable, Bearer `mallet_sk_…` key auth (`api_keys` + `app_resolve_api_key` SECURITY DEFINER), role-gated (owner/office), RLS-tenant-scoped. Exposes the same 5 tools. Approval via `tool_confirmations` propose→confirm (frozen args, fingerprint-drift detection, single-use tokens, 3-min TTL, RLS). Key issuance: `scripts/issue-mcp-key.mjs`.
- **Counter UI** (`features/counter/*`, `components/shell/command-bar.tsx`): today an entirely rule/keyword-driven engine (regex `router.ts` → `execute.ts`), synchronous, local, **no LLM**. It has the approval/visualization we're keeping:
  - `GateBlock` (`artifacts.tsx`): recipient + ghost-text draft → amber "Send" (editable via "Change") → 30s undo countdown.
  - `RunBlock` (`run-block.tsx`): ticking receipt (rows tick in at 450ms) + one footer "Send all N" gate.
  - `deriveSuggestions()` (`matcher.ts`): the curated empty-state example prompts, computed from live state.
  - `commitOkSend` (`features/home/send.ts`): the shared send primitive with exact undo.

**The gaps this project closes:** (1) only 5 tools; (2) nothing is wired to a UI — `/assistant` is a redirect and the box is the separate rule engine; (3) no approval UI bound to `needs_approval`.

## Decisions (locked)

1. **Full-LLM routing.** Every box submit → `v1.ai.run`. The rule router (`router.ts`, `execute.ts`, matcher verb-routing) is retired. Accepted tradeoff: known one-liners now cost an LLM round-trip (~1–2s); mitigated by an immediate "thinking" state + prompt caching. Server-sent streaming is a later polish.
2. **Command-bar form** (not a persistent chat). Each submit is one agent run rendered as in-flow artifact cards. The transcript lives only across a single run→resume cycle (client-held) — **no chat-history DB persistence** this build.
3. **In-app first.** Build the expanded tools + wire the in-app agent. The external MCP server already exists and inherits the tools; a key-management UI + docs are a fast follow-on, out of scope here.

## Architecture

```
CommandBar (kept)  ── submit(message) ──▶  v1.ai.run({ message })
   │                                            │  runAgentTurn: model↔tools loop (server)
   │                                            ▼
   │   ◀── { status:"completed", text, transcript } ── render text/read artifact
   │   ◀── { status:"needs_approval", pending[], transcript } ── render approval card(s)
   │
   └── user approves/denies ──▶ v1.ai.resume({ transcript, approvedToolUseIds, deniedToolUseIds })
                                     └── loop continues → more pending, or completed
```

- **Routing:** `use-counter.submit()` is the seam. It calls `api.v1.ai.run.useMutation`. The local `route()`/`executePlan()` path is removed.
- **Rendering:** the agent's final `text` + read results render as an in-flow artifact (new `ai-result` artifact kind or reuse `confirm`). `pending[]` (write tools awaiting approval) render as `GateBlock`-style cards (single write) or a `RunBlock`-style ticking receipt with one "Approve all N" (multiple writes). "look at each" expands each proposed action's human summary + args preview.
- **Approval action:** approving triggers `v1.ai.resume` with the approved `toolUseId`s; the **server** executes the write tools (via use-cases, tenant-scoped) — the client no longer commits store writes for these. On resume `completed`, the store re-hydrates the affected domains (invalidate the relevant `v1.*.list` queries so the existing hydrators refresh) so the UI reflects the persisted change.
- **Suggestions:** `deriveSuggestions()` stays; clicking a suggestion submits its text to `v1.ai.run`.

## Tool expansion (the core work)

Every tool wraps an existing **use-case** in `modules/*/app/*` (never a repository directly for writes). Implementation rules (from the existing `quote_draft` pattern):

- `orgId` is NEVER an input — only `ToolContext.orgId` from the principal.
- `mutating: true` for writes (drives the approval gate), `false` for reads.
- Writes carry a **fingerprint** = the minimal string identifying the entity state the human reviewed (status/amount/recipient); if it changes between propose and execute, refuse cleanly (matches the `tool_confirmations` fingerprint law for the external surface; the in-process loop enforces the equivalent via re-validation on resume).
- Upper-bound all numeric inputs in the Zod schema.
- `summary` on the outcome is human-readable prose ("Sent invoice INV-042 for $1,200.00 to Jane Smith"), read back to the user.
- Errors are actionable + PII-free ("customer abc123 not found — use customer_list to find the right id").
- No money/phone/email in input-schema description strings.

**Phase A — reads (auto-run, no approval):** `customer_get`, `estimate_get`, `invoice_get`, `job_list`, `job_get`, `task_list`, `member_list`, `notification_list_due_reminders` (chase feed), plus `visit`/schedule reads, `timesheet_list`, `company_list`/`company_get`.

**Phase B — writes (approval-gated):** `quote_send`, `notification_send_invoice_reminder`, `job_schedule`, `job_assign`, `task_create`, `customer_create`, `invoice_draft`, `invoice_create_from_job`, `schedule_visit`.

**Phase C — sensitive (highest scrutiny):** `invoice_record_payment` (idempotency key in frozen args), `invoice_void` (destructive), `timesheet_approve_week` (payroll-adjacent, owner/office), payment-link (conditional on Stripe configured).

Tools are registered in one registry (`agent-tools.ts`) shared by the in-process loop and the MCP server. The in-app router (`v1.ai`) stays `ownerOrOffice`; a tech-facing agent with a field-only tool subset is a separate future router (not this build).

## Security invariants (must-not violate)

- Tenant isolation: `orgId` from the verified principal only; tools run in `withTenant(orgId)`; never trust client/model-supplied org.
- Role gate: `v1.ai` is owner/office only.
- Approval on every write: no write tool executes without the user's `approvedToolUseIds` (in-app) / confirm token (MCP).
- Fingerprint drift → refuse (what-you-approved-is-what-runs).
- No raw DB errors or PII to the model/client.

## Out of scope (this build)

Persistent chat history/DB; server-sent (SSE) streaming of intermediate agent events; external MCP key-management UI + docs; a tech-facing agent surface; multi-step "plans" the user edits before running (the approval gate is per-tool).

## Testing

- Tool unit tests: each tool's input validation + outcome summary + error path (mirror existing agent-tool tests).
- Integration (hasDb): each write tool round-trips through its use-case + persists + is tenant-isolated (cross-org denied); the loop's needs_approval → resume → completed path.
- Frontend: the box submit → run → approval-card → approve → resume flow (component/e2e).
- Every phase lands as a PR with the repo's full gate (typecheck, lint, unit, int, coverage, build) + adversarial review, per house process.
