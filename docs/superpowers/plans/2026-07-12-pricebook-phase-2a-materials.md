# Pricebook Phase 2a — Materials & Job Costing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add **Materials** (hidden cost ingredients) and the **service↔material join** to the pricebook, so a service's cost can be built from its parts (job costing) and each material carries a markup — the model the leaders converge on (task→price Service, Materials as hidden ingredients joined by quantity).

**Architecture:** Extend the existing `modules/pricebook` module (from Phase 1, now on main) with a `Material` aggregate + a `service_material` join, mirroring the `Service`/`Category` shapes already there. Additive-only schema (two new tables + RLS). Store slice + Level-2 disclosure ("Break into parts") under a service row. Cost rollup is a pure domain calculation. Markup: per-material `markup_bps` override, falling back to the org default (`org_settings.markup_bps`, already present).

**Tech Stack:** Next.js 16, tRPC v11, Drizzle + Supabase Postgres w/ hand-written RLS, Zustand, Vitest (+ integration).

**Reference spec (the "why" / ADR):** `docs/superpowers/specs/2026-07-12-pricebook-restructure-design.md` (§Data model, §Progressive disclosure Level 2, §Markup).

## Global Constraints

- **Money = integer cents** in DB/domain/DTO, dollars in store; conversion only in `lib/store/pricebook-mapper.ts`. **Markup in basis points** (bps).
- **Tenant safety:** both new tables get `org_id` + hand-written RLS (`ENABLE`+`FORCE`+`FOR ALL USING/WITH CHECK (org_id = current_org_id())`). Composite FKs `(org_id, parent_id) → parent(org_id, id)` — the join's `service_id`/`material_id` FKs are composite on `(org_id, …)`. Repos filter `eq(orgId)`. Org id ALWAYS from `ctx.principal.orgId`.
- **Additive-only migrations** on the shared dev/prod DB (CREATE TABLE + ADD COLUMN only, no rename/drop). Single-writer: `gh pr list` for open `shared/db/migrations` PRs before generating (NOTE: PR #62 keyset-fix does NOT touch migrations; check anyway).
- **Domain returns `Result`**; immutable value objects (private ctor + `static create`), mirror `modules/pricebook/domain/service.ts`.
- **DTO ≠ domain**; **repository pattern + DI**; **no silent failures** (store rollback surfaces feedback); **soft-delete only**; **bounded pagination / no N+1** (load a service's materials in one query, not per-material).
- **No floating UI** (Level-2 reveal expands in-flow under the service row); **functional copy**; **no dead buttons**; **owner-only cost** (materials are cost data — gate the whole materials UI owner/office, fail-closed, same as the Level-1 cost).
- **YAGNI:** Phase 2a builds ONLY `Material` + `service_material` join + cost rollup + markup resolution. NO labor_rate changes, NO terms block, NO GBB, NO CSV import, NO Equipment type, NO vendor entity (one `vendor` text field), NO inventory, NO cost-band matrix (single markup only). Those are 2b / Phase 3.

## File Structure

```
shared/db/schema/pricebook-materials.ts             (new table)
shared/db/schema/pricebook-service-materials.ts      (new join table)
shared/db/migrations/NNNN_*.sql                       (drizzle: 2 CREATE TABLE + indexes)
shared/db/migrations/NNNN_pricebook_materials_rls.sql (hand-written RLS)
modules/pricebook/
  domain/  material.ts, material-repository.ts, service-material.ts (join VO),
           cost-rollup.ts (pure: materials+qty+markup → service cost basis)   (+ .test.ts)
  app/     create-material.ts, update-material.ts, archive-material.ts, list-materials.ts,
           attach-material.ts, detach-material.ts, list-service-materials.ts   (+ .test.ts)
  infra/   drizzle-material-repository.ts, material-mapper.ts,
           drizzle-service-material-repository.ts
  api/     extend pricebook-router.ts (material.* + serviceMaterial.*) + pricebook-dto.ts
lib/store/slices/pricebook-slice.ts   (extend: materials, attach/detach)
lib/store/pricebook-mapper.ts          (extend: material DTO↔store)
features/pricebook/pricebook-hydrator.tsx (extend: load materials)
app/(office)/settings/service-row.tsx  (add Level-2 "Break into parts" reveal)
app/(office)/settings/material-manager.tsx (new: the parts editor under a service)
```

## Markup resolution (the one piece of real logic)

A material's effective markup = `material.markupBps ?? orgSettings.markupBps` (per-material override, else org default). A service's **cost basis** (pure `cost-rollup.ts`): `sum over attached materials of (unitCostCents × quantity)`. The material's *marked-up price* (for found-work later) = `unitCostCents × (1 + effectiveMarkupBps/10000)`. Phase 2a computes + displays the rollup on the service (owner-only); it does NOT auto-overwrite the service's `price_cents` (the flat rate stays the source of truth — the rollup is advisory, shown as "parts cost $X"). This matches the spec: markup is baked into flat rates; the live markup knob is for found-work (2b).

---

### Task 1: Schema — materials + join + RLS (additive)

**Files:** `shared/db/schema/pricebook-materials.ts`, `pricebook-service-materials.ts`, drizzle migration, hand-written RLS migration + journal.

**Interfaces:**
- Produces: `pricebook_materials (id, org_id, category_id null, code null, name, description null, unit_cost_cents int default 0, unit_of_measure text default 'each', markup_bps int null, taxable bool default false, vendor text null, active bool default true, position int default 0, created_at, updated_at, deleted_at)` + unique `(org_id, id)`; `pricebook_service_materials (org_id, service_id, material_id, quantity numeric(8,2) default 1, created_at, pk(service_id, material_id))` with composite FKs to `pricebook_items(org_id,id)` and `pricebook_materials(org_id,id)`.

- [ ] **Step 1:** Write `pricebook-materials.ts` mirroring `pricebook-items.ts` (composite-FK to `pricebook_categories` on `(org_id, category_id)`, `unique(org_id, id)` target for the join, indexes `(org_id, deleted_at)` + `(org_id, name)`). Export in `shared/db/schema/index.ts`.
- [ ] **Step 2:** Write `pricebook-service-materials.ts`: `orgId`, `serviceId`, `materialId`, `quantity numeric(8,2)`, `createdAt`; `primaryKey(serviceId, materialId)`; two composite FKs `(orgId, serviceId)→pricebookItems(orgId,id)` and `(orgId, materialId)→pricebookMaterials(orgId,id)`, both `onDelete cascade`; index `(orgId, serviceId)`.
- [ ] **Step 3:** `pnpm db:generate`; inspect the SQL — confirm **CREATE TABLE + indexes only** (no drop/rename). Coordinate migration number vs open PRs.
- [ ] **Step 4:** Hand-write RLS migration for BOTH new tables (ENABLE+FORCE+policy) + journal entry.
- [ ] **Step 5:** `pnpm db:migrate`; **verify via direct query** both tables + RLS forced + policies exist (silent-no-op gotcha).
- [ ] **Step 6:** Commit `feat(pricebook): materials + service_material join schema + RLS (additive)`.

### Task 2: Domain — Material, join VO, cost-rollup

**Files:** `modules/pricebook/domain/{material.ts, material-repository.ts, service-material.ts, cost-rollup.ts}` + tests.

**Interfaces:**
- Produces: `Material.create(props): Result<Material>` (name required, `unitCostCents ≥ 0`, `markupBps` null-or-≥0); `MaterialRepository` (create/findById/list(page,filter)/save/archive); `ServiceMaterial` VO (`serviceId, materialId, quantity>0`); `effectiveMarkupBps(material, orgDefaultBps): number`; `serviceCostBasisCents(attached: {unitCostCents, quantity}[]): number`.

- [ ] **Step 1:** TDD `material.test.ts` (create trims name, rejects empty, rejects negative cost, patch immutability). Implement `material.ts` mirroring `service.ts`.
- [ ] **Step 2:** TDD `cost-rollup.test.ts`: `serviceCostBasisCents([{unitCostCents:1000,quantity:2},{unitCostCents:500,quantity:1}]) === 2500`; `effectiveMarkupBps({markupBps:null}, 3500) === 3500` and `({markupBps:5000}, 3500) === 5000`. Implement `cost-rollup.ts` (pure functions, no deps).
- [ ] **Step 3:** `service-material.ts` VO (`create` rejects quantity ≤ 0). Repository interfaces (`MaterialRepository`, `ServiceMaterialRepository` with `attach`, `detach`, `listForService(serviceId)`, `listForServices(ids[])` for no-N+1 hydration).
- [ ] **Step 4:** Commit `feat(pricebook): Material + service-material + cost-rollup domain`.

### Task 3: Infra — repos + mappers

**Files:** `modules/pricebook/infra/{drizzle-material-repository.ts, material-mapper.ts, drizzle-service-material-repository.ts}`.

- [ ] **Step 1:** `material-mapper.ts` `rowToMaterial` (throw on corrupt, per precedent; cents stay cents). `drizzle-material-repository.ts` mirroring `drizzle-service-repository.ts` (org-scoped, `keysetBefore` for pagination — reuse the shared helper from PR #62 if merged, else inline `.toISOString()`; ilike name search).
- [ ] **Step 2:** `drizzle-service-material-repository.ts`: `attach(serviceId, materialId, quantity)` (upsert on the composite pk), `detach`, `listForService`, `listForServices(ids)` — the last one does ONE `where serviceId in (...)` query (no N+1).
- [ ] **Step 3:** Commit `feat(pricebook): Drizzle material + service-material repositories + mapper`.

### Task 4: Use-cases

**Files:** `modules/pricebook/app/{create-material,update-material,archive-material,list-materials,attach-material,detach-material,list-service-materials}.ts` + tests.

- [ ] **Step 1–N (TDD, fake repos):** each use-case DI-constructed, returns `Result`. `CreateMaterial` dedupes by name (bounded indexed search, like `CreateService`). `AttachMaterial` validates the service + material both exist in-org before inserting the join (fail-fast, no orphan FK). Keep each <20 lines.
- [ ] **Step last:** Commit `feat(pricebook): material + attach/detach use-cases`.

### Task 5: API — extend router + DTOs + int test

**Files:** extend `modules/pricebook/api/pricebook-router.ts` + `pricebook-dto.ts`; `pricebook-materials.int.test.ts`.

- [ ] **Step 1:** `materialDTO`, `serviceMaterialDTO` (+ `toMaterialDTO`). Add sub-routers `material.{list,create,update,archive}` + `serviceMaterial.{listForService,attach,detach}`. `ownerOrOffice`, Zod-validated (cents `.int().nonnegative()`, `markupBps` optional `.int().nonnegative().nullable()`, quantity `.number().positive()`).
- [ ] **Step 2:** Int test (live DB): material CRUD round-trip; attach/detach; **tenant isolation** (org B can't read/attach org A's materials — the composite FK + RLS); a service in org A cannot attach a material from org B (FK/validation blocks it).
- [ ] **Step 3:** Commit `feat(pricebook): v1.pricebook.material + serviceMaterial routers + int test`.

### Task 6: Store + hydrator

**Files:** extend `lib/store/slices/pricebook-slice.ts`, `lib/store/pricebook-mapper.ts`, `features/pricebook/pricebook-hydrator.tsx`.

- [ ] **Step 1:** Store: `materials: Material[]` (dollars) + `serviceMaterials: Record<serviceId, {materialId, quantity}[]>`; actions `addMaterial/updateMaterial/archiveMaterial` (optimistic+rollback+surfaced Result) and `attachMaterial/detachMaterial`. Mapper: material cents↔dollars, markupBps stays bps.
- [ ] **Step 2:** Hydrator: load `material.list` + `serviceMaterial` for loaded services via ONE `listForServices` call (no N+1). Test slice add/rollback + attach/detach.
- [ ] **Step 3:** Commit `feat(pricebook): materials store slice + hydrator`.

### Task 7: Settings UI — Level 2 "Break into parts"

**Files:** `app/(office)/settings/material-manager.tsx` (new); extend `service-row.tsx` Level-1 disclosure with a "Break into parts" reveal.

- [ ] **Step 1:** In `service-row.tsx`, add a "Break into parts" affordance in the expanded (Level-1) row. It reveals IN-FLOW (no floating UI) a `<MaterialManager serviceId=…/>`: the attached materials (name · qty · unit cost) + "parts cost $X → basis" line (the rollup, owner-only), an add-part row (pick an existing material or create one inline with cost + UoM), and remove. Gate the whole thing owner/office (materials are cost data), fail-closed.
- [ ] **Step 2:** Show the computed cost basis vs the service's flat price (advisory — do NOT overwrite the price). Functional copy: "Parts — internal only, never shown to the customer."
- [ ] **Step 3:** Screenshot-verify the Level-2 reveal (Playwright, owner creds, dedicated PORT). Commit `feat(pricebook): Level-2 materials editor under a service (Break into parts)`.

---

## Self-Review notes
- Spec coverage: delivers §Data model `pricebook_material` + `service_material` + §Progressive-disclosure Level 2. Markup **resolution** (per-material override → org default) + **cost rollup** are built; wiring the found-work *live add-part flow* and applying markup to an actually-added found-work part is **2b** (needs the on-site flow) — this phase makes the catalog + rollup real.
- Deferred (YAGNI, not this plan): labor_rate kinds, terms block, GBB, CSV import, Equipment, vendor entity, inventory, cost-band matrix.
- Order: Tasks 1→6 hard chain; 7 depends on 6.
