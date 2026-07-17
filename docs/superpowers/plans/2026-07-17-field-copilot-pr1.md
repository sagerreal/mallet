# Field Copilot — PR1: Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per task, adversarial review per task, full gate before the PR.

**Goal:** The copilot's server spine: a tech-gated `run` endpoint reusing the existing agent loop
with a 3-tool read-only registry closed over the assignment-verified job — plus the
`jobSummaryDTO.total` money-leak fix. Text-only in this PR (photos = PR2, UI = PR3).

**Verified anchors (from the 2026-07-17 scoping — trust these):**
- Loop: `runAgentTurn` (modules/ai/app/run-agent-turn.ts:30-41) is registry-agnostic
  (`RunAgentParams = { llm, system, tools, execute, userMessage, priorMessages, approved/deniedToolUseIds, effort, maxIters }`);
  ToolMeta/ExecuteTool pure at :15-22.
- Office composition to clone: `drive()` + tool wiring in modules/ai/api/ai-router.ts:385-427 —
  note the **NoTx pattern**: v1.ai.run uses `ownerOrOfficeNoTx` (trpc/init.ts:89) + SHORT
  per-tool `withTenant` tx (ai-router.ts:394-415) so no DB tx spans model round-trips.
  `transcriptSchema` zod at ai-router.ts:24-36.
- Field auth to clone: `assertOnJobIfTech` (modules/jobs/api/field-router.ts:22-34),
  `redactMoneyForTech` (:47-60), `getTechSeesPrice`
  (modules/settings/infra/drizzle-settings-repository.ts:123-131), int-test pattern
  field-router.int.test.ts:110-145.
- The leak: `jobSummaryDTO.total` non-nullable (modules/jobs/api/job-dto.ts:155, mapped :267);
  `redactMoneyForTech` spreads `...dto` touching only lines/addons.

## Global Constraints

- Design principles binding (`docs/design-principles.md`). Tenant safety: org from
  `ctx.principal.orgId` only; tools closed over the VERIFIED jobId — the model never supplies ids.
- Advise-only: every tool `mutating: false`; the endpoint is `run` only (no resume/approval).
- All money context through `redactMoneyForTech` + total exclusion BEFORE prompt assembly; cost
  never present; the system prompt forbids stating prices when redacted (mirror the front-desk
  price-guardrail discipline).
- No `any`; fns <50 lines; TDD; full gate before the PR (`tsc · lint · unit · int(files) ·
  coverage · build`).

---

### Task B1: `anyRoleNoTx` + the total-leak fix

**Files:** `trpc/init.ts` · `modules/jobs/api/job-dto.ts` · `modules/jobs/api/field-router.ts`
(+ its int test) · anything reading `total` off jobSummaryDTO client-side
(lib/store/dto-mapper.ts:339 `cachedTotal` — handle null).

1. `anyRoleNoTx`: clone `ownerOrOfficeNoTx` (init.ts:89) with roles owner|office|tech. Same
   principal resolution, NO orgTx.
2. Leak fix: `jobSummaryDTO.total` → `moneyDTO.nullable()`; `toJobSummaryDTO` keeps emitting it;
   `redactMoneyForTech` sets `total: null` when `!seesPrice`. Thread the nullable through
   `dtoJobToStoreJob` (`cachedTotal: dto.total?.cents ?? null` — check the store type) and any
   office consumers (office paths always have seesPrice=true semantics — verify none break).
3. Tests: field-router int — a tech with techSeesPrice=false receives `total: null` in myDay
   (and setVerifyAnswer responses); office caller still gets cents. Unit: redaction helper.
- [ ] Commit `fix(field): null jobSummaryDTO.total for redacted techs + anyRoleNoTx procedure`.

### Task B2: The field tool registry + system prompt (pure/infra)

**Files:** Create `modules/ai/infra/tools/field-read-tools.ts` (+ unit test) ·
`modules/ai/app/field-copilot-prompt.ts` (+ test).

1. `buildFieldTools(deps)` returning THREE read-only ToolMeta+executors, each taking NO id inputs
   (closed over `{ orgId, jobId, seesPrice }` passed by the router):
   - `get_my_job` — the assignment-verified job as a REDACTED summary (reuse toJobSummaryDTO +
     redactMoneyForTech + total stripped; include checklist, verifyAnswers, scope, notes, visits,
     photos METADATA (captions/verifyPass, no paths), lines/addons descriptions (+rate only if
     seesPrice), callbackOf/Reason, requiredCerts).
   - `get_org_service_context` — the org's booking services (name, lane, triggers,
     emergencyTriggers, requiredCerts — NO price, NO ballpark; the ballpark is an OWNER-spoken
     price and must not reach a redacted tech transcript).
   - `get_callback_history` — if this job has callbackOf, the original job's redacted summary +
     (if the original carried a checklist) its missed steps (reuse the compute-autopsy miss logic
     helpers if cleanly importable; else a minimal inline miss check).
   All `mutating: false`. Zod-validate any model-supplied args (there should be near-none).
2. `FIELD_COPILOT_SYSTEM_PROMPT` (a `buildFieldPrompt({ seesPrice, techName? })` fn): an on-site
   trade copilot — answer from THIS job's context (cite the checklist/scope when relevant); safety
   first (gas/electrical → stop-and-escalate language); NEVER state or estimate prices when
   `!seesPrice` (hard rule, mirrors the front-desk guardrail); when work beyond scope is found,
   end with a line `FOUND WORK: {short description}` (the UI parses this for the one-tap card —
   deterministic marker, one per reply max, description ≤80 chars, no prices in it when redacted).
3. Tests: each tool's executor against fakes (redaction asserted: no cost anywhere, no rate/total
   when !seesPrice, no ballpark ever); the prompt builder (redacted variant contains the
   no-prices rule; FOUND WORK marker format documented in one place).
- [ ] Commit `feat(ai): field copilot tool registry + system prompt`.

### Task B3: The `run` endpoint

**Files:** Create `modules/ai/api/field-copilot-router.ts` (+ int test); mount in the app router
(find where routers compose — trpc/root or modules index) as `v1.fieldCopilot`.

1. `run` on `anyRoleNoTx`, input zod:
   `{ jobId: uuid, message: string.min(1).max(2000), transcript: transcriptSchema.optional() }`
   (clone/adapt transcriptSchema from ai-router.ts:24-36; no photoIds until PR2).
2. Resolver (clone drive()'s shape): short `withTenant` tx → `assertOnJobIfTech(repo, jobId,
   principal)` (FORBIDDEN if not on the job) + job exists/non-deleted → `getTechSeesPrice` →
   build tools closed over `{orgId, jobId: VERIFIED, seesPrice}` (each tool run opens its own
   short withTenant tx, mirroring ai-router.ts:394-415) → `runAgentTurn({ llm: deps.llm, system:
   buildFieldPrompt(...), tools, execute, userMessage: message, priorMessages: transcript,
   effort: "medium", maxIters: 6 })` → return `{ text, transcript, status }`.
   Log `copilot.turn.completed` with orgId/userId/tokens (mirror agent.turn.completed).
3. Int test (clone field-router.int.test.ts:110-145 patterns + the ai router's fake-LLM seam —
   find how ai-router int/unit tests fake the LlmClient): tech ON the job → runs, transcript
   returned; tech NOT on the job → FORBIDDEN; office caller → allowed; a fake-LLM tool-use round
   trip proves get_my_job returns REDACTED data for a !seesPrice tech (assert no total/rate/cost
   in the tool result JSON).
- [ ] Commit `feat(ai): v1.fieldCopilot.run — tech-gated advise-only agent endpoint`.

**→ Full gate, then PR: "Field copilot PR1 — backend core (advise-only agent + money-leak fix)".**

## Self-review (done)

- Frame → tasks: advise-only+closure (B2/B3), NoTx discipline (B1/B3), leak fix (B1), price
  guardrail in prompt+tools (B2), FOUND WORK marker for PR3's card (B2). PR2/PR3/PR4 scope
  excluded. Security risks from scoping all addressed except rate-limiting (deliberate, spec'd). ✓
