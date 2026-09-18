# Audit Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per task, adversarial review per task, full gate before the PR.

**Goal:** Fix every actionable finding from the 2026-07-16 design-principles audit (9-dimension,
adversarially verified). One PR: `fix/audit-hardening` off main (includes #109).

**Explicitly parked by Owen:** Supabase credential rotation + the CI integration-test job that
depends on those secrets (his call — "don't really care"). Also deferred: the jobs-slice 1228-line
split (the parallel perf workstream may restructure the same file — do not touch it here).

## Global Constraints

- Tenant safety unchanged (org from principal; RLS; org-scoped queries). No behavior changes beyond
  the fixes below. TDD where a fix is logic (cursor, throttle, batching); mechanical config edits
  need only the gate.
- Full gate before the PR: `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm test` ·
  task-specific int files (full int suite hangs on shared-DB contention — known) · `npm run
  coverage` (80/75) · `npm run build`.
- Migrations single-writer: next number is **0082** (verify); additive only; VERIFY DDL applied live
  (the silent no-op gotcha — which task F3 also permanently mitigates via `db:verify`).

---

### Task F1: Quick correctness + config batch (all mechanical)

**Files:** `shared/types/pagination.ts` · `.env.example` · `scripts/vercel-prod-setup.sh` ·
`next.config.ts` · `e2e/` + `vitest.config.ts` comment · playwright config if screenshot specs move.

1. **MAX_PAGE_SIZE 100 → 500** (`shared/types/pagination.ts:11`) with a comment tying it to
   `HYDRATOR_PAGE_LIMIT` (lib/store/hydrator-config.ts) — ends the silent hydration truncation.
   Extend the existing pagination unit test: `toPage({limit: 500})` returns 500, 501 clamps to 500.
2. **`.env.example`**: add `APP_DATABASE_URL` (comment: runtime app connection, least-privilege
   `mallet_app` role, NOBYPASSRLS) and clarify `DATABASE_URL` = migrations/admin only; add
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with the build-time-baking note.
3. **`scripts/vercel-prod-setup.sh`**: add `VAPI_WEBHOOK_SECRET` to the include list OR a commented
   "live features — set manually" block mirroring the STRIPE_WEBHOOK_SECRET guidance (read the
   script and match its style).
4. **Security headers** (`next.config.ts`): `headers()` adding `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Strict-Transport-Security: max-age=63072000; includeSubDomains` on `/(.*)`. NO CSP yet (inline
   styles everywhere — a CSP would need real design; out of scope).
5. **Honest test inventory**: move the zero-assertion screenshot scripts out of `e2e/` to
   `scripts/screenshots/` (update any playwright config globs so `e2e/` holds only behavioral
   specs); add a comment in `vitest.config.ts` documenting that coverage excludes `app/api/**`.

### Task F2: LLM-path resilience + agent observability (+ write-tools dedupe)

**Files:** `app/api/trpc/[trpc]/route.ts` · `app/api/vapi/route.ts` ·
`modules/ai/infra/anthropic-llm-client.ts` · `modules/ai/app/run-agent-turn.ts` ·
`modules/ai/api/ai-router.ts` · `modules/ai/infra/tools/write-tools.ts` (+ module barrels).

1. tRPC route: `export const maxDuration = 300; export const runtime = "nodejs";` (mirror how the
   cron/MCP routes declare theirs). Vapi route: `maxDuration = 60`.
2. Anthropic client: construct with `timeout: 180_000, maxRetries: 0`, and wrap the API call in the
   EXISTING platform `call()` helper + `CircuitBreaker("anthropic")` exactly as Twilio/Resend do
   (find the wrapper in shared/platform or notifications infra — reuse, don't reinvent).
3. `run-agent-turn.ts` catch (~:84): `logger.error({ toolUseId, tool, err }, "agent.tool.threw")`
   before mapping to the tool-error string (keep the graceful degradation — log, don't rethrow).
4. `ai-router.ts`: after each runAgentTurn resolution log
   `logger.info({ orgId, status, iterations, inputTokens, outputTokens, cacheReadTokens }, "agent.turn.completed")`
   — copy the field style of the voice path's RunToolCallsUseCase logging. Use whatever usage data
   runAgentTurn already returns; if tokens aren't surfaced, thread them from the client response
   (small, contained change).
5. **write-tools dedupe**: add a `parseTool<T>(schema, raw)` helper (one safeParse per boundary —
   kill the 14 fingerprint/handle double-parses); export the internals the tools reach for
   (`DrizzleReminderTargetReader`, `STUB_EXTERNAL_ID`, `ManualPaymentGateway`) from their module
   barrels and import via the barrels. Behavior identical; existing tests must stay green.

### Task F3: Data-layer fixes (cursor · throttle · index · db:verify · batching)

**Files:** `modules/tasks/infra/drizzle-task-repository.ts` (+ its int test) ·
`app/api/inbound/[channel]/[token]/route.ts` (+ modules/inbound) · `shared/db/schema/jobs.ts`
(indexes) + migration 0082 · `package.json` + `scripts/db-verify.ts` ·
`modules/quoting/infra/drizzle-estimate-repository.ts` ·
`modules/invoicing/infra/drizzle-invoice-repository.ts` · `modules/customers/api/lead-router.ts`.

1. **Tasks cursor**: encode all three sort keys `(dueDate, createdAt, id)` in the cursor with a
   three-column row-value comparison + NULLS LAST handling (the repo comment at :69-71 describes
   the bug). Failing int test FIRST: seed tasks straddling a page boundary with equal createdAt +
   distinct dueDates (incl. a null dueDate) → paging must neither skip nor duplicate.
2. **Inbound-form throttle**: before DB work in the POST, per-token cooldown — query the newest
   lead for this org/source (`created_at`), reject with 429 when younger than `INBOUND_MIN_GAP_SECONDS
   = 5` (constant). DB-backed (works across serverless instances), no schema change. Unit/int test:
   two immediate posts → second is 429; spaced posts pass.
3. **Indexes** (migration **0082**, additive): `job_visits (org_id, scheduled_date)` index +
   partial index on `jobs (org_id) WHERE callback_reason IS NULL AND callback_of IS NOT NULL` —
   name per house convention. Verify DDL applied live.
4. **`db:verify`**: `scripts/db-verify.ts` — compares the live `drizzle.__drizzle_migrations`
   last-applied tag against the journal's last entry; exit 1 with a loud message on divergence.
   `package.json`: `"db:verify": "tsx scripts/db-verify.ts"`; document in CLAUDE.md's migration
   workflow (after `db:migrate`, run `db:verify`).
5. **Batch upserts**: estimate + invoice repos' per-line loops → single multi-row
   `.values([...]).onConflictDoUpdate` following the jobs repo's `replaceLines` pattern;
   `importCustomers` row loop → batched inserts with per-row error reporting preserved. Existing
   int tests must stay green (they pin behavior).

### Task F4: The constitution + docs refresh

**Files:** create `docs/design-principles.md` · `CLAUDE.md` · `README.md` · the 6 plan/spec files
citing the old path.

1. Create **tracked** `docs/design-principles.md` — the canonical Core Design Principles (Owen's
   list: SOLID/DI/ports/repository/DTO-split/validate-at-boundaries/no-silent-failures/test-pyramid
   + the house YAGNI scoping: resilience for real external calls only). Source it from the
   CLAUDE.md:73-75 inline summary + the audit's constitution references; keep it one page.
2. Repoint every `.superpowers/sdd/design-principles.md` reference (CLAUDE.md + grep
   docs/superpowers for the rest) to `docs/design-principles.md`.
3. README: replace the frozen "Phase 0 T0.1 scaffold" status with the current reality (17 modules,
   live voice front desk, the four pillars + agent bar, migrations count) — keep it short.
4. CLAUDE.md: enumerate all 17 modules in the architecture section (one line each); add the
   `db:verify` step to the migration workflow (F3 lands it).

**→ Full gate, then ONE PR: "fix: audit hardening — correctness, resilience, observability, docs".**

## Self-review (done)

- Coverage vs audit top-10: #1 F1.1 · #2 parked (Owen) · #3 F2.1-2 · #4 F2.3-4 · #5 F1.2-3 ·
  #6 F3.1 · #7 F3.2 · #8 F3.3-4 · #9 F3.5 · #10 F4. Mediums: write-tools F2.5, headers F1.4,
  e2e honesty F1.5. Deferred: jobs-slice split (perf workstream), CI int job (parked creds). ✓
- No task collides with the parallel perf diagnosis (read-only) or its future branch. ✓
