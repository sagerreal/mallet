# Pricebook Restructure — Design

**Status:** Draft — awaiting Owen's review before implementation planning.
**Date:** 2026-07-12
**Author:** Owen + Claude

## Goal

Turn the pricebook from a flat, disconnected 3-field list into the real pricing spine of the
app: a catalog of sellable **task→price Services** (with parts as hidden cost ingredients) that
**actually feeds every quote surface**, and that stays dead-simple for a 1-tech shop while
scaling — same schema, no migration — to a 15–25-tech flat-rate operation.

Two problems, one design:
1. **The island.** The real pricebook reaches only the Settings editor, the from-a-job
   PriceBuilder, and the tech's on-site quote. The **primary "New quote" path (the Composer),
   invoices, and AI drafting all run on hardcoded sample arrays** and never read it. Curating
   the pricebook today changes almost nothing a customer sees.
2. **The flat model.** `pricebook_items (label, unit_price_cents, cost_cents, position)` cannot
   express categories, parts, labor, Good/Better/Best, or import — everything a real flat-rate
   book needs above ~3 techs.

## Why (context)

ICP is 1–50-person home-services shops, plumbing beachhead (see the ICP research). A 1–2-person
shop has prices in its head; a 15–25-tech shop runs a 500–2,000-line flat-rate book (Housecall
Pro / Jobber / ServiceTitan / Profit Rhino). The pricebook must serve **both ends of that range
from one structure** — the floor stays a plain price list; the ceiling grows materials, job
costing, GBB, and CSV import into the *same tables*, just more populated. That "same shape, more
data" property is why we design for the ceiling now (it costs almost nothing at the floor) rather
than migrate later.

The load-bearing industry insight (converged across all four leaders): **a pricebook is a menu
of sellable tasks→price (Services), with Materials as hidden cost-ingredients joined by
quantity — not a flat parts list.** Today's `pricebook_items` row is a Service with everything
else stripped off.

## Design principles applied (house rules)

This spec is written to Mallet's binding Core Design Principles (`CLAUDE.md` → Architecture) and
the global coding style. Each is honoured concretely:

- **Hexagonal modules.** Pricebook grows to 6 tables + its own domain/use-cases, so it earns a
  dedicated `modules/pricebook/{domain,app,infra,api}` module (canonical template:
  `modules/companies/`) rather than bloating `modules/settings/`. Settings keeps org-config
  scalars (markup default, labor rates, trade); the pricebook catalog moves out. High cohesion,
  low coupling.
- **DTO ≠ domain.** Domain value objects (`Service`, `Material`, `Category`, `OptionGroup`) are
  immutable, `create → Result`, no throws for expected validation. Wire DTOs (`…DTO`) are a
  separate shape; conversions live in mappers only. Money is **integer cents** in DB/domain,
  `{cents, currency}` in DTOs, dollars in the store — exactly the existing convention
  (`lib/store/dto-mapper.ts`).
- **Repository pattern + DI.** Each aggregate gets a repository interface in `domain/`, a Drizzle
  implementation in `infra/`; use-cases are DI-constructed and return `Result`. Business logic
  depends on the interface, not Drizzle.
- **Tenant safety (non-negotiable).** Every new table carries `org_id` + hand-written RLS
  (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`);
  drizzle-kit does not emit RLS. Child tables use composite FKs `(org_id, parent_id) →
  parent(org_id, id)`. Repos also filter `eq(orgId)` explicitly. Org id always from
  `ctx.principal.orgId`, never client input; writes inside `withTenant`.
- **Validate at boundaries.** Zod at the router edge; domain `create()` re-validates invariants
  (non-negative cents, non-empty name, tier ∈ {good,better,best}). Never trust the client shape.
- **No silent failures.** Every persist path is optimistic → `trpcVanilla` → reconcile → rollback
  **with surfaced feedback** (the pattern we just applied to `addSource`). Import reports per-row
  outcomes; a rejected row is shown, never dropped.
- **Immutability / snapshot.** Quote lines already snapshot price at draft time (correct — keep
  it). We add only a **nullable** `pricebook_service_id` back-ref for reporting. Editing the
  catalog never mutates history; editing a quote never mutates the catalog.
- **Soft-delete only** (`deleted_at`); never hard-delete catalog data.
- **YAGNI.** Explicit out-of-scope list below — we do not build Equipment-as-a-type, memberships,
  inventory, a vendor entity, a cost-band markup matrix, or a live recompute engine.

## Progressive disclosure (the UX spine)

The whole product-design bet: **the pricebook looks identical to today's simple list for a
1-tech shop, and reveals depth in-flow only when the shop reaches for it.** No screen ever
confronts a small shop with materials, categories, GBB, or import unless they opt in. This is
what lets one data model serve 1→25 techs without feeling enterprise-heavy at the bottom.

All reveals are **anchored and in-flow** — panels expand under their row, never floating
popovers/portals (house rule: No floating UI).

**Level 0 — default (what a 1-tech shop ever sees).** Identical in spirit to today: a flat list
of services (name → price) and one add row. Empty state offers the two on-ramps.

```
┌─ Pricebook ─────────────────────────────── 24 services ─┐
│  Water heater — 40gal gas install            $2,400   ▸ │
│  Toilet reset                                  $220   ▸ │
│  Sewer camera inspection w/ locate             $285   ▸ │
│  [ e.g. Hydro-jet kitchen drain ]  [ $ price ]  [+ Add] │
│                                                          │
│  (empty state) → [ Start with plumbing basics ] [Import]│
└──────────────────────────────────────────────────────────┘
```

**Level 1 — a row expands in-flow (`▸`→`▾`) to reveal details.** Cost/margin, labor hours,
category, taxable, warranty — all optional. A shop that never opens this never sees cost fields.

```
│  Water heater — 40gal gas install            $2,400   ▾ │
│    Category   Water Heaters › Tank › Gas                 │
│    Your cost  $1,180        Margin 51%   (owner-only)    │
│    Labor      3.0 hrs                                    │
│    Taxable    ◉ yes     Warranty  6-yr parts / 1-yr labor│
│    [ Break into parts ]        [ Add Good/Better/Best ]  │
```

**Level 2 — "Break into parts" reveals Materials** (the hidden cost ingredients). Only shops
that job-cost ever open this; the service price stays the customer-facing number.

```
│    Parts — internal only, never shown to the customer    │
│      Rheem 40gal Performance      1 × $980               │
│      Expansion tank + straps      1 × $85                │
│      [ + part ]         Parts cost $1,065 → price basis  │
```

**Level 3 — "Add Good/Better/Best" turns the row into a 3-tier option group** (the water-heater
sell motion). Absent unless requested.

```
│    Options    Good $1,800  ·  Better $2,400  ·  Best $3,200
```

**Level 4 — organize & scale.** The category tree + search surface only once the book crosses a
threshold (~15 lines) or via an explicit "Group by category" toggle; CSV import lives in the
empty state and a header overflow action. A small book renders flat; a 1,000-line book renders as
a searchable tree — same data.

The same discipline applies to the sibling cards: **Labor rates** collapses to a
"Diagnostic/trip fee" field by default with base-rate + after-hours revealed under "More rates";
**Terms** is one default block, not a library.

## Data model

New module `modules/pricebook`. Money in integer cents, org-scoped, soft-delete, hand-written
RLS per table, composite FKs on child tables. Field set derived from the leaders' import specs
(Housecall Pro is the lean de-facto standard) trimmed by YAGNI.

```
pricebook_category
  id            uuid pk
  org_id        uuid not null → orgs(id)
  parent_id     uuid          → pricebook_category(id)      -- self-ref tree (Water Heaters›Tank›Gas)
  name          text not null
  sort_order    int  not null default 0
  deleted_at    timestamptz
  composite FK  (org_id, parent_id) → pricebook_category(org_id, id)

pricebook_service                 -- THE sellable task→price line (evolves pricebook_items)
  id            uuid pk
  org_id        uuid not null → orgs(id)
  category_id   uuid          → pricebook_category(id)      -- nullable
  code          text                                        -- SKU/short code: import match + search
  name          text not null                               -- was pricebook_items.label
  description   text                                        -- customer-facing
  price_cents   int  not null default 0                     -- FLAT RATE (markup already baked in)
  cost_cents    int  not null default 0                     -- optional; else rolled up from materials
  labor_hours   numeric(5,2)                                -- sold/billable hours (duration + costing)
  taxable       boolean not null default false
  warranty_text text
  image_url     text
  is_addon      boolean not null default false              -- found-work / cross-sell surface
  option_group_id uuid        → pricebook_option_group(id)  -- GBB grouping (nullable)
  tier          text          CHECK in ('good','better','best')   -- null unless in an option group
  position      int  not null default 0
  active        boolean not null default true
  created_at / updated_at / deleted_at
  composite FK  (org_id, category_id), (org_id, option_group_id)

pricebook_material                -- hidden cost ingredient
  id, org_id → orgs(id)
  category_id   uuid          → pricebook_category(id)
  code          text                                        -- part #
  name          text not null
  description   text
  unit_cost_cents int not null default 0
  unit_of_measure text not null default 'each'              -- each | ft | box …
  markup_bps    int                                         -- per-material override (null → org default)
  taxable       boolean not null default false
  vendor        text                                        -- one text field (no vendor entity — YAGNI)
  active        boolean not null default true
  deleted_at    timestamptz

pricebook_service_material        -- JOIN: builds cost + powers found-work add-ons
  org_id        uuid not null
  service_id    uuid not null → pricebook_service(id)
  material_id   uuid not null → pricebook_material(id)
  quantity      numeric(8,2) not null default 1
  pk (service_id, material_id)
  composite FKs (org_id, service_id), (org_id, material_id)

pricebook_option_group            -- GBB header (tiers live on the 3 pricebook_service rows)
  id, org_id → orgs(id)
  name          text not null
  deleted_at    timestamptz

labor_rate                        -- tiny config table (moves from settings scalars)
  id, org_id → orgs(id)
  name          text not null                               -- "Standard", "After-hours", "Diagnostic fee"
  kind          text not null CHECK in ('hourly','trip_fee','diagnostic_fee')
  rate_cents    int  not null default 0                     -- $/hr for hourly; flat $ for fees
  multiplier    numeric(4,2)                                -- 1.5–2× for after-hours (null otherwise)
  position      int  not null default 0
  deleted_at    timestamptz
```

**Markup** stays a single scalar on `org_settings` (`markup_bps`, already present), reframed as
the default applied to found-work / T&M parts and as each material's fallback. No cost-band
matrix (the leaders warn against it — uniform margin is the goal).

## The island fix — where the pricebook connects

The structure is worthless until the quote surfaces read it. This is the highest-value change.

- **Composer (`app/(office)/composer/page.tsx`)** — the primary "New quote" path. Replace its
  hardcoded `PRICEBOOK`/`TEMPLATES`/`TERMS_LIB` consts with `useAppStore((s) => s.pricebook)`
  (services) + category browse/search; wire the dead "Save to book" handler to
  `v1.pricebook.service.create`.
- **Invoice modal (`components/modals/invoice-modal.tsx`)** — replace its local `PRICEBOOK` const
  with the store pricebook (same `AddMenu` the tech builders already use).
- **AI drafter (`modules/ai/app/draft-estimate.ts`)** — pass the org's services (name, price,
  category) into the draft context so the model prices from the shop's real book instead of
  "typical trade pricing," and flags off-book lines. (Retrieval, not fine-tuning.)
- **Quote/estimate line** — add a nullable `pricebook_service_id` to the estimate line
  (`modules/quoting`), snapshot-copying `name/price/cost/taxable` at add-time. Purely additive;
  existing snapshot behaviour and totals math unchanged.

## Domain / module layout

```
modules/pricebook/
  domain/    Service, Material, Category, OptionGroup, LaborRate value objects (immutable, create→Result)
             + repository interfaces (ServiceRepository, MaterialRepository, CategoryRepository, LaborRateRepository)
  app/       use-cases (DI, return Result): CreateService, UpdateService, ArchiveService,
             AttachMaterial, DetachMaterial, CreateCategory, MoveService, CreateOptionGroup,
             SetTier, CreateLaborRate, ImportPricebook (per-row Result), ListPricebook
  infra/     Drizzle repositories (org-scoped) + mappers (row ↔ domain)
  api/       pricebook-router (thin transport, ownerOrOffice), pricebook-dto.ts (wire shapes)
  index.ts   barrel
```

Store: extend the pricebook slice from `PbItem` to the richer `Service`/`Material` shapes behind
the same optimistic→persist→reconcile→rollback pattern; hydrate via a `PricebookHydrator`.

## Migration & backfill

Additive, in-place evolution of the existing table (no data loss, no down-migration):

1. `pricebook_items` → **rename to `pricebook_service`**; add the new nullable columns
   (`category_id, code, description, labor_hours, taxable, warranty_text, image_url, is_addon,
   option_group_id, tier, active`). Existing rows: `label`→`name`, cents preserved, new columns
   null/default. Every existing pricebook survives untouched.
2. New tables (`pricebook_category, pricebook_material, pricebook_service_material,
   pricebook_option_group, labor_rate`) + hand-written RLS migration per the tenant rule.
3. Migrate `org_settings` labor-rate rows (if any) into `labor_rate`; keep `markup_bps` on
   `org_settings`.
4. **Seed pack:** a prebuilt ~20–40-line plumbing starter (services + categories) a new org can
   accept/edit, so the book is never an empty grid. Ships as data, applied on demand (not a
   migration).

Migrations are single-writer against the shared DB — coordinate the number with any open
`shared/db/migrations` PR (documented gotcha).

## Cuts folded in (from the prior settings review)

- **Your trade** — remove the live settings card (its "reloads starter pricebook" copy was
  false). Its real role is a **one-time onboarding pick** that seeds the category tree + AI call
  taxonomy + the plumbing seed pack. Moves to signup, not a live control.
- **Terms library** — remove the write-only library; re-add as **one default terms/warranty
  block auto-attached to quotes + invoices** (a small separate effort, wired when we touch the
  quote/invoice document — Phase 2).
- **Default parts markup** — **keep, reframed.** Not dead weight: it's the single global % applied
  to found-work / T&M parts and each material's fallback markup. Reframe the card copy from "only
  pre-fills a suggested price" to what it actually governs once materials/found-work exist.

## Phasing (each phase independently shippable)

1. **Connect + foundation.** Rename/extend `pricebook_service` (category, code, labor_hours,
   taxable); add `pricebook_category`; **wire Composer + invoices + AI to the real pricebook**;
   kill the hardcoded arrays + dead "Save to book"/"Upload" handlers; ship the plumbing seed
   pack; remove the trade card (→ onboarding). *Delivers the island fix — the pricebook becomes
   real.*
2. **Depth.** `pricebook_material` + `service_material` join (job costing + found-work); markup
   applied to found-work parts; `labor_rate` config (diagnostic fee + after-hours); single
   default terms block on quotes/invoices.
3. **Sell + switch.** Good/Better/Best option groups; CSV import (Housecall Pro column spec,
   field-mapping UI, per-row Result reporting).

## Testing strategy (test pyramid)

- **Unit** — domain value objects (create/validation/Result), mappers (row↔domain, cents↔dollars),
  use-case logic with mocked repositories, store slice optimistic/rollback.
- **Integration** — router procedures against the live RLS DB (`test:int`): tenant isolation
  (org A cannot read org B's services/materials), cascade FKs, import per-row outcomes.
- **Component/E2E** — progressive-disclosure reveals render in-flow; Composer/invoice add-from-book
  reads real data; a seeded quote line snapshots and survives a later catalog edit.
- Coverage gate held (80% stmts / 75% branches; repo runs ~92/83 — don't regress).

## Out of scope (YAGNI)

- **Equipment as a separate serialized type** — fold water heaters/softeners into
  `pricebook_service`; capture serials at *job* time later.
- **Membership / member pricing** — dropped entirely (no memberships in the ICP).
- **Inventory** (on-hand counts, `is_inventory`).
- **Vendor as an entity** / multi-vendor part pricing — one `vendor` text field for now.
- **Cost-band markup matrix** — never; uniform markup only.
- **Live price-recompute engine** (`hours × rate + materials` on the fly) — flat `price_cents` is
  the source of truth.
- **Per-tech-tier / client-specific rates, commissions, videos, cross-sell graph.**

## Open decisions (need Owen)

1. **Markup:** confirm the reframe (keep as the found-work/materials knob) vs. still remove.
2. **Module extraction:** confirm splitting the catalog into `modules/pricebook` (recommended)
   vs. leaving it inside `modules/settings`.
3. **GBB modeling:** on-the-task 3-tier option group (Profit-Rhino-style, recommended for
   plumbing) vs. on-the-estimate baskets (ServiceTitan-style). Spec assumes the former.
4. **Phase 1 scope:** is "connect the island + foundation" the right first cut, or do you want
   the seed pack / import pulled earlier?
