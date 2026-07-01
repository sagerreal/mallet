# ADR 0007: Server-enforced propose→confirm flow for mutating MCP tools

- **Status:** Accepted
- **Date:** 2026-07-01
- **Context:** ADR 0006 shipped the remote MCP server with mutating tools (`quote_draft`, `invoice_send`) hard-filtered off the surface, because a raw MCP host *is* the loop and may auto-approve, and MCP tool annotations are untrusted hints. This slice unblocks them with the deferred server-enforced confirm flow. Design validated by a 3-angle research workflow (MCP-spec alternatives / industry patterns / adversarial security pass).

## Decision

### 1. Two-call confirm-token flow — not MCP elicitation

The first call to a mutating tool takes **no action**: it validates the args, snapshots the referenced entity's state, freezes both into a `tool_confirmations` row, and returns a human-readable proposal + a one-time `mallet_confirm_` token. Only a second call presenting that token executes — and it executes the **frozen** args against **unchanged** entity state.

**Elicitation was evaluated and rejected for this transport.** MCP's elicitation capability is a server→client JSON-RPC request mid-call; on Streamable HTTP it can only be delivered over an SSE stream with a session to route the reply back. With our stateless `enableJsonResponse: true` transport, SDK 1.29 **silently drops** the server-initiated request and `elicitInput()` hangs until timeout (verified in `webStandardStreamableHttp.js` `send()` — a `relatedRequestId` request is only written when `!enableJsonResponse && stream`). The Claude Messages API MCP connector — the most likely consumer — supports tool calls only, no elicitation. The token flow works with **every** host. If Mallet ever moves to a sessionful/SSE transport, elicitation can be layered on via `getClientCapabilities()` with the token flow as fallback.

Industry alignment: read-only-by-default scoping is the dominant vendor pattern (GitHub `--read-only`, Stripe action allowlists, Cloudflare OAuth-scoped registration); the token flow is *additive* on top of Mallet's existing hard scoping and matches the "deterministic controls, not annotation hints" guidance. Enforcing at the **executor** (not just the listing) avoids the GitHub MCP bug class where list-time filtering failed to restrict calls.

### 2. What the gate binds (each closes a specific attack)

- **Args frozen at propose** — the confirm call's own arguments are ignored; what the human read is exactly what runs (kills bait-and-switch).
- **Entity fingerprint** — mutating tools implement `fingerprint(input, ctx)` (e.g. `invoice:<id>:<status>:<total>:<amountPaid>`, `lead:<id>:<name>:<stage>`), snapshotted at propose and re-computed at confirm in the execution tx; mismatch refuses with "changed since proposal — re-propose" (kills TOCTOU drift: approving "send INV-042 for $500" can't send the $9,500 it was edited into).
- **Re-validation at confirm** — frozen args are re-parsed against the *current* zod schema, so a schema tightened between propose and confirm still applies. Input schemas gained upper bounds (`lines ≤ 100`, `quantity ≤ 10k`, `rateCents ≤ $100k`) so a proposal can't freeze an absurd estimate.
- **Single-use, atomically** — consume is one guarded `UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING` (the ATOMIC-GUARD pattern): concurrent confirms cannot both execute. Consume + execute share one tx — an unexpected throw rolls the consume back (transient failures retryable); a clean refusal (drift/validation) **commits** it (stale approvals don't get retries). Both current mutating tools have outbox-only side effects, so a rollback can never replay an external send; that is now a standing requirement for any tool exposed here.
- **Bound to tool + org + proposing key** — the consume predicate matches `tool` and `created_by`, and RLS (ENABLE+FORCE on `tool_confirmations`) scopes to the org; a leaked raw token is useless cross-tenant *and* cross-key.
- **Short TTL (3 min) + pending cap (20/key)** — the token necessarily travels in-band (transcripts, host logs), so the window is minutes; the cap stops proposal-row griefing. Only the SHA-256 hash is stored; the raw token is never logged server-side.
- **Role gate first** — `owner|office` checked as the first statement of the executor, both legs, before any DB work (a `tech` key can't even mint proposals). The listing hides tools from disallowed roles, but the executor is the enforcement.

### 3. The proposal reply is a NORMAL result, not `isError`

ADR 0006 sketched "first call returns `isError` + token"; both the spec review and the security pass flagged that hosts variously swallow, auto-retry, or re-plan on `isError`, which would burn proposals and hide the summary. A proposal is the *expected* first step — so it returns `isError: false` with text that states unambiguously that nothing ran. `isError: true` is reserved for genuine failures (invalid input, bad/expired token, drift refusal, pending-limit).

## Accepted trade-off (stated honestly)

This is **not a hard human gate**. The token is in-band; an autonomous host — or a model steered by prompt-injected tenant data — can echo it back without a human. What the flow guarantees: **no one-shot mutation** (two deliberate round-trips, proposal visible in context), **what-you-saw-is-what-runs** (frozen args + fingerprint), and an **audit row** for every proposal/confirm. A true out-of-band approval (confirm via an authenticated dashboard/SMS click, `confirm_requires_oob` per key) is the real fix and is deferred until a web surface exists.

## Deferred

- **Out-of-band approval** (above) — the upgrade path keeps this flow intact: OOB flips *who* can set `consumed_at`.
- Purge sweep for expired/consumed rows (`tool_confirmations_expires_idx` is in place for it).
- Read-only key tier (`mallet_sk_ro_`) to match the Stripe/Cloudflare scoped-credential norm.
- Per-key rate limiting on `/mcp` (carried from ADR 0006; the pending cap covers proposal-row DoS specifically).
- Distinguishing "expired" from "invalid" in the refusal text (kept indistinguishable for now — no oracle).

## Consequences

- Mutating tools are callable by external MCP hosts with the server, not the host, enforcing the two-step. The in-process agent loop is untouched (its pause/approve seam predates this and doesn't pass through the MCP executor).
- `AgentTool` gained `input` (the zod source of `inputSchema`, used for both propose- and confirm-time validation) and optional `fingerprint`.
- New table `tool_confirmations` (migrations 0019/0021 + RLS 0020); store logic in `modules/ai/infra/confirmation-store.ts`; the gate in `modules/ai/api/mcp-confirm.ts`.
- Verified by live-RLS integration tests: propose-freezes/no-execute, confirm-executes-frozen-args, single-use replay, expiry, cross-org (RLS), cross-principal (created_by), fingerprint drift (token consumed), pending cap; hermetic tests cover the role gate, throw containment on both paths, and token/summary purity.
