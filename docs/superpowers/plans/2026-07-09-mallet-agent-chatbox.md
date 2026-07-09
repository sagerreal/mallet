# Mallet Agent Chatbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the "Ask Mallet" command bar to the existing LLM agent loop (`v1.ai.run`/`resume`), expand the tool set from 5 to the full platform action surface, and reuse the existing approval/visualization UI — so the user types anything and the agent does it, pausing for approval on writes.

**Architecture:** No change to the agent loop (`run-agent-turn.ts`) or the tRPC surface (`v1.ai.run`/`resume`) — both are correct. We (1) add tools to the shared registry (`agent-tools.ts`), each wrapping an existing use-case, tenant-scoped, reads-auto/writes-gated+fingerprinted; (2) rewire `use-counter.submit()` to call `v1.ai.run` and render results/approvals with the existing `GateBlock`/`RunBlock`; (3) retire the rule router. Spec: `docs/superpowers/specs/2026-07-09-mallet-agent-chatbox-design.md`.

**Tech Stack:** Next.js 16 App Router, tRPC v11 + React Query, Zustand, Anthropic SDK (Opus 4.8), Drizzle/Postgres + RLS, `@modelcontextprotocol/sdk`.

## Global Constraints

- Every tool wraps an existing `modules/*/app/*` use-case — never a repository directly for a write. Preserve invariants + domain events.
- `orgId` is NEVER a tool input — only `ToolContext.orgId` from the verified principal. Tools run in `withTenant(orgId)`.
- `mutating: true` on all write tools (drives the approval gate), `false` on reads. Writes carry a fingerprint; drift between propose and execute → refuse.
- Upper-bound all numeric inputs in Zod. No money/phone/email in input-schema description strings. Errors actionable + PII-free.
- `v1.ai` stays `ownerOrOffice`. Do not widen to `anyRole`.
- Follow the existing `quote_draft`/`invoice_send` tool shape and the `run-agent-turn` contract exactly — match, don't reinvent.
- Do not touch the protected Schedule board behavior (type-only if unavoidable).
- Each phase ends green: `npm run typecheck && npm run lint && npm run test`; integration tests written for tool round-trips (run with `npm run test:int` + DB).

---

### Task 1: Read-tool completeness (Phase A)

**Files:**
- Modify: `modules/ai/infra/agent-tools.ts` (register new read tools)
- Reference: existing `customer_list`/`estimate_list`/`invoice_list` tools in the same file; the use-cases in `modules/{jobs,tasks,timesheets,companies,customers,quoting,invoicing,identity}/app/*` and their DTO mappers
- Test: `modules/ai/infra/agent-tools.test.ts` (or the existing tool test file)

**Interfaces:**
- Consumes: the `Tool`/`ToolContext` types + `buildTool`-style factory already used in `agent-tools.ts`; each domain's list/get use-case.
- Produces: read tools `customer_get`, `estimate_get`, `invoice_get`, `job_list`, `job_get`, `task_list`, `member_list`, `company_list`, `company_get`, `timesheet_list`, `notification_list_due_reminders`, plus a schedule/visit read (`visits_for_day` or `job_get` returning visits). All `mutating:false`, `isReadOnly:true`.

- [ ] **Step 1: Write a failing test** for one new read tool (e.g. `job_list`) — asserts it returns a tenant-scoped list with a human `summary`, and that its schema rejects an `orgId` input.
- [ ] **Step 2: Run it, confirm it fails** (tool not registered).
- [ ] **Step 3: Implement the read tools**, each mirroring the existing `customer_list` tool: Zod input (filters only, no orgId), `call` opens `withTenant(ctx.orgId)`, invokes the domain list/get use-case, maps the DTO to a compact human-readable outcome (ids + the fields the model needs to act next), PII-safe. Register all in the tools array.
- [ ] **Step 4: Run tests, confirm pass.** Add a test per tool covering the happy path + the not-found/empty path.
- [ ] **Step 5: Commit** `feat(ai): add platform read tools (phase A) to the agent registry`.

---

### Task 2: Write tools with approval + fingerprint (Phase B)

**Files:**
- Modify: `modules/ai/infra/agent-tools.ts`
- Reference: `quote_draft`/`invoice_send` (the mutating-tool pattern incl. fingerprint + two-step prose); the write use-cases (`ScheduleJobUseCase`, `AssignJobUseCase`, `CreateTaskUseCase`, `EnsureCustomerUseCase`, `DraftEstimateUseCase`, invoice draft/createFromJob, `ScheduleVisit`, send-quote, invoice-reminder notification).
- Test: `agent-tools.test.ts` + a new `modules/ai/api/ai-write-tools.int.test.ts`

**Interfaces:**
- Produces: write tools `quote_send`, `notification_send_invoice_reminder`, `job_schedule`, `job_assign`, `task_create`, `customer_create`, `invoice_draft`, `invoice_create_from_job`, `schedule_visit`. All `mutating:true`, with a `fingerprint(input, ctx)` returning the reviewed entity-state string.

- [ ] **Step 1: Write a failing integration test** (hasDb) for `task_create`: run the loop with a message that triggers it, assert `status:"needs_approval"` with the task in `pending`, then `resume` with the approval and assert the task persisted + is tenant-isolated.
- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement the write tools**, each: bounded Zod input (ids + minimal fields, no orgId), `mutating:true`, `fingerprint` computed from the target entity, `call` wraps the use-case in `withTenant` + `OutboxEventBus`, returns a human `summary`. Match the `quote_draft` two-step description prose so the model narrates propose→confirm.
- [ ] **Step 4: Run tests, confirm pass.** Add approval-gated round-trip + cross-org-denied tests for the highest-value tools (`quote_send`, `customer_create`, `job_schedule`).
- [ ] **Step 5: Commit** `feat(ai): add approval-gated write tools (phase B)`.

---

### Task 3: Sensitive write tools (Phase C)

**Files:** `modules/ai/infra/agent-tools.ts`; tests as above.
**Interfaces:** `invoice_record_payment` (idempotency key minted into frozen args), `invoice_void` (destructive), `timesheet_approve_week` (owner/office). All `mutating:true`, `isDestructive:true` where applicable, fingerprint on amount/status.

- [ ] **Step 1: Write a failing int test** — `invoice_record_payment` proposes with an amount, fingerprint captures invoice status+balance; approving persists the payment idempotently; a second identical confirm does not double-charge.
- [ ] **Step 2: Run, confirm fails.**
- [ ] **Step 3: Implement** the three tools wrapping their use-cases; idempotency key in the frozen args; strict fingerprint; PII-free summaries.
- [ ] **Step 4: Run tests, confirm pass** incl. the double-confirm/idempotency + fingerprint-drift-refusal cases.
- [ ] **Step 5: Commit** `feat(ai): add sensitive money/payroll tools (phase C)`.

---

### Task 4: System prompt + org context

**Files:**
- Modify: `modules/ai/api/ai-router.ts` (the `run` system prompt) or wherever the prompt is assembled.
- Reference: the existing byte-identical system prompt; the tool `prompt()` descriptions.

- [ ] **Step 1:** Grow the system prompt to describe the full toolset's intent (look up → act → pause for approval on writes), keeping the cacheable prefix byte-identical across tenants.
- [ ] **Step 2:** Inject org/date context (business name, today's date) via a **non-cached** suffix block or a `get_context` read tool — do NOT break the cache prefix. Prefer the read-tool approach (`get_context` returns org name + today) to keep the prompt fully cacheable.
- [ ] **Step 3:** Verify the loop still runs; add/adjust the prompt snapshot test if one exists.
- [ ] **Step 4: Commit** `feat(ai): richer agent system prompt + org context tool`.

---

### Task 5: Chatbox wiring — submit → run

**Files:**
- Modify: `features/counter/use-counter.ts` (rewire `submit()`), `components/shell/command-bar.tsx` (loading state)
- Reference: `api.v1.ai.run.useMutation`; the existing `pushEntry`/artifact state; `lib/trpc/client.ts`
- Test: `features/counter/use-counter.test.ts`

**Interfaces:**
- `submit(message)` → `run.mutateAsync({ message })` → returns `{ status, text, pending, transcript }`. Store `transcript` in the entry's local state for a subsequent `resume`. Immediately push a "thinking…" entry; replace it with the result on resolve. On error (`PRECONDITION_FAILED` / network) push an actionable error artifact.

- [ ] **Step 1: Write a failing test** — `submit("who owes me money")` calls `v1.ai.run` (mocked) and pushes an artifact from the returned `text`; a `needs_approval` response pushes an approval artifact carrying `pending` + `transcript`.
- [ ] **Step 2: Run, confirm fails.**
- [ ] **Step 3: Implement** the rewired `submit`: call `run`, map `completed` → text artifact, `needs_approval` → a new `ai-approval` artifact kind ({ pending, transcript }), `refused` → note artifact. Show a thinking state while the mutation is in flight (`command-bar.tsx`).
- [ ] **Step 4: Run tests, confirm pass.**
- [ ] **Step 5: Commit** `feat(counter): route the Ask Mallet box through the LLM agent`.

---

### Task 6: Approval UI — pending → GateBlock/RunBlock → resume

**Files:**
- Modify: `features/counter/artifacts.tsx` (render `ai-approval`), `features/counter/run-block.tsx` (reuse for multi-pending), `features/counter/use-counter.ts` (approve/deny → resume), `features/counter/types.ts` (the `ai-approval` artifact kind)
- Reference: existing `GateBlock`/`RunBlock`; `api.v1.ai.resume.useMutation`; the hydrators' query keys for cache invalidation

**Interfaces:**
- Consumes: `pending: [{ toolUseId, tool, argsJson }]` + `transcript`.
- Produces: an approval card — one pending → `GateBlock`-style (summary + args preview + amber "Approve"); multiple pending → `RunBlock`-style ticking receipt + one "Approve all N" + "look at each". Approve → `resume({ transcript, approvedToolUseIds })`; Deny → `resume({ ..., deniedToolUseIds })`. On resume: if more `pending`, replace the card; if `completed`, render the final text + **invalidate the affected `v1.*.list` queries** so hydrators refresh the store.

- [ ] **Step 1: Write a failing test** — approving an `ai-approval` artifact calls `v1.ai.resume` with the right `approvedToolUseIds`; on a `completed` resume it invalidates the relevant list query.
- [ ] **Step 2: Run, confirm fails.**
- [ ] **Step 3: Implement** the `ai-approval` artifact + its render (single vs multi) + the approve/deny handlers wired to `resume`, + cache invalidation on completion. Reuse `GateBlock`/`RunBlock` visuals; map each `pending` to a human summary (from the tool's `summary`/args). Client-side tick over multiple pending to keep the receipt feel.
- [ ] **Step 4: Run tests, confirm pass.**
- [ ] **Step 5: Commit** `feat(counter): agent approval cards wired to v1.ai.resume`.

---

### Task 7: Retire the rule router + keep suggestions

**Files:**
- Delete/gut: `features/counter/router.ts`, `features/counter/execute.ts`, `features/counter/estimate-run.ts`, the rule-routing parts of `matcher.ts` and `use-counter.ts` (`route`/`executePlan`/`fireArmed`/`commitGate` local-write paths).
- Keep: `deriveSuggestions()` (now submits to the agent), `command-bar.tsx` chrome, `GateBlock`/`RunBlock`, `features/home/send.ts` (still used by the Home OK-queue — verify it's not orphaned).
- Reference: grep every consumer of the deleted exports and remove/redirect.

- [ ] **Step 1:** Grep all imports of `route`/`executePlan`/`Plan`/`Artifact` local kinds; enumerate consumers.
- [ ] **Step 2:** Remove the rule-routing code paths; keep `deriveSuggestions` wired to submit its text to `run`. Ensure the Home OK-queue (which uses `commitOkSend` directly) still works — it does not depend on the router.
- [ ] **Step 3: Run typecheck + tests**; fix fallout. Confirm the box still renders suggestions in the empty state and clicking one runs the agent.
- [ ] **Step 4: Commit** `refactor(counter): retire the rule router; box is fully LLM-driven`.

---

### Task 8: Whole-feature verification

- [ ] **Step 1:** Full gate — `npm run typecheck && npm run lint && npm run test && npm run build`.
- [ ] **Step 2:** Manual/e2e smoke: a read ("who owes me money"), a single write ("send Jane her quote" → approve → persisted), a multi-write ("remind everyone overdue" → Approve all N → persisted), a deny path, and an error path (ANTHROPIC_API_KEY unset → friendly message).
- [ ] **Step 3:** Adversarial whole-branch review (security: no orgId in any tool input, every write gated, tenant isolation held, no PII to model; UX: suggestions + approval visualization intact).
- [ ] **Step 4:** Use superpowers:finishing-a-development-branch.

## Self-review notes

- Spec coverage: tools (T1–3), prompt/context (T4), wiring (T5–6), router retirement (T7), verify (T8) — all spec sections covered.
- Type consistency: tool names here match the spec's inventory; `pending`/`transcript` shapes match `run-agent-turn`'s output contract.
- Out of scope confirmed absent: no chat-history DB, no SSE streaming, no MCP key-management UI.
