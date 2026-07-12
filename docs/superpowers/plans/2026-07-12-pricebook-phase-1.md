# Pricebook Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pricebook the real pricing spine of the app — a richer `Service`/`Category` catalog in its own hexagonal module, edited through a progressively-disclosed Settings UI, and read by the Composer, invoices, and AI drafter (killing the hardcoded sample arrays).

**Architecture:** New hexagonal module `modules/pricebook/{domain,app,infra,api}` mirroring `modules/companies` (the canonical template). **Additive-only** schema evolution: the existing `pricebook_items` table is **extended in place with nullable columns** (NOT renamed — the DB is shared dev/prod and a rename would break deployed prod); the new `Service` domain maps to it. Plus a self-referential `pricebook_categories`. Org-scoped repositories, DI-constructed use-cases returning `Result`, DTO≠domain, cursor pagination + search on the list. Store slice extended behind the existing optimistic→persist→reconcile→rollback pattern. The Settings pricebook card is rebuilt around in-flow progressive disclosure (no floating UI).

**Tech Stack:** Next.js 16 (client pages), tRPC v11, Drizzle + Supabase Postgres with hand-written RLS, Zustand, Vitest (+ integration config), hand-rolled CSS.

**Reference spec:** `docs/superpowers/specs/2026-07-12-pricebook-restructure-design.md` (this doubles as the ADR — the "why").

## Global Constraints

- **Money = integer cents** in DB/domain; `{cents}`-style in DTOs; dollars in the store. Conversions live only in mappers (`lib/store/dto-mapper.ts` convention). Rates/markup in **basis points**.
- **Tenant safety (non-negotiable):** every new table has `org_id` + hand-written RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`). drizzle-kit does NOT emit RLS — RLS is a separate hand-written numbered migration + journal entry. Child tables use composite FKs `(org_id, parent_id) → parent(org_id, id)`. Repos also filter `eq(orgId)` explicitly. Org id ALWAYS from `ctx.principal.orgId`.
- **Domain returns `Result`** (`@mallet/shared/types`: `ok`/`err`/`validation`), no throws for expected validation; immutable value objects with a private constructor + `static create`.
- **DTO ≠ domain**; wire shapes in `api/*-dto.ts`, mappers convert.
- **No silent failures:** every store persist path surfaces feedback on rollback (mirror `addSource`'s `Result` return).
- **Pagination + search** on `list` (the book can reach 500–2,000 rows) via the existing `CursorPage`/`Paginated`/`toPage` types. No unbounded `SELECT *`.
- **No N+1:** load the category tree in one query; never per-service category lookups.
- **Strategic indexes:** `(org_id, deleted_at)` on every table; `(org_id, category_id)`; a search index on `pricebook_service.name`.
- **Soft-delete only** (`deleted_at`).
- **Shared dev/prod DB — additive migrations ONLY** (ADD COLUMN nullable/defaulted, CREATE TABLE). Never rename/drop a table or column that deployed prod references. Migrations are single-writer: `gh pr list` for open `shared/db/migrations` PRs before generating.
- **Client-authored UUIDs** accepted on create (optimistic-UI + idempotency), mirroring `createCompany`.
- **Structured logging:** existing pino logger, `orgId` in context, on domain events.
- **YAGNI:** Phase 1 builds ONLY `Service` + `Category`. NO materials, service_material join, labor_rate table, option_group/GBB, or CSV import — those are Phases 2–3. Do not add their columns/tables now (the GBB columns `option_group_id`/`tier` are deferred to Phase 3).
- **House rules:** No floating UI (in-flow reveals). UI copy functional, not chatty. No dead buttons. Follow `modules/companies` for every layer's shape.

## File Structure

```
shared/db/schema/pricebook-items.ts          (EXTEND in place — keep table name `pricebook_items`; add nullable columns)
shared/db/schema/pricebook-categories.ts     (new)
shared/db/migrations/NNNN_*.sql              (drizzle-generated: ADD COLUMN + new category table + indexes — additive only)
shared/db/migrations/NNNN_pricebook_rls.sql  (hand-written RLS for pricebook_categories)
modules/pricebook/
  domain/  service.ts, service-repository.ts, category.ts, category-repository.ts
  app/     create-service.ts, update-service.ts, archive-service.ts, list-services.ts,
           create-category.ts, list-categories.ts, seed-pricebook.ts   (+ .test.ts each)
  infra/   drizzle-service-repository.ts, service-mapper.ts,
           drizzle-category-repository.ts, category-mapper.ts
  api/     pricebook-router.ts, pricebook-dto.ts, pricebook-router.int.test.ts
  index.ts
lib/store/slices/pricebook-slice.ts          (new; replaces PbItem plumbing in settings-slice)
lib/store/pricebook-mapper.ts                (new; DTO↔store)
features/pricebook/pricebook-hydrator.tsx    (new)
app/(office)/settings/pricebook-card.tsx     (new; extracted + progressively disclosed)
app/(office)/settings/pricebook-seed.ts      (plumbing starter data)
```

Router registration: add `pricebook: createPricebookRouter()` under `v1` in the root router; mount `PricebookHydrator` in the office layout next to the other hydrators.

---

## Part A — Foundation (the catalog becomes real)

### Task 1: Schema, indexes & RLS (additive only)

**Files:**
- Extend in place: `shared/db/schema/pricebook-items.ts` (keep table name `pricebook_items`)
- Create: `shared/db/schema/pricebook-categories.ts`
- Migration: `shared/db/migrations/` (drizzle-generated, ADD COLUMN only) + a hand-written RLS `.sql` + journal entry

**Interfaces:**
- Produces: table `pricebook_items` with added nullable columns `category_id uuid null`, `code text null`, `description text null`, `labor_hours numeric(5,2) null`, `taxable boolean not null default false`, `warranty_text text null`, `image_url text null`, `is_addon boolean not null default false`, `active boolean not null default true`; table `pricebook_categories (id, org_id, parent_id, name, sort_order, created_at, updated_at, deleted_at)`.

**CRITICAL — shared dev/prod DB, additive changes ONLY.** Do NOT rename `pricebook_items` (deployed prod still references it — a rename breaks prod until new code ships). Only `ADD COLUMN` (nullable / defaulted) + a new table. Before generating, `gh pr list` for any open PR touching `shared/db/migrations/` (single-writer) and coordinate the number.

- [ ] **Step 1: Extend the schema file in place.** In `pricebook-items.ts`, keep `pricebookItems` / table `"pricebook_items"`; ADD the new columns above (all nullable or defaulted so existing rows are valid). Keep `unitPriceCents`/`costCents`/`position`/soft-delete. Add indexes: keep `(orgId, deletedAt)`; add `index("pricebook_items_org_category_idx").on(orgId, categoryId)` and `index("pricebook_items_org_name_idx").on(orgId, name)`.
- [ ] **Step 2: Create `pricebook-categories.ts`.** Self-ref `parentId` with composite FK `(orgId, parentId) → pricebookCategories(orgId, id)` (mirror an existing composite-FK child table for the `unique (orgId, id)` target + FK declaration), `sortOrder int default 0`, timestamps, `deletedAt`, index `(orgId, deletedAt)`. Update `shared/db/schema/index.ts` export.
- [ ] **Step 3: Generate the migration.** `npm run db:generate`; inspect `git status shared/db/migrations` — confirm the diff is **ADD COLUMN + CREATE TABLE only** (no DROP/RENAME). If drizzle emits anything destructive, hand-edit to additive.
- [ ] **Step 4: Hand-write the RLS migration** (new numbered `.sql` + journal entry): `ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())` on `pricebook_categories` (pricebook_items already has its RLS from its original migration — untouched). Add the journal entry.
- [ ] **Step 5: Apply + verify.** `npm run db:migrate`; then verify the new columns + `pricebook_categories` exist via a direct query (the migrate-silently-no-ops gotcha — confirm, don't trust the success line).
- [ ] **Step 6: Commit.** `feat(pricebook): extend pricebook_items + add pricebook_categories (additive), indexes, RLS`

### Task 2: Domain — Service & Category

**Files:** Create `modules/pricebook/domain/{service.ts,service-repository.ts,category.ts,category-repository.ts}` (+ `service.test.ts`, `category.test.ts`).

**Interfaces:**
- Produces: `Service.create(props): Result<Service, ValidationError>` with `props { id, orgId, categoryId: string|null, code: string|null, name, description: string|null, unitPriceCents: number, costCents: number, laborHours: number|null, taxable: boolean, warrantyText: string|null, imageUrl: string|null, isAddon: boolean, active: boolean, position: number, createdAt, updatedAt }`; `.patch(fields, now)`. `Category.create(props): Result` with `{ id, orgId, parentId: string|null, name, sortOrder, createdAt, updatedAt }`. Repository interfaces mirroring `CompanyRepository` (org implicit in the tx).

- [ ] **Step 1: Write failing `service.test.ts`.** Assert: `create` trims name and rejects empty (`err` with field `"name"`); rejects `unitPriceCents < 0` and `costCents < 0` (`validation`); accepts a valid row; `patch({ unitPriceCents })` returns a new Service with other fields intact (immutability). Run — fails (no module).
- [ ] **Step 2: Implement `service.ts`** mirroring `modules/companies/domain/company.ts`: private ctor, `static create` validating name non-empty + non-negative cents (fail-fast on invariant), `patch` re-validating through `create`. Run — passes.
- [ ] **Step 3: Write failing `category.test.ts`** (name required, immutable patch of `sortOrder`/`parentId`). Implement `category.ts`. Run — passes.
- [ ] **Step 4: Repository interfaces.** `service-repository.ts`: `create(input)`, `findById(id)`, `list(page: CursorPage, filter: { search?: string; categoryId?: string|null })`, `save(service)`, `archive(id, now)`. `category-repository.ts`: `create`, `list()` (all, one query — no pagination; a tree is small), `save`, `archive`. Org NEVER a parameter.
- [ ] **Step 5: Commit.** `feat(pricebook): Service + Category domain value objects + repository ports`

### Task 3: Infra — Drizzle repositories & mappers

**Files:** Create `modules/pricebook/infra/{drizzle-service-repository.ts,service-mapper.ts,drizzle-category-repository.ts,category-mapper.ts}`.

**Interfaces:**
- Consumes: schema from Task 1, domain from Task 2.
- Produces: `DrizzleServiceRepository(tx, orgId)` + `DrizzleCategoryRepository(tx, orgId)` implementing the Task 2 ports.

- [ ] **Step 1: Mappers.** `service-mapper.ts` `rowToService(row): Service` reads the `pricebookItems` row (the `Service` domain maps to the `pricebook_items` table), via `Service.create` (throwing on corrupt persisted data per `job-mapper` precedent); `category-mapper.ts` likewise for `pricebookCategories`. Cents stay cents here (dollars conversion is store-side only).
- [ ] **Step 2: Drizzle repos** mirroring `drizzle-company-repository.ts`: all queries `.where(and(eq(orgId), isNull(deletedAt), ...))`. `list` applies `filter.search` as `ilike(name, %q%)` (uses the name index) and `filter.categoryId` as an equality, ordered by `position`/`name`, cursor-paginated (mirror the company repo's cursor). `category list` returns all rows ordered by `sortOrder` in ONE query (no N+1). `archive` sets `deletedAt`, returns row count.
- [ ] **Step 3: Commit.** `feat(pricebook): Drizzle service/category repositories + mappers`

### Task 4: Use-cases

**Files:** Create `modules/pricebook/app/{create-service,update-service,archive-service,list-services,create-category,list-categories}.ts` (+ `.test.ts` each).

**Interfaces:**
- Produces: `CreateServiceUseCase(repo, clock, ids).exec(cmd, orgId): Result<Service>` (dedupe by name case-insensitive like `CreatePricebookUseCase`), `UpdateServiceUseCase`, `ArchiveServiceUseCase`, `ListServicesUseCase(repo).exec({ page, search?, categoryId? }): Paginated<Service>`, `CreateCategoryUseCase`, `ListCategoriesUseCase`.

- [ ] **Step 1–N (per use-case, TDD):** For each, write the failing test against a fake in-memory repository (mirror `create-company.test.ts`), asserting: id preserved when client-supplied; name-dedupe returns a `conflict` err; cents clamped ≥ 0; archive returns `{ ok:false }`-style when 0 rows. Implement minimal use-case (DI ctor, returns `Result`). Run — pass. Keep each under 20 lines.
- [ ] **Step last: Commit.** `feat(pricebook): pricebook use-cases (create/update/archive/list service, category)`

### Task 5: API router + DTOs

**Files:** Create `modules/pricebook/api/{pricebook-router.ts,pricebook-dto.ts,pricebook-router.int.test.ts}`, `modules/pricebook/index.ts`; register under `v1`.

**Interfaces:**
- Produces: `v1.pricebook.service.{list,create,update,archive}`, `v1.pricebook.category.{list,create}`. DTOs: `serviceDTO` (cents fields, all new columns), `categoryDTO`, `paginatedServiceDTO { items, nextCursor }`.

- [ ] **Step 1: DTOs** in `pricebook-dto.ts` (`serviceDTO`, `categoryDTO`, `toServiceDTO`, `toCategoryDTO`) — separate from domain, mirror `company-dto.ts`.
- [ ] **Step 2: Router** mirroring `company-router.ts`: `ownerOrOffice` procedures; construct `Drizzle*Repository(ctx.tx, ctx.principal.orgId)` + use-case with `ctx.deps.clock`/`ctx.deps.ids`; `orThrow(result)`. `service.list` input `{ limit?, cursor?, search?, categoryId? }` → `toPage` + filter; output `paginatedServiceDTO`. Validate all input with Zod (max lengths, `.uuid()`, cents `.int().nonnegative()`).
- [ ] **Step 3: Integration test** (`.int.test.ts`, mirror `company-router.int.test.ts`): create→list→update→archive round-trip AND a tenant-isolation assertion (org A cannot read org B's services) against the live RLS DB.
- [ ] **Step 4: Register + barrel + commit.** Add to root `v1` router; `index.ts` barrel. `feat(pricebook): v1.pricebook router + DTOs + tenant-isolation int test`

### Task 6: Store slice + hydrator

**Files:** Create `lib/store/slices/pricebook-slice.ts`, `lib/store/pricebook-mapper.ts`, `features/pricebook/pricebook-hydrator.tsx`; migrate `PbItem` consumers off `settings-slice`; mount hydrator in the office layout.

**Interfaces:**
- Produces: store `services: Service[]`, `categories: Category[]`, actions `addService(cmd): Promise<AddResult>`, `updateService`, `archiveService`, `addCategory`, `setPricebook(snapshot)` — all optimistic → `trpcVanilla.v1.pricebook.*` → reconcile → rollback with a surfaced `Result` (mirror `addSource`).

- [ ] **Step 1: Failing slice test** (mirror `settings-slice.test.ts` add/rollback): `addService` optimistic-appends + calls create with the client id; rolls back + returns `{ok:false,reason:"failed"}` on reject; dedupe returns `{ok:false,reason:"duplicate"}`.
- [ ] **Step 2: Implement slice + mapper** (cents↔dollars in `pricebook-mapper.ts` only). Remove `pricebook`/`PbItem`/`addPricebookItem`/`markup`-prefill from `settings-slice` (markup scalar stays; its prefill helper moves to the pricebook slice's add path). Update the two existing consumers (`tech-quote-modal`, `price-builder-modal`) to read `s.services` via a thin adapter to their `{ d, r, c }` shape. Run — pass.
- [ ] **Step 3: Hydrator** `PricebookHydrator` (mirror `settings-hydrator`): `v1.pricebook.service.list` (first page, large limit) + `category.list`, `refetchOnWindowFocus:false`, `setPricebook`. Mount in office layout. Remove pricebook fields from `SettingsHydrator`.
- [ ] **Step 4: Commit.** `feat(pricebook): store slice + mapper + hydrator; migrate tech/price-builder consumers`

### Task 7: Settings UI — progressive disclosure

**Files:** Create `app/(office)/settings/pricebook-card.tsx`; replace the Pricebook block in `settings/page.tsx` (`SecPricing`) with it. Reframe the markup + labor-rate copy.

**Interfaces:**
- Consumes: pricebook slice (Task 6).

- [ ] **Step 1: Level 0** — flat service list (name → price) + one add row; empty state shows `[ Start with plumbing basics ]` (Task 8 seed) + a disabled-until-Phase-3 note is NOT shown (no dead buttons — omit Import entirely in Phase 1). Search input appears once `services.length > 15`. Wire add with inline error feedback (the `addSource` pattern).
- [ ] **Step 2: Level 1** — a row expands in-flow (`▸`/`▾`, anchored, no floating UI) to reveal cost/margin (owner-only), labor hours, category picker (from `categories`), taxable, warranty. Edits call `updateService`.
- [ ] **Step 3: Category management** — inline "add category" within the disclosure; `categories` render as the picker options; group-by-category toggle when the tree is non-trivial.
- [ ] **Step 4: Reframe copy** — markup card: "Applied to found-work / T&M parts a tech adds on site" (not "pre-fills a suggested price"). Labor-rates card: lead with a Diagnostic/trip-fee field, reveal base-rate + after-hours under "More rates". (No schema change — copy/layout only in Phase 1.)
- [ ] **Step 5: Screenshot-verify** each disclosure level (Playwright, E2E owner creds, dedicated PORT) + commit. `feat(pricebook): progressively-disclosed settings card`

### Task 8: Plumbing seed pack

**Files:** Create `app/(office)/settings/pricebook-seed.ts` (data) + `modules/pricebook/app/seed-pricebook.ts` (`SeedPricebookUseCase`, idempotent) + test; wire the empty-state button.

- [ ] **Step 1: Seed data** — ~24–40 plumbing services across ~6 categories (water heaters, drains, fixtures, repairs, sewer, misc) with realistic flat prices + costs. Constants, no magic numbers inline.
- [ ] **Step 2: `SeedPricebookUseCase`** — idempotent (skip if the org already has services; log + return a count). TDD: seeding twice creates one set.
- [ ] **Step 3: Wire the empty-state button** → `v1.pricebook.seed` → reconcile store. Commit. `feat(pricebook): plumbing seed pack (idempotent) + empty-state on-ramp`

---

## Part B — Wire-up (the catalog reaches the quote surfaces)

### Task 9: Composer + invoice modal read the real pricebook

**Files:** `app/(office)/composer/page.tsx`, `components/modals/invoice-modal.tsx`.

- [ ] **Step 1: Composer** — replace the hardcoded `PRICEBOOK` const with `useAppStore((s) => s.services)` (adapted to the composer's line shape); render the category-browsable list. Wire the dead "Save to book" handler → `addService` (persists the current line to the catalog) with inline feedback. Keep GBB/TEMPLATES seeds as-is (GBB is Phase 3).
- [ ] **Step 2: Invoice modal** — replace its local `PRICEBOOK` const with `s.services` via the shared `AddMenu`. Remove the const.
- [ ] **Step 3: Snapshot back-ref** — add a nullable `pricebook_service_id` to the estimate line (schema + DTO + mapper, additive; `modules/quoting`); on add-from-book, snapshot `name/price/cost/taxable` AND record the id. Totals math unchanged.
- [ ] **Step 4: Tests + screenshot** — composer/invoice "from pricebook" shows real store data; a seeded quote line survives a later catalog edit (snapshot). Commit. `feat(pricebook): wire Composer + invoices to the real pricebook (kill hardcoded seeds)`

### Task 10: AI drafter reads the org's book

**Files:** `modules/ai/app/draft-estimate.ts`, its router input, the composer draft call.

- [ ] **Step 1:** Pass the org's services (name, price, category — a bounded top-N, paginated, no full dump) into the draft context so the model prices from the shop's real book and flags off-book lines. Retrieval only — no fine-tuning, no new external call beyond the existing LLM one (its timeout/handling already exist).
- [ ] **Step 2:** Test that the draft input includes the catalog context; the LLM call itself stays mocked. Commit. `feat(pricebook): AI drafts from the org's real pricebook`

### Task 11: Remove the Trade card

**Files:** `app/(office)/settings/page.tsx` (`SecPricing`).

- [ ] **Step 1:** Remove the "Your trade" FoldCard + its false "reloads starter pricebook" copy. Leave `trade` in the store/DB (additive; it seeds onboarding + AI taxonomy later — a Phase-later concern). No dead code left behind (drop `setTrade` wiring from the card only; keep the store action for onboarding).
- [ ] **Step 2:** Commit. `refactor(settings): remove the Your-trade live card (moves to onboarding)`

---

## Self-Review notes

- **Spec coverage:** Part A delivers the structure + editing (spec §Data model, §Progressive disclosure, §Migration, seed pack); Part B delivers the island fix (spec §"The island fix") + the trade cut. Materials/markup-on-found-work/labor_rate table/GBB/import are explicitly Phases 2–3 (spec §Phasing) — not in this plan.
- **Deferred columns:** `option_group_id`/`tier` are NOT added in Task 1 (Phase 3, when GBB lands) — YAGNI.
- **Type consistency:** `unitPriceCents`/`costCents` (DB/DTO) ↔ `unitPrice`/`cost` dollars (store) is the only intentional shape shift; isolated to `pricebook-mapper.ts`.
- **Order:** Tasks 1→6 are a hard dependency chain; 7–8 depend on 6; 9–11 depend on 5–6. Execute in order.
