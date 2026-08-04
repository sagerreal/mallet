# Three Flows, Real Money — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three service flows (published price, priced on site, office quote) work
end-to-end including real payment collection — per
`docs/superpowers/specs/2026-08-03-three-flows-money-design.md`.

**Architecture:** Hexagonal modules (`modules/<domain>/{domain,app,infra,api}`); router →
use-case (Result) → domain → Drizzle repo; Zustand store with optimistic writes; Stripe via
the single `platform/adapters/stripe/stripe-client.ts` boundary; public pages under
`app/(public)` with token auth, mirroring `/q/<token>`.

**Tech Stack:** Next.js 16, tRPC v11, Drizzle + Supabase Postgres (RLS), Stripe Checkout
(destination charges, connected accounts), Vitest, `qrcode` (new dep).

## Global Constraints

- Org id ALWAYS from `ctx.principal.orgId` / `withTenant` — never client input.
- Money: integer cents in DB/domain, `{cents,currency}` DTO, DOLLARS in the store; convert in
  `lib/store/dto-mapper.ts` only. Bps for rates.
- Migrations: additive only, live shared DB; `npm run db:generate` → hand-check journal →
  `npm run db:migrate` → `npm run db:verify`. Applied migrations are immutable.
- UI: compose `components/ui` primitives + `--space/--type/--radius` tokens; no raw px
  (`lint:css` fails); no floating UI; functional copy; no dead buttons.
- Domain validation returns `Result`, no throws for expected failures; no silent failures —
  interactive sends surface PRECONDITION_FAILED (`assertDelivered` pattern).
- Coverage gate 80/75 (`modules/**/app/**` measured); every use case gets unit tests;
  cross-tenant refusal int tests for new endpoints.
- The `Simulate tap` fake-payment path MUST be gone at the end of this plan.
- Payment idempotency: the Stripe Checkout **session id** is the ledger idempotency key on
  both webhook and reconcile paths.

---

### Task 1: Schema — `estimates.job_id`, `invoices.po_number`, `invoices.public_token`

**Files:**
- Modify: `shared/db/schema/estimates.ts` (add `jobId` after `changeOrderForJobId` ~:118)
- Modify: `shared/db/schema/invoices.ts` (add `poNumber`, `publicToken` + partial unique index)
- Create: migration via `npm run db:generate` (next number; check `git status shared/db/migrations` first)
- Test: `npm run db:verify` after migrate

**Interfaces:**
- Produces: `estimates.job_id` uuid NULL, composite FK `(org_id, job_id) → jobs(org_id, id)`;
  `invoices.po_number` text NULL; `invoices.public_token` text NULL with
  `invoices_public_token_uidx ... WHERE public_token IS NOT NULL`.

- [ ] **Step 1:** In `estimates.ts` add column + composite FK (mirror the existing
  `jobs_source_estimate_fk` pattern in `jobs.ts:132-136`):

```ts
// column, near changeOrderForJobId:
jobId: uuid("job_id"),
// in the table's third-arg array, alongside existing FKs:
foreignKey({
  columns: [t.orgId, t.jobId],
  foreignColumns: [jobs.orgId, jobs.id],
  name: "estimates_job_fk",
}),
```

(`estimates.ts` must import `jobs` — check for an import cycle; `jobs.ts` already imports
`estimates`, so if TypeScript circular-import breaks, declare the FK from raw SQL in the
migration instead and keep only the column in the schema file. The migration SQL must exist
either way.)

- [ ] **Step 2:** In `invoices.ts`:

```ts
poNumber: text("po_number"),
publicToken: text("public_token"),
// index block:
uniqueIndex("invoices_public_token_uidx")
  .on(t.publicToken)
  .where(sql`public_token is not null`),
```

- [ ] **Step 3:** `npm run db:generate`, inspect the SQL (three ADD COLUMNs, one FK, one
  index — nothing else), `npm run db:migrate`, `npm run db:verify` (must exit 0).
- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit `feat: schema for estimate→job link, invoice PO + public token`.

---

### Task 2: Invoices from jobs carry the lines (and the deposit)

**Files:**
- Modify: `modules/invoicing/app/create-invoice-from-job.ts` (today: `lines: []` at :61, total
  snapshot at :53)
- Modify: `modules/invoicing/domain/job-reader.ts` + `modules/invoicing/infra/drizzle-job-reader.ts`
  (reader must return the priced lines, not just a boolean)
- Create: `modules/invoicing/domain/estimate-deposit-reader.ts` (port) +
  `modules/invoicing/infra/drizzle-estimate-deposit-reader.ts`
- Test: `modules/invoicing/app/create-invoice-from-job.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `job_lines` schema (`shared/db/schema/job-execution.ts:25-51`), `jobs.source_estimate_id`.
- Produces: invoices whose `invoice_lines` mirror priced job lines
  (`source_job_line_id` set), `total = Σ(qty×rate) + round(Σ × taxBps/10000)` when priced
  lines exist, and `depositPaidCents` copied from the source estimate's `dep_paid_cents`.
- Port: `EstimateDepositReader { depositPaidCents(orgId: string, estimateId: string): Promise<number> }`.

- [ ] **Step 1:** Failing tests: (a) a job with lines `[{description:"Drain cleaning", quantity:1,
  rateCents:9900}]`, `taxBps:0` → invoice has ONE line, `totalCents === 9900`, line
  `sourceJobLineId` set; (b) job with stale `totalCents: 0` but priced lines → invoice total
  derived from lines, not 0; (c) job with `sourceEstimateId` whose estimate has
  `dep_paid_cents: 5000` → `invoice.depositPaidCents === 5000`; (d) no priced lines → current
  fallback (total from `job.totalCents`, no lines) unchanged.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Widen the job reader to return
  `{ id, totalCents, taxBps, taxCents, leadId, title, num, sourceEstimateId, lines: {id, description, quantity, rateCents, costCents, position}[] }`;
  implement derivation + line copy + deposit read in the use case (deposit reader injected,
  returns 0 when no source estimate). **Step 4:** PASS. **Step 5:** Wire DI where the use case
  is constructed (grep constructors — router + close-out path). `npm test`, commit
  `feat: invoices from jobs copy priced lines, derive totals, credit the deposit`.

---

### Task 3: Booked price lands on the job

**Files:**
- Modify: `modules/jobs/app/create-manual-job.ts` (command + lines write; `total: zeroMoney` at :96)
- Modify: `modules/jobs/api/job-router.ts` (`createJobInput` :120-131)
- Modify: `modules/frontdesk/app/tools/tool-result.ts` (`VoiceToolDeps` :29-57) and
  `modules/frontdesk/app/tools/book-visit.ts` (:251-262) and
  `app/api/frontdesk/vapi/route.ts` (`buildVoiceToolDeps` :289-319)
- Test: `modules/jobs/app/create-manual-job.test.ts`, `modules/frontdesk/app/tools/book-visit.test.ts`

**Interfaces:**
- Produces: `CreateManualJobCommand.lines?: { description: string; quantity: number; rateCents: number; costCents?: number }[]`
  — when present and priced, use case calls `repo.replaceLines(jobId, jobLines, now)` after
  `insertManual` (same tx; mirror `create-job-from-estimate.ts:103-133`) and sets job `total`
  to the priced sum. `VoiceToolDeps.pricebookPrices?: PricebookPriceReader`.

- [ ] **Step 1:** Failing tests: (a) command with one line `{description:"Drain cleaning",
  quantity:1, rateCents:9900}` → `replaceLines` called with rate 9900 and job total 9900;
  (b) no lines → exactly today's behavior (total zero, no replaceLines).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (validate: ≤200 lines, rate/qty ≥ 0, integer
  cents — reject non-integers with a domain validation error). **Step 4:** PASS.
- [ ] **Step 5:** Router: add optional `lines` to `createJobInput` (zod: max 200,
  `rateCents: z.number().int().min(0)`, `quantity: z.number().min(0)`).
- [ ] **Step 6:** book_visit: in `bookConfirmed`, for `lane === "flat"`, resolve the service's
  price — `resolveBookingPrices(settings.props.booking.services, deps.pricebookPrices)` then
  find by exact `service_name`; when a price exists pass
  `lines: [{ description: input.service_name, quantity: 1, rateCents: Math.round(price * 100) }]`.
  Build the reader in `buildVoiceToolDeps` from the existing
  `DrizzlePricebookPriceReader`. Estimate lanes NEVER get lines. Test: flat booking with a
  pricebook-linked service writes the RESOLVED price; estimate booking writes none.
- [ ] **Step 7:** Full unit suite, commit `feat: flat bookings persist the quoted price as a job line`.

---

### Task 4: Convert-on-accept — the same job becomes the work

**Files:**
- Modify: `modules/quoting/domain/estimate.ts` (add `jobId` prop; STOP faking depPaid — see
  Step 5), `modules/quoting/app/draft-estimate.ts` (:107-122 input), 
  `modules/quoting/api/estimate-router.ts` (draft input ~:214, accept ~:721-782),
  `modules/quoting/infra/drizzle-estimate-repository.ts` + `estimate-mapper.ts` (persist/read `jobId`)
- Modify: `modules/jobs/app/create-job-from-estimate.ts` (convert branch),
  `modules/jobs/domain/job-repository.ts` + `modules/jobs/infra/drizzle-job-repository.ts`
  (new `adoptEstimateOnJob`)
- Modify: `modules/quoting/app/public-quote.ts` (:204-216 passes through unchanged — the use
  case decides mint vs convert)
- Modify: `features/pipeline/board-cards.tsx` (:206-209 add `&job=`),
  `app/(office)/composer/page.tsx` (persist `?job=` as draft `jobId`)
- Test: `modules/jobs/app/create-job-from-estimate.test.ts`, estimate draft/accept tests,
  `modules/quoting/api/quoting.int.test.ts` (extend)

**Interfaces:**
- Consumes: `estimates.job_id` (Task 1).
- Produces: `JobRepository.adoptEstimateOnJob(orgId, jobId, patch: { sourceEstimateId: string; totalCents: number; taxBps: number; taxCents: number; title: string | null }, lines: JobLine[], now: Date): Promise<boolean>`
  — one UPDATE setting `kind='work'`, `source_estimate_id`, totals/title + `replaceLines` +
  seed ONE pending visit (position after existing) in the same tx; returns false when the job
  is missing or already `kind='work'` with a different `source_estimate_id`.

- [ ] **Step 1:** Failing use-case tests: (a) estimate with `jobId` pointing at a
  `kind='estimate'` job → NO new job inserted; that job flips to `work`, gets the sold lines,
  `sourceEstimateId`, and a new pending visit; (b) estimate without `jobId` → mints exactly as
  today; (c) idempotent re-accept (job already converted with same `sourceEstimateId`) →
  returns existing job id, no second visit seeded; (d) `jobId` pointing at a `kind='work'`
  job (someone converted or hand-linked) → falls back to the `findBySourceEstimate` /mint
  path, never mangles the work job.
- [ ] **Step 2:** FAIL. **Step 3:** Implement convert branch first in
  `CreateJobFromEstimateUseCase.exec`: read estimate (reader already returns what the mint
  uses; add `jobId`), if `jobId` → load job kind via repo; convert path calls
  `adoptEstimateOnJob`. **Step 4:** PASS.
- [ ] **Step 5:** Estimate domain/persistence: `jobId` through draft → repo → mapper → DTO
  (`estimateDTO` gains `jobId: string | null`). In `Estimate.accept()` (:405) and the
  field-sale path (:563): `depPaid` stays **0** (deposits are now paid, not assumed — Task 8
  records them). Update any test asserting the fake.
- [ ] **Step 6:** UI: `board-cards.tsx` verbAction →
  `router.push('/composer?lead=' + row.lead.id + '&job=' + row.scopeVisitJobId)` (the row
  already knows its scoped visit — see `features/pipeline/pipeline-utils.ts:25-31`; thread the
  job id onto the row if absent). Composer: `?job=` already seeds measurement lines
  (page.tsx:119); ALSO store it in composer state and send `jobId` on draft (~page.tsx:538).
- [ ] **Step 7:** Int test: accept an estimate with `jobId` against the live DB → same-job
  conversion, no duplicate; cross-tenant `jobId` (other org's job) → conversion refused
  (composite FK + org-scoped repo read both defend; assert the error, not a mangled row).
- [ ] **Step 8:** Full gate on touched suites, commit
  `feat: accepting a quote converts the scope-visit job instead of duplicating`.

---

### Task 5: Visit fee — real amount, collectable on a declined estimate visit

**Files:**
- Modify: `components/modals/close-out-modal.tsx` (`presetFee()` :210-213 hardcodes "89")
- Modify: `components/modals/tech-job-modal/done-block.tsx` (`ScopeHandoffBlock` :64-87) and
  `components/modals/tech-job-modal/tech-job-modal.tsx` (fee entry point)
- Test: component tests beside each file (follow the existing `*.test.tsx` pattern there)

**Interfaces:**
- Consumes: `useStore(s => s.booking.serviceFee)` (dollars, settings slice :102) — hydrated
  for office AND field shells (verify `features/settings/settings-hydrator.tsx` mounts in the
  field layout; if not, read via `trpcVanilla.v1.settings.get` once — do NOT invent a second
  store field).
- Produces: on an unpriced estimate visit's handoff block, a `Collect the visit fee — $X`
  button that (1) creates a draft invoice for the job's lead with ONE line
  `{description: "Visit fee — service call", quantity: 1, rate: serviceFee}` via the store's
  existing invoice-create action, (2) sends it (status `sent` — `recordPayment` refuses
  drafts), (3) `pushModal(MODAL.CLOSE_OUT, { jobId })` where DueCard/PayBlock already work.

- [ ] **Step 1:** Failing tests: (a) `presetFee` uses `serviceFee` 129 → amount "129";
  (b) ScopeHandoffBlock with org fee $89 renders `Collect the visit fee — $89` and the quiet
  handoff button stays; (c) fee button absent when a fee invoice already exists for the job.
- [ ] **Step 2:** FAIL → implement → PASS. Keep copy functional; no new styling primitives.
- [ ] **Step 3:** Commit `feat: declined estimate visits can collect the org's visit fee`.

---

### Task 6: Real card at the door — QR checkout replaces the fake tap

**Files:**
- Modify: `components/modals/close-out-modal.tsx` (PayBlock :490-735; DELETE the tap-step
  simulation :564-605)
- Create: `components/shared/checkout-qr.tsx` (QR render of a URL via `qrcode` → data-URL `<img>`)
- Modify: `package.json` (add `qrcode` + `@types/qrcode`)
- Test: `components/shared/checkout-qr.test.tsx`, close-out tests

**Interfaces:**
- Consumes: `v1.invoicing.createPayment` (`invoice-router.ts:462-476`) → `{url}`; invoice
  must be `sent|partial` first (send the draft before minting — the existing close-out flow
  already sends drafts, but it does it AFTER recording; reorder: send → charge).
- Produces: PayBlock "card" method step = mint session → show QR + `Open payment page`
  (anchor, `target="_blank"`) → poll `trpcVanilla.v1.invoicing.get({id})` every 4s (wall-clock
  cap 5 min, precedent `features/field/hooks.ts`) → on `paid|partial` advance to done. A
  visible `They paid another way — record it instead` link falls back to the record step.
  If `createPayment` fails with PRECONDITION_FAILED (no Connect), show the error sentence and
  the record-step fallback — never a dead end.

- [ ] **Step 1:** `pnpm add qrcode && pnpm add -D @types/qrcode` (worktree uses pnpm).
- [ ] **Step 2:** Failing tests: checkout-qr renders an `img` with `alt="Payment QR code"`
  from a URL; close-out card step calls createPayment once and renders the QR + open link;
  poll flip to `paid` advances to done; PRECONDITION_FAILED shows message + fallback.
  (Mock `trpcVanilla`; mock `qrcode` in the close-out test.)
- [ ] **Step 3:** FAIL → implement → PASS. Verify `v1.invoicing.get` exists; if only `list`,
  add a thin `get` procedure (ownerOrOffice + tech-visible? close-out runs on the FIELD shell:
  check which procedures the field role may call — `recordPayment` is already called from
  close-out, mirror its role gating for `createPayment`/`get`; widen with the same
  `assertOnJobIfTech`-style guard if they are office-only today).
- [ ] **Step 4:** Commit `feat: door card payments are a real Stripe checkout, fake tap deleted`.

---

### Task 7: Public invoice page, pay link, send-delivers, reconcile

**Files:**
- Create: `modules/invoicing/app/public-invoice.ts` (mirror `modules/quoting/app/public-quote.ts`:
  `resolveInvoiceOrgByToken`, `getPublicInvoice`, `createPublicInvoiceCheckout`)
- Create: `app/api/public/invoice/[token]/route.ts` (GET view; POST `{action:"create_checkout"}`)
- Create: `app/(public)/i/[token]/page.tsx` + line/summary presentation (copy the `/q` page's
  structure; lines, totals, deposit credit, `Net N · due <date>`, `PO <n>`, status pill;
  primary `Pay $X` → POST → redirect to session url; paid → receipt state, no button)
- Modify: `modules/invoicing/app/send-invoice.ts` (mint `public_token` if null — 64-hex like
  `estimates`; return it), `modules/invoicing/infra/drizzle-invoice-repository.ts` (+ token
  lookup `findByPublicToken`), invoice DTO (+ `publicToken`, `poNumber`)
- Modify: `modules/notifications/templates/invoice-reminder.ts` (+ link line),
  `modules/notifications/app/send-invoice-notification.ts` (needs the link — read invoice token,
  compose `${PUBLIC_APP_URL}/i/<token>`)
- Modify: `components/modals/invoice-modal.tsx` — the send primary (:760) now: send → then
  `v1.notifications.sendInvoiceReminder` with channel = lead.phone ? "sms" : "email"; delivery
  failure surfaces the server sentence (toast/inline), status stays sent
- Create: `app/api/public/pay/reconcile/route.ts` (POST `{sessionId}`) +
  `platform/adapters/stripe/stripe-client.ts` `retrieveCheckoutSession(id)` +
  modify `app/(public)/pay/success/page.tsx` to call reconcile with `session_id` from the query
- Modify: `modules/invoicing/infra/stripe-payment-link-gateway.ts` (:29-30) — append
  `&session_id={CHECKOUT_SESSION_ID}` to the success URL (Stripe substitutes it)
- Test: unit for public-invoice use cases + templates + send-invoice token mint; int test
  `modules/invoicing/api/public-invoice.int.test.ts` (token fetch cross-org refusal);
  reconcile route test with a mocked StripeClient

**Interfaces:**
- Produces: `GET /api/public/invoice/<token>` → `{num,title,lines,totalCents,taxCents,depositPaidCents,amountPaidCents,status,termsDays,dueAt,poNumber,orgName,chargesEnabled}`;
  `POST {action:"create_checkout"}` → `{url}` (guards: status `sent|partial`, balance ≥ 50¢,
  charges enabled — reuse `CreatePaymentUseCase`); reconcile POST → `{recorded: boolean}`.
- Reconcile records with **idempotency key = session id** and must route by
  `metadata.kind`: absent/`payment` → `RecordCardPaymentUseCase`; `deposit` → Task 8's use
  case (land the switch now with the deposit arm calling a stub that returns
  not-implemented until Task 8 replaces it — or sequence: this task handles payments only and
  Task 8 extends the switch; the switch must exist here).
- CRITICAL: confirm the webhook's existing idempotency key IS the session id
  (`modules/invoicing/app/stripe-webhook.ts` / `RecordCardPaymentUseCase`); if it derives
  differently, reconcile MUST match it exactly.

- [ ] **Step 1:** Failing unit tests: token mint on first send (stable thereafter); public
  view maps cents; create_checkout refuses `draft` and `paid`; template includes `/i/<token>`
  URL exactly once; reconcile records a paid session and no-ops an unpaid one; reconcile twice
  → one ledger row (idempotency).
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Page: server component fetching via the module (same pattern as
  `/q/[token]/page.tsx` — it does NOT go through tRPC). Buttons are real primitives. A11y:
  labels on the pay button with the amount.
- [ ] **Step 4:** Int tests (live DB): findByPublicToken respects org scoping + soft delete.
- [ ] **Step 5:** Commit `feat: invoices are payable from a public link, and send actually delivers it`.

---

### Task 8: Deposits are actually paid

**Files:**
- Create: `modules/quoting/domain/deposit-link-gateway.ts` (port) +
  `modules/quoting/infra/stripe-deposit-gateway.ts` (StripeClient.createCheckoutSession,
  `metadata: {orgId, estimateId, kind:"deposit"}`, success
  `${PUBLIC_APP_URL}/pay/success?deposit=<estimateId>&session_id={CHECKOUT_SESSION_ID}`)
- Create: `modules/quoting/app/record-estimate-deposit.ts` (`RecordEstimateDepositUseCase`:
  load estimate, refuse when not `accepted`; idempotent — if `depPaidCents > 0` no-op; set
  `depPaidCents = amountCents`, emit `estimate.deposit.paid`)
- Create: `modules/quoting/app/create-deposit-checkout.ts` (guards: estimate `accepted`,
  `depositDue() - depPaid > 0`, org charges enabled)
- Modify: `app/api/public/quote/[token]/route.ts` (POST action `"create_deposit_checkout"`),
  `app/(public)/q/[token]/QuoteActions.tsx` (accepted + deposit due → `Pay the deposit — $X`
  primary → POST → redirect)
- Modify: `modules/invoicing/app/stripe-webhook.ts` (metadata `kind` switch → deposit arm) and
  the Task-7 reconcile switch
- Test: use-case units; webhook routing test; int test for deposit record

**Interfaces:**
- Consumes: Task 7's reconcile switch + `retrieveCheckoutSession`; Task 4 removed the fake
  `depPaid`.
- Produces: after a real deposit payment, `estimates.dep_paid_cents` = paid amount; invoice
  created later from the converted job credits it (Task 2's reader).

- [ ] **Step 1:** Failing tests: accept with `depBps 3000` leaves `depPaid 0`; deposit
  checkout minted only when accepted + due + charges enabled; webhook `kind:"deposit"` event
  records depPaid and a second delivery no-ops; quote page shows `Pay the deposit — $X` only
  when accepted and unpaid.
- [ ] **Step 2:** FAIL → implement → PASS. Wire DI (vapi-style construction happens where the
  public quote route builds its use cases).
- [ ] **Step 3:** Commit `feat: quote deposits are collected, not assumed`.

---

### Task 9: PO number + terms on the invoice's face

**Files:**
- Modify: `components/modals/invoice-modal.tsx` (PO input in the details section; persists via
  the existing invoice update path — if no update procedure covers header fields, add
  `v1.invoicing.setPo` → thin `SetInvoicePoUseCase`), `components/modals/cust-invoice-modal.tsx`
  (+ `PO <n>` and `Net <termsDays> · due <date>` line), `app/(public)/i/[token]/page.tsx`
  (same line — Task 7 already renders it; keep display logic in ONE helper
  `features/invoices/terms-line.ts` and use it in all three)
- Test: helper unit test + component tests

**Interfaces:**
- Produces: `termsLine({termsDays, dueAt, poNumber}) → string` — e.g. `"Net 30 · due Sep 2"`,
  `"Net 30 · due Sep 2 · PO 4471"`; empty string when `termsDays` is default 7 AND no
  poNumber? NO — always show due date once sent; show `Net N` only when `termsDays > 0`,
  append PO when present.

- [ ] **Step 1:** Failing tests for the helper's three shapes + PO persistence round-trip.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: invoices carry PO + payment terms on their face`.

---

### Task 10: Gate, adversarial review, browser E2E

- [ ] **Step 1:** Full gate: `npx tsc --noEmit` · `npm run lint` · `npm run lint:css` ·
  `npm test` · `npm run test:int` · `npm run coverage` (≥80/75) · `npm run build`.
- [ ] **Step 2:** Adversarial review (controller runs the Workflow harness): finders across
  money-correctness / tenant-safety / idempotency / UI-honesty dimensions, verified findings
  fixed.
- [ ] **Step 3:** Browser E2E, NO AI front desk, localhost + `sk_test` (card 4242 4242 4242
  4242): flow 1 (book flat $99 → receipt invoice → QR checkout → paid in Money), flow 2
  (estimate → sign at door → invoice carries lines → pay; decline path → collect $89 fee),
  flow 3 (scope → quote with 30% deposit + Net 30 + PO → accept converts the SAME job →
  deposit via 4242 → install done → final invoice minus deposit → pay from public link).
  Controller performs this personally with the Chrome tools; PR includes screenshots.

---

## Execution notes

- Branch: stack on `feat/front-desk-two-lanes` (PR #374). Before pushing, re-check `gh pr view 374`
  — if merged, rebase onto `origin/main` first (house rule: verify PR still open before pushing).
- Tasks 1→4 are sequential (schema → readers → writers). Tasks 5, 6, 9 are independent after
  their deps (5 after nothing, 6 after 2, 9 after 7). Task 7 before 8.
- The close-out modal is 1115 lines and heavily shared — Tasks 5 and 6 both touch it;
  run them sequentially (5 then 6), never in parallel.
