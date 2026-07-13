# Pricebook CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let a shop switching in from Housecall Pro / Jobber / ServiceTitan / QuickBooks / a spreadsheet import its existing **services** (task→price menu) from a CSV — the switching-cost gate for a shop with a 500–2,000-line book that won't hand-key it.

**Architecture:** Mirror the proven **customer CSV import** (`components/modals/import-customers-modal.tsx` + `lib/import/parse-csv.ts` + `lib/import/map-rows.ts` + `v1.customers.importCustomers`) exactly — same upload → auto-map → preview → chunked import → summary flow. The pricebook adds two things customers didn't need: **money parsing** (`$2,400`/`2,400.00` → cents) and **server-side category find-or-create**. Parse + validate in the browser (the file never touches the server); send clean typed rows to a new `v1.pricebook.importServices` bulk endpoint that creates each via the existing `CreateServiceUseCase` (which already dedupes by name → `conflict`).

**Tech Stack:** Next.js 16, tRPC v11, Drizzle + Supabase, Zustand, papaparse (already a dep), Vitest (+ integration).

**Reference:** master spec §Import (Housecall Pro column spec is the de-facto standard: Industry/Category/Name required + Subcategory/Description/Price/Cost/Taxable/UoM). ICP note: the 25-tech end genuinely needs import; the 1-tech end lands on the seed pack (already shipped).

## Global Constraints
- Money integer cents in DB/domain/DTO. The client parses money strings → cents and sends cents; the server re-validates (never trust client; non-negative int). Conversion for display stays store-side.
- Tenant safety: the import endpoint is `ownerOrOffice`, org from `ctx.principal.orgId`, writes via `CreateServiceUseCase` inside the org tx. Category find-or-create is org-scoped.
- No silent failures: EVERY row is classified — created / deduped (duplicate name) / failed (with a reason + row index). Skipped (no name) and warnings (unreadable price → imported at $0, flagged) shown in the preview BEFORE commit. The user never blind-commits.
- Validate at boundaries: Zod on the bulk input (rows ≤ 500, cents `.int().nonnegative()`, name length). Partial success — one bad row NEVER rolls back the batch (per-row `Result`, mirror `importCustomers`).
- Repository pattern / DI; DTO≠domain; bounded chunks (≤500/request, resume on mid-batch failure); no N+1 (category cache within the batch).
- No floating UI; functional copy; no dead buttons (wire the entry point). YAGNI: import SERVICES only (not materials — a later pass); CSV/TSV only (papaparse handles both; no XLSX).

## Files
```
lib/import/parse-money.ts            (new: "$1,234.56" → 123456 cents; + test)
lib/import/map-service-rows.ts       (new: autoMapService + buildServiceImportRows; + test)
modules/pricebook/api/pricebook-router.ts   (extend: importServices procedure + DTOs)
modules/pricebook/app/import-services.ts     (optional: category find-or-create helper, if the loop grows)
components/modals/import-services-modal.tsx  (new: mirror import-customers-modal)
components/modals/modal-host.tsx     (register MODAL.IMPORT_SERVICES)
lib/store/modal-ids.ts               (add IMPORT_SERVICES)
app/(office)/settings/pricebook-card.tsx     (add "Import from CSV" entry point)
```

## Task 1: Money parser + service row mapping (pure, TDD)
**Files:** `lib/import/parse-money.ts`, `lib/import/map-service-rows.ts` (+ `.test.ts` each).
**Interfaces:** Produces `parseMoneyCents(raw: string): number | null` (null = unparseable); `ServiceImportRow { name; category: string | null; description: string | null; code: string | null; priceCents: number; costCents: number; taxable: boolean }`; `autoMapService(headers): ServiceMappingConfig`; `buildServiceImportRows(records, map): { rows: ServiceImportRow[]; skipped: RowIssue[]; warnings: RowIssue[] }`.

- [ ] **Step 1:** TDD `parse-money.test.ts`: `"$2,400"`→240000, `"2400"`→240000, `"1,234.56"`→123456, `"$0"`→0, `""`→null, `"abc"`→null, `"-5"`→null (negatives rejected), `"2400.5"`→240050. Implement `parse-money.ts` (strip `$` + commas + whitespace, parse float, reject NaN/negative, round to cents).
- [ ] **Step 2:** TDD `map-service-rows.test.ts` (mirror `map-rows.test.ts`): `autoMapService` matches synonyms — name: ["service","item","task","name","description of work"], category: ["category","type","group"], price: ["price","rate","amount","sell","customer price"], cost: ["cost","our cost","material cost"], code: ["code","sku","item code"], description: ["description","details","notes"], taxable: ["taxable","tax"]. `buildServiceImportRows`: name required (else skipped); price via `parseMoneyCents` (unparseable → warning, import at 0); cost same (default 0); taxable parse ("yes"/"y"/"true"/"1"/"taxable" → true); clamp name/desc/code to server lengths. Implement.
- [ ] **Step 3:** Commit `feat(import): money parser + service-row CSV mapping`.

## Task 2: Server `v1.pricebook.importServices`
**Files:** `modules/pricebook/api/pricebook-router.ts` (+ DTOs); category find-or-create.
**Interfaces:** Produces `v1.pricebook.importServices({ rows })` → `{ created, deduped, failed, errors: {index, message}[] }` (mirror `importResultDTO`).

- [ ] **Step 1:** `importServiceRowInput` Zod (name 1..500, category nullable ≤255, description nullable, code nullable ≤120, unitPriceCents/costCents `.int().nonnegative()`, taxable bool); `importInput = { rows: array.min(1).max(500) }`; `importResultDTO`.
- [ ] **Step 2:** Procedure (`ownerOrOffice`): construct `DrizzleServiceRepository` + `DrizzleCategoryRepository` + `CreateServiceUseCase` + `CreateCategoryUseCase` from `ctx`. Build a **category name→id cache** for the batch: for each row's category name, look it up (case-insensitive) in the org's categories (loaded ONCE up front — no N+1), create it if missing (cache the new id). Then loop rows → `CreateServiceUseCase.exec({ name, categoryId, description, code, unitPriceCents, costCents, taxable })`: `ok` → created++; `err(conflict)` → deduped++; other `err` → failed++ with `{index, message}`. NEVER throws (per-row Result → no batch rollback). `logger.info` the counts.
- [ ] **Step 3:** Integration test (`pricebook-import.int.test.ts`, live DB): import 3 rows (one new category, one existing category, one duplicate name) → assert created/deduped counts + the category was created + services carry the right categoryId; tenant isolation (import into org A doesn't touch org B). Commit `feat(pricebook): v1.pricebook.importServices bulk endpoint + category find-or-create + int test`.

## Task 3: Import modal + wiring
**Files:** `components/modals/import-services-modal.tsx`, `modal-host.tsx`, `lib/store/modal-ids.ts`, `app/(office)/settings/pricebook-card.tsx`.

- [ ] **Step 1:** Add `IMPORT_SERVICES: "import-services"` to modal-ids. Register `<ImportServicesModalContent/>` in modal-host under `MODAL.IMPORT_SERVICES`.
- [ ] **Step 2:** `import-services-modal.tsx` — mirror `import-customers-modal.tsx` structure (upload drop-zone → map phase with per-field selects + the ready/skipped/warning pills + a **money-aware preview** showing the first few rows' parsed name·category·price → importing (chunked ≤500, committed-offset resume) → done summary "N services added / M already in your book / K couldn't be read"). Uses `parseCsv` + `autoMapService`/`buildServiceImportRows` + `api.v1.pricebook.importServices`. Invalidate `v1.pricebook.service.list` after each chunk. Functional copy tuned to a pricebook ("Bring in your price book from Housecall Pro, Jobber, ServiceTitan, or a spreadsheet").
- [ ] **Step 3:** `pricebook-card.tsx` — add an "Import from CSV" affordance (in the header actions or beside the seed on-ramp; owner/office only — cost data). Opens `MODAL.IMPORT_SERVICES`. Remove the "Deferred: CSV import" comment. Commit `feat(pricebook): CSV import modal + settings entry point`.

## Task 4: Gate + screenshot
- [ ] Full gate (tsc/lint/unit/int/coverage/build). Screenshot-verify: upload a small CSV → map/preview (ready count + parsed prices) → import → summary → the services appear in the pricebook with categories + prices. Clean up test data in the E2E org. Commit any fixes.

## Self-Review
- Load-bearing: money parse correctness (Task 1) + category find-or-create without N+1 (Task 2) + no-silent-failures per-row classification (created/deduped/failed/skipped/warning all surfaced). Mirrors the proven customer import — same partial-success + resume contract.
- YAGNI: services only (materials import later), CSV/TSV only (no XLSX), no column-mapping persistence.
