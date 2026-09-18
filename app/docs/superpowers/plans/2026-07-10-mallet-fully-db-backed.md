# Mallet Fully DB-Backed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every prototype leftover so all user-meaningful state persists to Supabase and survives a refresh — no store-only state, no sample data as a source of truth.

**Architecture:** Every gap is closed by extending the *existing* patterns — a Drizzle table (RLS-scoped via `current_org_id()`), a tRPC v1 procedure (use-case + repository in a hexagonal module mirroring `modules/companies/`), a store hydrator, and the store action switched from store-only to optimistic → `trpcVanilla` persist → reconcile/rollback (mirroring `addTask`/`updateLead`/`addCompany`). The DB is the source of truth; the Zustand store stays a hydrated in-memory cache (no localStorage/persist middleware).

**Tech Stack:** Next.js 16 (App Router), tRPC v11, Drizzle ORM + Supabase Postgres (RLS, `mallet_app` NOBYPASSRLS runtime role), Zustand, Supabase Storage (Phase 5), Vitest, drizzle-kit migrations.

## Global Constraints

- Every new table is org-scoped: `org_id` FK to `orgs` (`onDelete: cascade`), and **RLS is hand-written into the migration** (tenant isolation via `current_org_id()`) — drizzle-kit does NOT emit RLS. Copy the exact `CREATE POLICY` syntax from a recent `*_rls` migration under `shared/db/migrations/`.
- Org id is **never** taken from client input — always from the authenticated principal via `withTenant`.
- **Soft-delete only. No hard deletes.** `deleteLead`/`deleteJob` repoint to archive/cancel semantics; collections use a `deleted_at` column.
- **Money in cents, rates/discounts in bps**, matching quoting/invoicing.
- **MIGRATION NUMBERING (critical — resolves the parallel-authoring collisions in the phase drafts below):** the last existing migration is **`0043_strong_ricochet`**. Migration numbers/filenames written inside the phase tasks below are **illustrative placeholders** — do NOT hardcode them. When you build a phase, run `npm run db:generate` (drizzle-kit) which assigns the next sequential number from the current `_journal.json`, hand-add the RLS `--> statement-breakpoint` policy blocks + any backfill to the generated file, then `npm run db:migrate`. Because phases merge in order (1→7), numbers land sequentially in the repo automatically.
- **`addLead` signature change (Phase 1, consumed by Phase 4):** `addLead(draft)` returns `{ lead: Lead; persisted: Promise<Lead> }` (was `=> Lead`). Every caller destructures `{ lead }` for the optimistic record and `await`s `persisted` to get the reconciled server id before creating anything that FKs to the lead (jobs, evisits). `addChecklist` (Phase 6) adopts the same `{ checklist, persisted }` convention.
- **Phases 3 and 5 depend on earlier phases:** Phase 3 (branding) adds columns to Phase 2's `org_settings` table and extends `v1.settings`; Phase 5 (job execution data) builds on Phase 4's `jobs.svc` column and `v1.jobs` router. Build in order.
- **No `@/lib/prototype-sample` import may remain as a source of truth** in a shipped screen after its phase completes (sample data may remain only in tests/fixtures).
- **Each phase is its own PR** and must pass the full repo gate before merge: `npx tsc --noEmit` · `npm run lint` (0 errors) · `npx vitest run` (unit + int) · coverage 80/75 · `npm run build`, plus an adversarial code review. Each phase's final task is "verify the gate + open the PR."
- New backend domains mirror `modules/companies/` exactly: `domain/` (aggregate + repository interface), `app/` (one use-case per op + unit test), `infra/` (Drizzle repo + row↔domain mapper), `api/` (router + DTO + int test), barrel `index.ts`, registered in `trpc/root.ts`.

## Phase dependency order

1. Lead quick-wins → 2. Settings backend → 3. Branding → 4. Jobs → 5. Job execution data (Supabase Storage photos) → 6. Checklist templates → 7. Invoice edits.

---


## Phase 1: Lead quick-wins (no new backend)

Wire the four store-only lead actions to the tRPC endpoints that **already exist** —
`v1.customers.{create,update,archive,restore}` — using the same
optimistic → persist → reconcile/rollback pattern already proven by `addTask`,
`updateLead`, and `addCompany`. No schema, no migration, no new router.

### Scope constraints discovered while reading the code (LOCKED for this phase)

1. **Stage vocabulary mismatch is real and load-bearing.** The store's runtime
   `Lead.stage` is a **display string** — `"New customer" | "Contacted" |
   "Quote Sent" | "Won" | "Lost"` — used by `STAGE_PILL_CLS`
   (`lib/prototype-sample.ts:789`), `features/pipeline/pipeline-lanes.ts`
   (filters `l.stage === "Quote Sent"`), `features/pipeline/pipeline-constants.ts`
   (`STAGE_ORDER`), `components/modals/lead-modal/lead-header.tsx:49`
   (`lead.stage === "New customer"`), and callers `composer/page.tsx:1521`
   (`stage: "New customer"`), `new-job-modal.tsx:200` (`stage: "Contacted"`),
   `sweep-modal.tsx:56` (`stage: "Lost"`), and `use-counter.ts:124`
   (`moveLeadStage(gate.leadId, "Quote Sent")`). The **DB enum** is
   `"new" | "contacted" | "quote_sent" | "won" | "lost"`
   (`modules/customers/domain/lead.ts:6`, `LEAD_STAGES`). Today
   `buildLeadUpdatePayload` blindly casts `patch.stage as CustomerUpdateInput["stage"]`
   (`leads-slice.ts:85`), which would ship `"Quote Sent"` to a router whose Zod
   input is `z.enum(["new","contacted",...])` — a guaranteed `BAD_REQUEST`. **This
   phase adds a bidirectional store↔DB stage mapper** and routes it through
   `buildLeadUpdatePayload` (display→enum) and the reconcile path (enum→display),
   so persisting a stage works at all. This is the minimum required for the
   phase's own actions to function; it is not a redesign.

2. **`v1.customers.create` has no `stage` input** (`lead-router.ts:35-42`: only
   `name/phone/email/source/companyId/role`) — the domain always starts a new
   lead at `"new"`. Therefore `addLead` does **not** send a stage; whatever
   display-stage the caller passed stays client-local until the first
   `moveLeadStage`/`updateLead({stage})`.

3. **`v1.customers.create` dedupes** (`EnsureCustomerUseCase`, `createLeadDTO`
   has a `created: boolean`). The server may return an **existing** row's id on a
   phone-number match. `addLead`'s reconcile therefore adopts the server id
   (client-authored UUID is replaced), which is why callers holding the returned
   lead must read the **reconciled** id (Task 5 handles the New-Job modal).

4. **Soft-delete only.** `deleteLead` repoints to `v1.customers.archive` (sets
   `archived: true`, filtered out of every live view) — no array removal, no hard
   delete. `sweep-modal.tsx` and `more-details.tsx` both close their surface after
   calling it, so the leftover archived row is never shown.

5. **Coverage note.** `vitest.config.ts` scopes coverage `include` to
   `shared/** · modules/** · platform/**` only — `lib/store/**` is **not** in the
   coverage set. Phase 1 touches only `lib/store/**`, so it adds no backend code to
   the measured dirs; the 80/75 thresholds stay satisfied by the existing
   `modules/**` coverage. The new slice tests still execute in the unit suite
   (`include: ["**/*.test.ts","**/*.test.tsx"]`) and must pass.

---

### Task 1: Bidirectional store↔DB stage mapper

Add two pure, exported functions that translate between the store's display-string
stages and the DB enum. They live in `lib/store/dto-mapper.ts` (the existing shared
mapping home — "no React, no tRPC, no side effects" per its header) so both
`leads-slice.ts` (build/reconcile) and `features/customers/leads-hydrator.tsx`
(hydrate) call one implementation.

**Files:**
- Modify: `lib/store/dto-mapper.ts` (append after the TimeEntry section, ~L300)
- Test: `lib/store/dto-mapper.test.ts` (new file — the stage-mapper block; if the
  file already exists, append the `describe` block)

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `storeStageToBackend(stage: string): "new" | "contacted" | "quote_sent" | "won" | "lost"`
  - `backendStageToStore(stage: string): string` (returns a `STAGE_PILL_CLS` display key)
  - `const STAGE_DISPLAY_TO_BACKEND: Record<string, "new"|"contacted"|"quote_sent"|"won"|"lost">`

- Step: write the failing test.

```ts
// lib/store/dto-mapper.test.ts
import { describe, it, expect } from "vitest";
import { storeStageToBackend, backendStageToStore } from "./dto-mapper";

describe("stage mapper (store display ↔ DB enum)", () => {
  it("maps every display stage to its DB enum value", () => {
    expect(storeStageToBackend("New customer")).toBe("new");
    expect(storeStageToBackend("Contacted")).toBe("contacted");
    expect(storeStageToBackend("Quote Sent")).toBe("quote_sent");
    expect(storeStageToBackend("Won")).toBe("won");
    expect(storeStageToBackend("Lost")).toBe("lost");
  });

  it("passes through a value that is already a DB enum (idempotent)", () => {
    expect(storeStageToBackend("quote_sent")).toBe("quote_sent");
    expect(storeStageToBackend("new")).toBe("new");
  });

  it("falls back to 'new' for an unknown stage string", () => {
    expect(storeStageToBackend("Totally unknown")).toBe("new");
  });

  it("maps every DB enum value back to its display stage", () => {
    expect(backendStageToStore("new")).toBe("New customer");
    expect(backendStageToStore("contacted")).toBe("Contacted");
    expect(backendStageToStore("quote_sent")).toBe("Quote Sent");
    expect(backendStageToStore("won")).toBe("Won");
    expect(backendStageToStore("lost")).toBe("Lost");
  });

  it("round-trips display → backend → display for all five stages", () => {
    for (const s of ["New customer", "Contacted", "Quote Sent", "Won", "Lost"]) {
      expect(backendStageToStore(storeStageToBackend(s))).toBe(s);
    }
  });

  it("passes through an already-display value in backendStageToStore", () => {
    expect(backendStageToStore("Quote Sent")).toBe("Quote Sent");
  });
});
```

- Step: run it, expected FAIL (functions do not exist yet).

```
npx vitest run lib/store/dto-mapper.test.ts
```

Expected: `Error: No known export 'storeStageToBackend' in module ./dto-mapper` /
suite fails to import.

- Step: minimal implementation — append to `lib/store/dto-mapper.ts`.

```ts
// ---------------------------------------------------------------------------
// Lead stage mapping (store display string ↔ DB enum)
// ---------------------------------------------------------------------------
//
// The store keeps stages as display strings ("New customer", "Quote Sent") —
// the vocabulary STAGE_PILL_CLS / pipeline-lanes / STAGE_ORDER render. The DB
// enum (modules/customers/domain/lead.ts LEAD_STAGES) is
// "new" | "contacted" | "quote_sent" | "won" | "lost". v1.customers.update only
// accepts the enum, so every persisted stage MUST pass through here.

export type BackendStage = "new" | "contacted" | "quote_sent" | "won" | "lost";

/** Display stage → DB enum. Unknown/unrecognised falls back to "new". */
export const STAGE_DISPLAY_TO_BACKEND: Record<string, BackendStage> = {
  "New customer": "new",
  Contacted: "contacted",
  "Quote Sent": "quote_sent",
  Won: "won",
  Lost: "lost",
};

/** DB enum → display stage. Used on hydrate + reconcile. */
const STAGE_BACKEND_TO_DISPLAY: Record<BackendStage, string> = {
  new: "New customer",
  contacted: "Contacted",
  quote_sent: "Quote Sent",
  won: "Won",
  lost: "Lost",
};

const BACKEND_STAGES = new Set<string>(["new", "contacted", "quote_sent", "won", "lost"]);

/**
 * Map a store stage (display OR already-enum) to the DB enum. Idempotent for
 * values that are already enum values; falls back to "new" for anything unknown.
 */
export function storeStageToBackend(stage: string): BackendStage {
  if (BACKEND_STAGES.has(stage)) return stage as BackendStage;
  return STAGE_DISPLAY_TO_BACKEND[stage] ?? "new";
}

/**
 * Map a DB enum stage back to the store display string. Passes through a value
 * that is already a display string; returns the input unchanged if unrecognised.
 */
export function backendStageToStore(stage: string): string {
  if (BACKEND_STAGES.has(stage)) return STAGE_BACKEND_TO_DISPLAY[stage as BackendStage];
  return stage;
}
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/dto-mapper.test.ts
```

Expected: `Test Files 1 passed` · `Tests 6 passed`.

- Step: commit.

```
git checkout -b phase-1-lead-quick-wins
git add lib/store/dto-mapper.ts lib/store/dto-mapper.test.ts
git commit -m "feat: add bidirectional store↔DB lead stage mapper

The store keeps stages as display strings but v1.customers.update accepts
only the DB enum; add storeStageToBackend/backendStageToStore so persisting
a stage no longer 400s on the enum mismatch."
```

---

### Task 2: `buildLeadUpdatePayload` maps the stage; hydrator + reconcile use the display mapper

Wire the Task-1 mapper into the two existing paths that touch `stage`, so
`updateLead({ stage })`, `moveLeadStage`, and the sweep "Lost" path all send valid
enum values, and hydrated/reconciled leads carry display stages consistently.

**Files:**
- Modify: `lib/store/slices/leads-slice.ts`
  - `buildLeadUpdatePayload` stage branch (L83-85)
  - `reconcileLeadFromDTO` stage assignment (L128 → `stage: dto.stage`)
- Modify: `features/customers/leads-hydrator.tsx` `toStoreLead` (L34, `stage: dto.stage`)
- Test: extend `lib/store/slices/leads-slice.test.ts` (the `buildLeadUpdatePayload`
  block, ~L77)

**Interfaces:**
- Consumes: `storeStageToBackend`, `backendStageToStore` (Task 1).
- Produces: `buildLeadUpdatePayload` now emits `stage` as a DB enum;
  `reconcileLeadFromDTO` returns a display stage.

- Step: write the failing test — append inside the existing
  `describe("buildLeadUpdatePayload", ...)` block in `leads-slice.test.ts`.

```ts
  it("maps a display stage to the DB enum in the payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "Quote Sent" });
    expect(payload).not.toBeNull();
    expect(payload?.stage).toBe("quote_sent");
  });

  it("maps 'Lost' (sweep) to the DB enum", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "Lost" });
    expect(payload?.stage).toBe("lost");
  });

  it("passes an already-enum stage through unchanged", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "won" });
    expect(payload?.stage).toBe("won");
  });
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: the three new cases fail — `expected 'Quote Sent' to be 'quote_sent'`
(current code casts the display string straight through).

- Step: minimal implementation.

In `lib/store/slices/leads-slice.ts`, add the import (with the existing imports at
top of file):

```ts
import { storeStageToBackend, backendStageToStore } from "@/lib/store/dto-mapper";
```

Replace the `stage` branch in `buildLeadUpdatePayload` (currently L82-85):

```ts
    } else if (key === "stage") {
      // Store Lead.stage is a display string; the router validates the enum
      // server-side. Map display → enum before sending.
      if (patch.stage !== undefined) {
        payload.stage = storeStageToBackend(patch.stage) as CustomerUpdateInput["stage"];
      }
    } else if (key === "unread") {
```

Replace the `stage` line in `reconcileLeadFromDTO` (currently L128 `stage: dto.stage,`):

```ts
    // DTO carries the DB enum; the store renders display strings.
    stage: backendStageToStore(dto.stage),
```

In `features/customers/leads-hydrator.tsx`, add the import:

```ts
import { backendStageToStore } from "@/lib/store/dto-mapper";
```

Replace the `stage` line in `toStoreLead` (currently L34 `stage: dto.stage,`):

```ts
    stage: backendStageToStore(dto.stage),
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: `Tests <n> passed` (existing suite + the three new cases green).

- Step: commit.

```
git add lib/store/slices/leads-slice.ts features/customers/leads-hydrator.tsx lib/store/slices/leads-slice.test.ts
git commit -m "fix: map lead stage through display↔enum on persist, reconcile, and hydrate

buildLeadUpdatePayload now emits the DB enum; reconcileLeadFromDTO and the
LeadsHydrator translate enum→display so the store's stage vocabulary stays
consistent with STAGE_PILL_CLS and pipeline-lanes."
```

---

### Task 3: `addLead` persists via `v1.customers.create` (optimistic + reconcile server id + rollback)

Change `addLead` from a store-only insert to the `addCompany` pattern: optimistic
prepend with a client UUID, persist via `v1.customers.create`, **adopt the
server-assigned id** on reconcile (dedupe may return an existing row), roll back on
error. Because the id can change, `addLead` returns `{ lead; persisted }` so
FK-dependent callers can await the committed row (Task 5).

**Files:**
- Modify: `lib/store/slices/leads-slice.ts`
  - `LeadsSlice.addLead` signature (L155)
  - `addLead` implementation (L183-194)
  - add a `dtoToLeadReconcile` local helper reusing `reconcileLeadFromDTO`
- Test: extend `lib/store/slices/leads-slice.test.ts` (new `describe("addLead …")`)

**Interfaces:**
- Consumes: `trpcVanilla.v1.customers.create.mutate` — input
  `{ name: string; phone?: string; email?: string; source?: string;
  companyId?: string|null; role?: string|null }`; output `createLeadDTO`
  (`leadDTO` + `created: boolean`), i.e. `{ id, name, phone, email, source, stage,
  value:{cents,currency}, unread, companyId, role, createdAt, created }`
  (`lead-router.ts:33,182-210`).
- Produces:
  `addLead(draft): { lead: Lead; persisted: Promise<Lead> }` — `persisted`
  resolves to the **reconciled** lead (server id adopted). Mirrors
  `addCompany`'s `{ company; persisted }` shape (`data-slice.ts:45`).

- Step: write the failing test — new block in `leads-slice.test.ts`. First extend
  the top `vi.mock` to expose `customers.create`:

```ts
// In the existing vi.mock("@/lib/trpc/vanilla", ...) — add create beside update:
      customers: {
        update: { mutate: (...args: unknown[]) => mockMutate(...args) },
        create: { mutate: (...args: unknown[]) => mockCreate(...args) },
      },
```

Add the module-scope stub beside `mockMutate` (top of file, ~L24):

```ts
const mockCreate = vi.fn();
```

Then the new suite:

```ts
describe("addLead (with trpcVanilla mock)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      id: "srv-lead-999",
      name: "Ada Lovelace",
      phone: "+15550001234",
      email: null,
      source: "Added manually",
      stage: "new",
      value: { cents: 0, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
      createdAt: new Date().toISOString(),
      created: true,
    });
  });

  it("prepends optimistically and calls create with name/phone/source", () => {
    const slice = makeSlice();
    const { lead } = slice.state.addLead({
      name: "Ada Lovelace",
      phone: "+15550001234",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    // Optimistic insert visible immediately with a client UUID.
    expect(slice.state.leads).toHaveLength(1);
    expect(slice.state.leads[0]?.name).toBe("Ada Lovelace");
    expect(lead.id).toBe(slice.state.leads[0]?.id);
    // create called with the DB-persisted fields (no stage — server starts at "new").
    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.name).toBe("Ada Lovelace");
    expect(call.phone).toBe("+15550001234");
    expect(call.source).toBe("Added manually");
    expect(call.stage).toBeUndefined();
  });

  it("adopts the server-assigned id on reconcile (dedupe-safe)", async () => {
    const slice = makeSlice();
    const { lead, persisted } = slice.state.addLead({
      name: "Ada Lovelace",
      phone: "+15550001234",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    const optimisticId = lead.id;
    const reconciled = await persisted;
    // The optimistic row's id is replaced by the server id.
    expect(reconciled.id).toBe("srv-lead-999");
    expect(slice.state.leads.some((l: Lead) => l.id === optimisticId)).toBe(false);
    expect(slice.state.leads.some((l: Lead) => l.id === "srv-lead-999")).toBe(true);
    // Local-only fields (acts, evisits) survive the id swap.
    const row = slice.state.leads.find((l: Lead) => l.id === "srv-lead-999");
    expect(row?.acts).toEqual([]);
    expect(row?.evisits).toEqual([]);
  });

  it("maps the reconciled DB enum stage back to a display string", async () => {
    mockCreate.mockResolvedValue({
      id: "srv-lead-1000", name: "Existing Dedup", phone: null, email: null,
      source: null, stage: "quote_sent", value: { cents: 0, currency: "USD" },
      unread: false, companyId: null, role: null,
      createdAt: new Date().toISOString(), created: false,
    });
    const slice = makeSlice();
    const { persisted } = slice.state.addLead({
      name: "Existing Dedup", phone: "", source: "", stage: "New customer", job: "",
    });
    const reconciled = await persisted;
    expect(reconciled.stage).toBe("Quote Sent");
  });

  it("rolls back the optimistic lead on create failure", async () => {
    mockCreate.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    const { persisted } = slice.state.addLead({
      name: "Fail", phone: "", source: "", stage: "New customer", job: "",
    });
    expect(slice.state.leads).toHaveLength(1);
    await persisted.catch(() => undefined);
    expect(slice.state.leads).toHaveLength(0);
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: the `addLead` suite fails — `mockCreate` was never called (current
`addLead` is store-only), and `persisted` is `undefined` (current return is a plain
`Lead`).

- Step: minimal implementation — in `lib/store/slices/leads-slice.ts`.

Change the interface declaration (currently L155):

```ts
  addLead: (
    draft: Omit<Lead, "id" | "age" | "last" | "acts" | "evisits">,
  ) => { lead: Lead; persisted: Promise<Lead> };
```

Add a reconcile helper next to `reconcileLeadFromDTO` (after L144):

```ts
/**
 * Build the store Lead that replaces the optimistic row once create resolves.
 * The server assigns the id (dedupe may return an existing row), so we key off
 * the DTO id and re-pin all local-only fields from the optimistic row.
 */
function adoptCreatedLead(optimistic: Lead, dto: Parameters<typeof reconcileLeadFromDTO>[1]): Lead {
  // reconcileLeadFromDTO preserves local-only fields and maps the stage; the
  // only extra step is adopting the server id.
  return { ...reconcileLeadFromDTO(optimistic, dto), id: dto.id };
}
```

Replace the `addLead` body (currently L183-194):

```ts
  addLead: (draft) => {
    const id = crypto.randomUUID();
    const newLead: Lead = {
      ...draft,
      id,
      age: 0,
      last: "Just added",
      acts: [],
      evisits: [],
    };
    // Snapshot BEFORE the optimistic insert so we can roll back on failure.
    const prior = get().leads.slice();
    set((s) => ({ leads: [newLead, ...s.leads] }));

    // Persist. The server assigns the id (create dedupes on phone), so the
    // reconcile swaps the optimistic id for the server id. Callers holding the
    // returned lead must read the reconciled id from `persisted`.
    const persisted: Promise<Lead> = trpcVanilla.v1.customers.create
      .mutate({
        name: newLead.name,
        // create input treats empty phone/email as "not provided" — send only when set.
        ...(newLead.phone && newLead.phone !== "—" ? { phone: newLead.phone } : {}),
        ...(newLead.email ? { email: newLead.email } : {}),
        ...(newLead.source ? { source: newLead.source } : {}),
        ...(newLead.companyId ? { companyId: newLead.companyId } : {}),
        ...(newLead.role ? { role: newLead.role } : {}),
      })
      .then((dto) => {
        const reconciled = adoptCreatedLead(newLead, dto);
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? reconciled : l)),
        }));
        return reconciled;
      })
      .catch((err: unknown) => {
        // Rollback: restore the pre-insert snapshot (removes the optimistic row).
        set({ leads: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] addLead failed — rolled back", { id, err });
        }
        throw err instanceof Error ? err : new Error("addLead failed");
      });

    return { lead: newLead, persisted };
  },
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: `Tests <n> passed`, including the four `addLead` cases.

- Step: commit.

```
git add lib/store/slices/leads-slice.ts lib/store/slices/leads-slice.test.ts
git commit -m "feat: persist addLead via v1.customers.create with server-id reconcile

Optimistic prepend → create → adopt server id (dedupe-safe) → rollback on
error. Returns { lead, persisted } so FK-dependent callers can await the
committed row, mirroring addCompany."
```

---

### Task 4: `moveLeadStage`, `archiveLead`, `restoreLead`, `deleteLead` persist

Route the three lifecycle actions through their existing endpoints and fold
`moveLeadStage` into the `updateLead` persist path (keeping its signature + the
`last: "Moved to ..."` local touch). `deleteLead` repoints to archive (soft-delete).

**Files:**
- Modify: `lib/store/slices/leads-slice.ts`
  - `moveLeadStage` (L250-255)
  - `archiveLead` (L277-280)
  - `restoreLead` (L282-285)
  - `deleteLead` (L287-290)
- Test: extend `lib/store/slices/leads-slice.test.ts`

**Interfaces:**
- Consumes:
  - `trpcVanilla.v1.customers.update.mutate` — output `leadDTO` (see Task 3).
  - `trpcVanilla.v1.customers.archive.mutate({ leadId })` → `{ ok: boolean }`
    (`lead-router.ts:149-161`).
  - `trpcVanilla.v1.customers.restore.mutate({ leadId })` → `leadDTO`
    (`lead-router.ts:163-180`).
  - `buildLeadUpdatePayload`, `reconcileLeadFromDTO`, `backendStageToStore`
    (Tasks 1-2), `updateLead` (existing).
- Produces: four persisting actions (same signatures as today).

- Step: write the failing test — new block in `leads-slice.test.ts`. Extend the
  `vi.mock` `customers` object to include `archive`/`restore`:

```ts
      customers: {
        update: { mutate: (...args: unknown[]) => mockMutate(...args) },
        create: { mutate: (...args: unknown[]) => mockCreate(...args) },
        archive: { mutate: (...args: unknown[]) => mockArchive(...args) },
        restore: { mutate: (...args: unknown[]) => mockRestore(...args) },
      },
```

Add the stubs (top of file, beside `mockMutate`):

```ts
const mockArchive = vi.fn();
const mockRestore = vi.fn();
```

The suite:

```ts
describe("lead lifecycle persistence (with trpcVanilla mock)", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockArchive.mockReset();
    mockRestore.mockReset();
    mockMutate.mockResolvedValue({
      id: "lead-111", name: "Ada Lovelace", phone: "+15550001234", email: null,
      source: "referral", stage: "quote_sent", value: { cents: 25000, currency: "USD" },
      unread: false, companyId: null, role: null, createdAt: new Date().toISOString(),
    });
    mockArchive.mockResolvedValue({ ok: true });
    mockRestore.mockResolvedValue({
      id: "lead-111", name: "Ada Lovelace", phone: "+15550001234", email: null,
      source: "referral", stage: "new", value: { cents: 25000, currency: "USD" },
      unread: false, companyId: null, role: null, createdAt: new Date().toISOString(),
    });
  });

  it("moveLeadStage applies optimistically, sends the enum, and sets the 'Moved to' note", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ stage: "New customer" })]);
    slice.state.moveLeadStage("lead-111", "Quote Sent");
    const row = slice.state.leads.find((l: Lead) => l.id === "lead-111");
    expect(row?.stage).toBe("Quote Sent");
    expect(row?.last).toBe("Moved to Quote Sent");
    expect(mockMutate).toHaveBeenCalledOnce();
    const call = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.leadId).toBe("lead-111");
    expect(call.stage).toBe("quote_sent"); // display → enum
  });

  it("moveLeadStage rolls back the stage on mutation error", async () => {
    mockMutate.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ stage: "New customer" })]);
    slice.state.moveLeadStage("lead-111", "Quote Sent");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.stage).toBe("Quote Sent");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.stage).toBe("New customer");
  });

  it("archiveLead sets archived optimistically and calls v1.customers.archive", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.archiveLead("lead-111");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledOnce();
    expect((mockArchive.mock.calls[0]?.[0] as Record<string, unknown>).leadId).toBe("lead-111");
  });

  it("archiveLead rolls back on error", async () => {
    mockArchive.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.archiveLead("lead-111");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(false);
  });

  it("restoreLead clears archived optimistically and calls v1.customers.restore", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: true })]);
    slice.state.restoreLead("lead-111");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(false);
    expect(mockRestore).toHaveBeenCalledOnce();
    expect((mockRestore.mock.calls[0]?.[0] as Record<string, unknown>).leadId).toBe("lead-111");
  });

  it("restoreLead rolls back on error", async () => {
    mockRestore.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: true })]);
    slice.state.restoreLead("lead-111");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
  });

  it("deleteLead is a soft-delete: sets archived, keeps the row, calls archive", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.deleteLead("lead-111");
    // Row is NOT removed — archived instead (soft-delete only).
    expect(slice.state.leads).toHaveLength(1);
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledOnce();
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: the lifecycle suite fails — `mockArchive`/`mockRestore` never called
(current actions are store-only), `deleteLead` removes the row (`toHaveLength(1)`
fails with `0`), and `moveLeadStage` never calls `mockMutate`.

- Step: minimal implementation — in `lib/store/slices/leads-slice.ts`.

Replace `moveLeadStage` (L250-255) — fold into the `updateLead` persist path but
keep the local `last` touch:

```ts
  moveLeadStage: (id, stage) => {
    // Optimistic local touch: stage + the "Moved to" activity line. The stage
    // itself persists through updateLead (which maps display→enum and reconciles).
    set((s) => ({
      leads: s.leads.map((l) =>
        l.id === id ? { ...l, last: `Moved to ${stage}` } : l,
      ),
    }));
    // updateLead handles the optimistic stage write + persist + reconcile/rollback.
    get().updateLead(id, { stage });
  },
```

Replace `archiveLead` (L277-280):

```ts
  archiveLead: (id) => {
    const prior = get().leads.slice();
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: true } : l)),
    }));
    void trpcVanilla.v1.customers.archive
      .mutate({ leadId: id })
      .catch((err: unknown) => {
        set({ leads: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] archiveLead failed — rolled back", { id, err });
        }
      });
  },
```

Replace `restoreLead` (L282-285):

```ts
  restoreLead: (id) => {
    const prior = get().leads.slice();
    set((s) => ({
      leads: s.leads.map((l) => (l.id === id ? { ...l, archived: false } : l)),
    }));
    trpcVanilla.v1.customers.restore
      .mutate({ leadId: id })
      .then((dto) => {
        // Reconcile the authoritative row (stage mapped enum→display).
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? reconcileLeadFromDTO(l, dto) : l)),
        }));
      })
      .catch((err: unknown) => {
        set({ leads: prior });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[leads-slice] restoreLead failed — rolled back", { id, err });
        }
      });
  },
```

Replace `deleteLead` (L287-290) — repoint to archive (soft-delete only):

```ts
  // Soft-delete only: "delete" archives the lead (no hard delete, no row removal).
  // Live views already filter on !archived, so the archived row disappears from the UI.
  deleteLead: (id) => {
    get().archiveLead(id);
  },
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/leads-slice.test.ts
```

Expected: `Tests <n> passed`, including the seven lifecycle cases.

- Step: commit.

```
git add lib/store/slices/leads-slice.ts lib/store/slices/leads-slice.test.ts
git commit -m "feat: persist moveLeadStage/archive/restore/delete via existing endpoints

moveLeadStage folds into updateLead (display→enum + reconcile); archive/restore
hit v1.customers.archive/restore with rollback; deleteLead repoints to archive
(soft-delete only)."
```

---

### Task 5: New-Job modal `createEstimate` awaits a real customer create before attaching the evisit

The modal's `createEstimate` (`new-job-modal.tsx:186-226`) currently calls the
store-only `addLead` and immediately `updateLead(lead.id, { evisits })` — but after
Task 3, `addLead`'s id is server-assigned and the evisit must attach to the
**reconciled** id. Make `createEstimate` await `persisted` before patching, and adopt
the reconciled id. `createJob` (which uses `addJob`, unchanged in Phase 1) is not
touched here.

**Files:**
- Modify: `components/modals/new-job-modal.tsx`
  - `createEstimate` (L186-226) → async
  - `commit` (L257-268) → returns a promise / awaits estimate
  - `handleSubmit` (L270-273) and `handleBuildPrice` (L275-281) → await `commit`
- Test: `components/modals/new-job-modal.test.tsx` (new file — the createEstimate
  path with a mocked store)

**Interfaces:**
- Consumes: `addLead(draft): { lead; persisted: Promise<Lead> }` (Task 3),
  `updateLead(id, patch)` (existing), `matchLead` (existing local).
- Produces: an evisit reliably attached to the persisted lead's server id.

- Step: write the failing test.

```tsx
// components/modals/new-job-modal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";

// Store actions captured so the test can assert ordering (create → then evisit patch).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  useLeads: () => [],
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit }),
}));

describe("NewJobModalContent — createEstimate", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
  });

  it("awaits the persisted lead, then attaches the evisit to the SERVER id", async () => {
    // addLead returns an optimistic id but persists to a different server id.
    addLead.mockReturnValue({
      lead: { id: "optimistic-1", name: "New customer", evisits: [] },
      persisted: Promise.resolve({ id: "srv-1", name: "New customer", evisits: [] }),
    });

    render(<NewJobModalContent />);
    // Fill "What's the job?" and pick the Estimate type.
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    expect(addLead).toHaveBeenCalledOnce();
    // The evisit patch must land on the reconciled server id, not the optimistic one.
    await waitFor(() => {
      expect(updateLead).toHaveBeenCalledOnce();
    });
    const [id, patch] = updateLead.mock.calls[0] as [string, { evisits: unknown[] }];
    expect(id).toBe("srv-1");
    expect(patch.evisits).toHaveLength(1);
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run components/modals/new-job-modal.test.tsx
```

Expected: fails — current `createEstimate` calls `updateLead("optimistic-1", ...)`
synchronously (no await), so `id` is `"optimistic-1"`, not `"srv-1"`. (Also
`addLead.mockReturnValue` returns `{ lead, persisted }`, and the current code does
`const lead = match ?? addLead(...)` then reads `lead.evisits` on the wrapper — the
assertion on the reconciled id fails.)

- Step: minimal implementation — in `components/modals/new-job-modal.tsx`.

Rewrite `createEstimate` (L186-226) to async + await the persisted lead:

```ts
  async function createEstimate(job: string) {
    const rows = resolvedVisits();
    const custName = customer.trim();
    const match = matchLead(custName);

    // Resolve the matched lead, or create a new one and AWAIT the server id.
    // addLead returns { lead, persisted }; the evisit must attach to the
    // reconciled (server-assigned) id, so we await before patching.
    let lead: Lead;
    if (match) {
      lead = match;
    } else {
      const { persisted } = addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      });
      lead = await persisted;
    }

    const existing = lead.evisits ?? [];
    const patch: Partial<Lead> = {
      job,
      evisits: [
        ...existing,
        ...rows.map<Visit>((v) => ({
          id: crypto.randomUUID(),
          date: null,
          techId: null,
          start: null,
          dur: v.h,
          status: "scheduled",
        })),
      ],
    };
    if (phone.trim() && (!lead.phone || lead.phone === "—")) patch.phone = phone.trim();
    if (addr.trim() && !lead.address) patch.address = addr.trim();
    if (notes.trim()) patch.notes = notes.trim();

    updateLead(lead.id, patch);
  }
```

Change `commit` (L257-268) so the estimate path is awaited:

```ts
  /** Validate + create the job/estimate. For estimates the create is async
   *  (awaits the persisted lead before attaching the evisit); returns a promise
   *  resolving to { ok, job }. */
  async function commit(): Promise<{ ok: boolean; job: Job | null }> {
    const job = title.trim();
    if (!job) {
      setError("Add what the job is.");
      return { ok: false, job: null };
    }
    if (njType === "estimate") {
      await createEstimate(job);
      return { ok: true, job: null };
    }
    return { ok: true, job: createJob(job) };
  }
```

Update `handleSubmit` (L270-273) and `handleBuildPrice` (L275-281):

```ts
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if ((await commit()).ok) close();
  }

  async function handleBuildPrice() {
    const { ok, job } = await commit();
    if (!ok) return;
    close();
    if (job) openModal(MODAL.PRICE_BUILDER, { jobId: job.id });
  }
```

- Step: run it, expected PASS.

```
npx vitest run components/modals/new-job-modal.test.tsx
```

Expected: `Tests 1 passed` — `updateLead` called with `"srv-1"` and one evisit.

- Step: commit.

```
git add components/modals/new-job-modal.tsx components/modals/new-job-modal.test.tsx
git commit -m "fix: new-job estimate awaits persisted lead before attaching evisit

addLead now returns a server-assigned id; createEstimate awaits { persisted }
and attaches the evisit to the reconciled id so a manually-created estimate
customer survives refresh with its scoping visit intact."
```

---

### Task 6: Verify the full gate + open the PR

Run every gate command against the whole repo, confirm each is green, then open the
Phase 1 PR.

**Files:** none (verification + PR only).

**Interfaces:** consumes all Phase 1 changes; produces a merged-ready PR.

- Step: typecheck the whole repo.

```
npx tsc --noEmit
```

Expected: no output, exit 0. (Watch specifically for callers of `addLead`'s new
return shape — `composer/page.tsx:1517` reads `const lead = addLead(...)` then
`lead.id`. That now returns `{ lead, persisted }`, so `lead.id` is `undefined`. Fix
that caller in this task, since it is surfaced by the typecheck.)

- Step: fix the `composer/page.tsx` caller surfaced by tsc (L1517-1524):

```ts
    const { lead } = addLead({
      name,
      phone: "—",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    update({ leadId: lead.id, custQuery: "" });
```

Re-run:

```
npx tsc --noEmit
```

Expected: exit 0.

- Step: lint (0 errors).

```
npm run lint
```

Expected: exit 0, `0 errors`. (New `console.error` calls are inside
`if (process.env.NODE_ENV !== "production")` with the existing
`// eslint-disable-next-line no-console` pattern used elsewhere in the slice.)

- Step: full unit + integration suites.

```
npx vitest run
npm run test:int
```

Expected: both `Test Files … passed`, `0 failed`. (Phase 1 adds no backend, so
`test:int` should be unchanged from `main`; run it to prove no regression.)

- Step: coverage gate.

```
npm run coverage
```

Expected: exit 0, thresholds `lines 80 / functions 80 / statements 80 /
branches 75` all met. (Coverage `include` is `shared/** · modules/** · platform/**`
— Phase 1 changed none of those, so the measured coverage is identical to `main`
and the gate holds.)

- Step: production build.

```
npm run build
```

Expected: `✓ Compiled successfully`, exit 0.

- Step: push and open the PR.

```
git push -u origin phase-1-lead-quick-wins
gh pr create --title "Phase 1: Lead quick-wins (persist existing lead actions)" --body "$(cat <<'EOF'
## Summary
Wires the store-only lead actions to the tRPC endpoints that already exist —
`v1.customers.{create,update,archive,restore}` — using the proven
optimistic → persist → reconcile/rollback pattern (mirrors addTask/addCompany).
No schema, no migration, no new router.

- addLead persists via v1.customers.create; adopts the server-assigned id
  (dedupe-safe) and returns { lead, persisted } for FK-dependent callers.
- moveLeadStage folds into updateLead (persists the stage); archiveLead/
  restoreLead hit archive/restore; deleteLead repoints to archive (soft-delete).
- Added a bidirectional store-display ↔ DB-enum stage mapper so persisting a
  stage no longer 400s on the enum mismatch; the LeadsHydrator + reconcile paths
  translate enum → display for a consistent store vocabulary.
- New-Job modal's createEstimate awaits the persisted lead before attaching the
  evisit, so a manually-created estimate customer survives refresh.

## Test plan
- [x] `npx tsc --noEmit`
- [x] `npm run lint` (0 errors)
- [x] `npx vitest run` (unit) + `npm run test:int` (integration)
- [x] `npm run coverage` (80/75 thresholds met)
- [x] `npm run build`
- [ ] Manual: add a lead in the New-Job estimate flow, refresh — the lead + its
      scoping evisit persist; move its stage, archive, restore — all survive refresh.
EOF
)"
```

Expected: PR URL printed; CI green on the pushed branch.

- Step: request an adversarial review (per the spec's per-phase requirement).

Use the **code-reviewer** and **typescript-reviewer** agents on the diff
(`git diff main...HEAD`); address any CRITICAL/HIGH findings before merge, focusing
on: the id-adoption reconcile in `addLead` (no orphaned optimistic rows), the
`moveLeadStage` → `updateLead` delegation not double-persisting, and the async
`createEstimate` not racing the modal `close()`.


## Phase 2: Settings backend

New persistence for org configuration. Introduces a `modules/settings/` hexagonal module
(mirroring `modules/companies/`) plus five org-scoped tables — `org_settings` (one row per
org), `pricebook_items`, `labor_rates`, `job_terms`, `lead_sources`. Exposes `v1.settings`
with `get` (lazily creates the defaults row on first read and returns it plus all four
collections in one payload), `updateConfig` (scalars + booking jsonb), and per-collection
`create/update/remove`. Adds a `SettingsHydrator` and switches every `settings-slice` action
to the optimistic → persist → reconcile/rollback pattern, deleting the `SEED_*` source-of-truth
and the module-level id counter (`_nextLaborId`).

Money in cents, rates in bps, durations in minutes (integer). Every table carries `org_id`
(FK → `orgs`, `onDelete: cascade`) with hand-written RLS via `current_org_id()`; the removable
collections (`pricebook_items`, `job_terms`, `lead_sources`) soft-delete via `deleted_at`.
`labor_rates` keeps a "≥1 rate" invariant so it does not soft-delete its last row — it hard-
excludes via `deleted_at` too for consistency but the use-case guards the count.

**CONSUMES (from earlier phases / existing code):**
- `orgs` table — `shared/db/schema/orgs.ts` (FK target).
- `ownerOrOffice` procedure — `@/trpc/init` (`publicProcedure.use(requireAuth).use(requireRole(["owner","office"])).use(orgTx)`); ctx gives `ctx.tx: TenantTx`, `ctx.principal.orgId: OrgId`, `ctx.deps.clock: Clock`, `ctx.deps.ids: IdGenerator`.
- `orThrow(result)` — `@/trpc/errors`.
- Result helpers — `@mallet/shared/types`: `ok`, `err`, `validation`, `notFound`, `Result`, `AppError`, `Clock`, `FixedClock`, `systemClock`, `asOrgId`, `isOk`.
- `IdGenerator`, `uuidGenerator`, `InMemoryEventBus` — `@mallet/shared/ports`.
- `TenantTx`, `withTenant` — `@mallet/shared/db/tx`; `closeDb` — `@mallet/shared/db/client`.
- Hydrator plumbing — `lib/store/use-store-hydrator.ts` (`useStoreHydrator`), `lib/store/hydrator-config.ts` (`HYDRATOR_STALE_MS`, `HYDRATOR_PAGE_LIMIT`), `@/lib/trpc/client` (`api`, `RouterOutputs`), `@/lib/trpc/vanilla` (`trpcVanilla`).
- Store composition — `lib/store/app-store.ts` (`useAppStore`, `AppStore`), `lib/store/slices/settings-slice.ts`.

**PRODUCES (later phases rely on these exact names):**
- Tables/columns:
  - `org_settings(id, org_id, trade, markup_bps, visit_scope_minutes, visit_repair_minutes, visit_install_minutes, tech_sees_price, tech_texts, front_desk, scope_on, hours_wd_open, hours_wd_close, hours_sat_open, hours_sat_close, hours_sun_open, hours_sun_close, area_cities, area_radius_mi, booking jsonb, created_at, updated_at)` — Phase 3 adds `brand_*` columns here.
  - `pricebook_items(id, org_id, label, unit_price_cents, cost_cents, position, created_at, updated_at, deleted_at)`
  - `labor_rates(id, org_id, label, rate_cents_per_hour, position, created_at, updated_at, deleted_at)`
  - `job_terms(id, org_id, title, body, position, created_at, updated_at, deleted_at)`
  - `lead_sources(id, org_id, label, position, created_at, updated_at, deleted_at)`
- Module barrel `@mallet/settings` exporting `createSettingsRouter`, `OrgSettings`, `OrgSettingsProps`, use-cases, `DrizzleSettingsRepository`, `SettingsRepository`.
- Router `v1.settings.{get, updateConfig, pricebook.{create,update,remove}, laborRates.{create,update,remove}, terms.{create,update,remove}, sources.{create,update,remove}}`.
- `SettingsHydrator` (`features/settings/settings-hydrator.tsx`).
- Persisting `settings-slice` (server ids; no `_nextLaborId`; no `SEED_*`).

---

### Task 1: Schema — `org_settings` + four child tables

**Files:**
- Create `shared/db/schema/org-settings.ts`
- Create `shared/db/schema/pricebook-items.ts`
- Create `shared/db/schema/labor-rates.ts`
- Create `shared/db/schema/job-terms.ts`
- Create `shared/db/schema/lead-sources.ts`
- Modify `shared/db/schema/index.ts` (add 5 `export *` lines after `./messages`)

**Interfaces:**
- Consumes: `orgs` from `./orgs`.
- Produces: five Drizzle `pgTable`s; row types `typeof orgSettings.$inferSelect` etc. consumed by mappers in Task 5–6.

- Step: write `shared/db/schema/org-settings.ts`:

```typescript
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One row per org. Scalars are typed columns (money in cents, rates in bps, durations in integer
// minutes); the AI Front Desk booking playbook is a nested blob → jsonb. RLS isolates by org_id
// (hand-written migration). The composite unique(org_id, id) supports future child FKs; unique(org_id)
// enforces the one-row-per-org invariant and is the lazy-create upsert conflict target.
export const orgSettings = pgTable(
  "org_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    trade: text("trade").notNull().default("plumbing"),
    markupBps: integer("markup_bps").notNull().default(3500),
    visitScopeMinutes: integer("visit_scope_minutes").notNull().default(30),
    visitRepairMinutes: integer("visit_repair_minutes").notNull().default(90),
    visitInstallMinutes: integer("visit_install_minutes").notNull().default(240),
    techSeesPrice: boolean("tech_sees_price").notNull().default(true),
    techTexts: boolean("tech_texts").notNull().default(true),
    frontDesk: boolean("front_desk").notNull().default(true),
    scopeOn: boolean("scope_on").notNull().default(false),
    hoursWdOpen: integer("hours_wd_open").notNull().default(8),
    hoursWdClose: integer("hours_wd_close").notNull().default(17),
    hoursSatOpen: integer("hours_sat_open").notNull().default(0),
    hoursSatClose: integer("hours_sat_close").notNull().default(0),
    hoursSunOpen: integer("hours_sun_open").notNull().default(0),
    hoursSunClose: integer("hours_sun_close").notNull().default(0),
    areaCities: text("area_cities").notNull().default(""),
    areaRadiusMi: integer("area_radius_mi").notNull().default(25),
    // { services: {name,lane,price?,triggers}[], notServices: string, serviceFee: number,
    //   feeCredited: boolean } — the booking playbook. serviceFee is DOLLARS here (matches the
    //   prototype control), unlike money columns; documented so no one reads it as cents.
    booking: jsonb("booking").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("org_settings_org_id_uq").on(t.orgId),
    unique("org_settings_org_id_row_uq").on(t.orgId, t.id),
  ],
);
```

- Step: write `shared/db/schema/pricebook-items.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A pricebook line. unit_price_cents = customer-facing price; cost_cents = internal cost (techs
// never see it). Ordered by position for a stable settings list. Soft-delete via deleted_at.
export const pricebookItems = pgTable(
  "pricebook_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("pricebook_items_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
```

- Step: write `shared/db/schema/labor-rates.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A named labor rate. rate_cents_per_hour is integer cents/hr. Soft-delete via deleted_at; the
// use-case guards a "≥1 active rate" invariant (matches the prototype).
export const laborRates = pgTable(
  "labor_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    rateCentsPerHour: integer("rate_cents_per_hour").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("labor_rates_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
```

- Step: write `shared/db/schema/job-terms.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A reusable terms/fine-print entry for quotes. title + body free text, ordered. Soft-delete.
export const jobTerms = pgTable(
  "job_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("job_terms_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
```

- Step: write `shared/db/schema/lead-sources.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A selectable lead-source label ("Google", "Referral", …). Ordered, soft-deleteable.
export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("lead_sources_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
```

- Step: edit `shared/db/schema/index.ts` — append after the `export * from "./messages";` line:

```typescript
export * from "./org-settings";
export * from "./pricebook-items";
export * from "./labor-rates";
export * from "./job-terms";
export * from "./lead-sources";
```

- Step: typecheck the schema compiles (no test yet — schema is declarative):

```
npx tsc --noEmit
```

Expected: exits 0 (the new tables are referenced only by the barrel so far).

- Step: commit:

```
git checkout -b phase-2-settings-backend
git add shared/db/schema/org-settings.ts shared/db/schema/pricebook-items.ts shared/db/schema/labor-rates.ts shared/db/schema/job-terms.ts shared/db/schema/lead-sources.ts shared/db/schema/index.ts
git commit -m "feat: add org_settings + pricebook/labor/terms/sources schema"
```

---

### Task 2: Migration 0043 (generate) + hand-written RLS

**Files:**
- Create `shared/db/migrations/0043_<drizzle_name>.sql` (auto-generated DDL — filename minted by drizzle-kit)
- Create `shared/db/migrations/0044_settings_rls.sql` (hand-written)
- Modify `shared/db/migrations/meta/_journal.json` + snapshot (auto by drizzle-kit for 0043; 0044 hand-added to the journal via a second generate pass — see below)

> The spec says migrations number from 0044 upward. The last applied migration is `0042`.
> drizzle-kit will emit the DDL migration as `0043`; the hand-written RLS migration becomes
> `0044`. To keep `_journal.json` consistent we run generate for the DDL (0043), then create
> the RLS file (0044) as an **empty** custom migration via `drizzle-kit generate --custom`,
> and paste the RLS SQL into it. This is the exact two-step the repo used for
> `0037_even_kate_bishop.sql` (DDL) + `0038_companies_rls.sql` (RLS).

- Step: generate the DDL migration:

```
npm run db:generate
```

Expected: creates `shared/db/migrations/0043_<random_name>.sql` containing `CREATE TABLE "org_settings" …`, `CREATE TABLE "pricebook_items" …`, `CREATE TABLE "labor_rates" …`, `CREATE TABLE "job_terms" …`, `CREATE TABLE "lead_sources" …`, the FK constraints to `orgs`, the unique constraints (`org_settings_org_id_uq`, `org_settings_org_id_row_uq`) and the four `*_org_deleted_idx` indexes; updates `meta/_journal.json` + snapshot. Prints `[✓] Your SQL migration file ➜ shared/db/migrations/0043_….sql`.

- Step: create the empty custom RLS migration:

```
npx drizzle-kit generate --custom --name settings_rls
```

Expected: creates `shared/db/migrations/0044_settings_rls.sql` (empty body) and appends a journal entry.

- Step: write the RLS policies into `shared/db/migrations/0044_settings_rls.sql` (copying the exact syntax from `0038_companies_rls.sql`):

```sql
-- Tenant isolation for the settings tables. Same model as companies (0038) and tasks (0028):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Each table carries its own org_id (stamped on insert / lazily
-- created), so the runtime role (NOBYPASSRLS) can never address another tenant's settings.

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_settings_tenant_isolation ON public.org_settings
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.pricebook_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pricebook_items_tenant_isolation ON public.pricebook_items
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.labor_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY labor_rates_tenant_isolation ON public.labor_rates
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.job_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_terms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_terms_tenant_isolation ON public.job_terms
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lead_sources_tenant_isolation ON public.lead_sources
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
```

- Step: apply the migrations to the test DB:

```
npm run db:migrate
```

Expected: applies `0043_…` then `0044_settings_rls` with no error; prints the applied migration names.

- Step: prove RLS blocks the runtime role on the new tables:

```
npm run db:rls-proof
```

Expected: exits 0 — the proof script asserts every RLS-enabled table (now incl. the five settings tables) denies cross-org reads for the `mallet_app` role.

- Step: commit:

```
git add shared/db/migrations/
git commit -m "feat: migrate settings tables with tenant RLS"
```

---

### Task 3: Domain — `OrgSettings` aggregate + `SettingsRepository`

**Files:**
- Create `modules/settings/domain/org-settings.ts`
- Create `modules/settings/domain/org-settings.test.ts`
- Create `modules/settings/domain/settings-repository.ts`

**Interfaces:**
- Consumes: `Result`, `ValidationError`, `validation`, `ok`, `err`, `OrgId` — `@mallet/shared/types`.
- Produces: `OrgSettings` class (`create`, `patch`, `props`), `OrgSettingsProps`, `BookingCfg`, `SettingsRepository` interface with `getConfig`, `saveConfig`, `listPricebook/createPricebook/savePricebook/archivePricebook`, and the analogous methods for labor/terms/sources.

- Step: write the failing test `modules/settings/domain/org-settings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { asOrgId, isOk } from "@mallet/shared/types";
import { OrgSettings, type OrgSettingsProps, type BookingCfg } from "./org-settings";

const booking: BookingCfg = {
  services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
  notServices: "septic",
  serviceFee: 89,
  feeCredited: true,
};

const baseProps = (overrides: Partial<OrgSettingsProps> = {}): OrgSettingsProps => ({
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  trade: "plumbing",
  markupBps: 3500,
  visitScopeMinutes: 30,
  visitRepairMinutes: 90,
  visitInstallMinutes: 240,
  techSeesPrice: true,
  techTexts: true,
  frontDesk: true,
  scopeOn: false,
  hoursWdOpen: 8,
  hoursWdClose: 17,
  hoursSatOpen: 0,
  hoursSatClose: 0,
  hoursSunOpen: 0,
  hoursSunClose: 0,
  areaCities: "Pleasanton",
  areaRadiusMi: 25,
  booking,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof OrgSettings.create>): OrgSettings => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("OrgSettings.create", () => {
  it("rejects an empty trade", () => {
    const r = OrgSettings.create(baseProps({ trade: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("trade");
  });

  it("rejects a negative markup", () => {
    const r = OrgSettings.create(baseProps({ markupBps: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("markupBps");
  });

  it("clamps visit minutes to a 15-minute floor", () => {
    const s = unwrap(OrgSettings.create(baseProps({ visitScopeMinutes: 5 })));
    expect(s.props.visitScopeMinutes).toBe(15);
  });

  it("accepts a valid config", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    expect(s.props.trade).toBe("plumbing");
    expect(s.props.markupBps).toBe(3500);
    expect(s.props.booking.services).toHaveLength(1);
  });
});

describe("OrgSettings.patch", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("patches scalars and bumps updatedAt; undefined fields are unchanged", () => {
    const s = unwrap(OrgSettings.create(baseProps({ markupBps: 3500, trade: "plumbing" })));
    const r = s.patch({ markupBps: 4000 }, now);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.markupBps).toBe(4000);
      expect(r.value.props.trade).toBe("plumbing");
      expect(r.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("replaces the booking blob when provided", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    const r = s.patch({ booking: { ...booking, serviceFee: 120 } }, now);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.booking.serviceFee).toBe(120);
  });

  it("re-validates: patching markup negative fails", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    const r = s.patch({ markupBps: -5 }, now);
    expect(isOk(r)).toBe(false);
  });
});
```

- Step: run it, expected FAIL (module does not exist yet):

```
npx vitest run modules/settings/domain/org-settings.test.ts
```

Expected: `Error: Failed to load … org-settings` / "Cannot find module './org-settings'".

- Step: write `modules/settings/domain/org-settings.ts`:

```typescript
import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type ServiceLane = "repair" | "estimate" | "flat";

export interface BookingService {
  readonly name: string;
  readonly lane: ServiceLane;
  readonly price?: number;
  readonly triggers: string;
}

export interface BookingCfg {
  readonly services: BookingService[];
  readonly notServices: string;
  readonly serviceFee: number;
  readonly feeCredited: boolean;
}

export interface OrgSettingsProps {
  readonly orgId: OrgId;
  readonly trade: string;
  readonly markupBps: number;
  readonly visitScopeMinutes: number;
  readonly visitRepairMinutes: number;
  readonly visitInstallMinutes: number;
  readonly techSeesPrice: boolean;
  readonly techTexts: boolean;
  readonly frontDesk: boolean;
  readonly scopeOn: boolean;
  readonly hoursWdOpen: number;
  readonly hoursWdClose: number;
  readonly hoursSatOpen: number;
  readonly hoursSatClose: number;
  readonly hoursSunOpen: number;
  readonly hoursSunClose: number;
  readonly areaCities: string;
  readonly areaRadiusMi: number;
  readonly booking: BookingCfg;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const VISIT_FLOOR = 15;
const clampMinutes = (n: number): number => Math.max(VISIT_FLOOR, Math.round(Number.isFinite(n) ? n : 0));
const clampHour = (n: number): number => Math.min(24, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

// Org configuration aggregate. Mutations return a new OrgSettings; the factory enforces invariants.
export class OrgSettings {
  private constructor(private readonly p: OrgSettingsProps) {}

  static create(props: OrgSettingsProps): Result<OrgSettings, ValidationError> {
    const trade = props.trade.trim();
    if (trade.length === 0) return err(validation("trade is required", "trade"));
    if (props.markupBps < 0) return err(validation("markup must be non-negative", "markupBps"));
    if (props.areaRadiusMi < 0) return err(validation("radius must be non-negative", "areaRadiusMi"));
    return ok(
      new OrgSettings({
        ...props,
        trade,
        visitScopeMinutes: clampMinutes(props.visitScopeMinutes),
        visitRepairMinutes: clampMinutes(props.visitRepairMinutes),
        visitInstallMinutes: clampMinutes(props.visitInstallMinutes),
        hoursWdOpen: clampHour(props.hoursWdOpen),
        hoursWdClose: clampHour(props.hoursWdClose),
        hoursSatOpen: clampHour(props.hoursSatOpen),
        hoursSatClose: clampHour(props.hoursSatClose),
        hoursSunOpen: clampHour(props.hoursSunOpen),
        hoursSunClose: clampHour(props.hoursSunClose),
        areaRadiusMi: Math.max(0, Math.round(props.areaRadiusMi)),
      }),
    );
  }

  patch(
    fields: Partial<Omit<OrgSettingsProps, "orgId" | "createdAt" | "updatedAt">>,
    now: Date,
  ): Result<OrgSettings, ValidationError> {
    const pick = <K extends keyof OrgSettingsProps>(k: K): OrgSettingsProps[K] =>
      fields[k as keyof typeof fields] !== undefined
        ? (fields[k as keyof typeof fields] as OrgSettingsProps[K])
        : this.p[k];
    return OrgSettings.create({
      ...this.p,
      trade: pick("trade"),
      markupBps: pick("markupBps"),
      visitScopeMinutes: pick("visitScopeMinutes"),
      visitRepairMinutes: pick("visitRepairMinutes"),
      visitInstallMinutes: pick("visitInstallMinutes"),
      techSeesPrice: pick("techSeesPrice"),
      techTexts: pick("techTexts"),
      frontDesk: pick("frontDesk"),
      scopeOn: pick("scopeOn"),
      hoursWdOpen: pick("hoursWdOpen"),
      hoursWdClose: pick("hoursWdClose"),
      hoursSatOpen: pick("hoursSatOpen"),
      hoursSatClose: pick("hoursSatClose"),
      hoursSunOpen: pick("hoursSunOpen"),
      hoursSunClose: pick("hoursSunClose"),
      areaCities: pick("areaCities"),
      areaRadiusMi: pick("areaRadiusMi"),
      booking: pick("booking"),
      updatedAt: now,
    });
  }

  get props(): OrgSettingsProps {
    return this.p;
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/domain/org-settings.test.ts
```

Expected: all `OrgSettings.create` + `OrgSettings.patch` tests green.

- Step: write `modules/settings/domain/settings-repository.ts`:

```typescript
import type { OrgSettings, BookingCfg } from "./org-settings";

// Value shapes for the collections — plain rows, not full aggregates (no per-row invariants beyond
// a non-empty label enforced in the use-case). Money in cents; positions are integers.
export interface PricebookItem {
  readonly id: string;
  readonly label: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly position: number;
}
export interface LaborRate {
  readonly id: string;
  readonly label: string;
  readonly rateCentsPerHour: number;
  readonly position: number;
}
export interface JobTerm {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly position: number;
}
export interface LeadSource {
  readonly id: string;
  readonly label: string;
  readonly position: number;
}

// The org is NEVER a parameter — implicit in the org-scoped transaction the repository holds.
export interface SettingsRepository {
  // org_settings — lazily created on first read with the provided defaults.
  getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings>;
  saveConfig(settings: OrgSettings): Promise<void>;

  listPricebook(): Promise<PricebookItem[]>;
  createPricebook(input: { id: string; orgId: string; label: string; unitPriceCents: number; costCents: number; position: number }): Promise<PricebookItem>;
  savePricebook(item: PricebookItem): Promise<number>;
  archivePricebook(id: string, now: Date): Promise<number>;

  listLaborRates(): Promise<LaborRate[]>;
  createLaborRate(input: { id: string; orgId: string; label: string; rateCentsPerHour: number; position: number }): Promise<LaborRate>;
  saveLaborRate(rate: LaborRate): Promise<number>;
  countActiveLaborRates(): Promise<number>;
  archiveLaborRate(id: string, now: Date): Promise<number>;

  listTerms(): Promise<JobTerm[]>;
  createTerm(input: { id: string; orgId: string; title: string; body: string; position: number }): Promise<JobTerm>;
  saveTerm(term: JobTerm): Promise<number>;
  archiveTerm(id: string, now: Date): Promise<number>;

  listSources(): Promise<LeadSource[]>;
  createSource(input: { id: string; orgId: string; label: string; position: number }): Promise<LeadSource>;
  saveSource(source: LeadSource): Promise<number>;
  archiveSource(id: string, now: Date): Promise<number>;
}
```

- Step: run the domain test again + typecheck the repo interface:

```
npx vitest run modules/settings/domain/ && npx tsc --noEmit
```

Expected: domain tests green; typecheck 0 errors.

- Step: commit:

```
git add modules/settings/domain/
git commit -m "feat: settings domain aggregate + repository interface"
```

---

### Task 4: App — use-cases (`GetSettings`, `UpdateConfig`, collection create/update/remove)

**Files:**
- Create `modules/settings/app/get-settings.ts` + `modules/settings/app/get-settings.test.ts`
- Create `modules/settings/app/update-config.ts` + `modules/settings/app/update-config.test.ts`
- Create `modules/settings/app/pricebook.ts` + `modules/settings/app/pricebook.test.ts`
- Create `modules/settings/app/labor-rates.ts` + `modules/settings/app/labor-rates.test.ts`
- Create `modules/settings/app/terms.ts` + `modules/settings/app/terms.test.ts`
- Create `modules/settings/app/sources.ts` + `modules/settings/app/sources.test.ts`
- Create `modules/settings/app/default-booking.ts` (shared default blob)

**Interfaces:**
- Consumes: `SettingsRepository`, `OrgSettings`, `BookingCfg`, `PricebookItem`, `LaborRate`, `JobTerm`, `LeadSource` (Task 3); `Clock`, `IdGenerator`, `Result`, `AppError`, `validation`, `notFound`, `ok`, `err`, `conflict`; `logger` from `@mallet/shared/observability`.
- Produces: `GetSettingsUseCase.exec(orgId) → Result<{ config, pricebook, laborRates, terms, sources }, AppError>`; `UpdateConfigUseCase.exec(cmd, orgId)`; `Create/Update/RemovePricebookUseCase`; `…LaborRate…` (with the ≥1 guard on remove); `…Term…`; `…Source…`.

- Step: write `modules/settings/app/default-booking.ts` (the sane first-run defaults, ported verbatim from `SEED_BOOKING` in `settings-slice.ts`):

```typescript
import type { BookingCfg } from "../domain/org-settings";

// First-run defaults for a brand-new org. Ported verbatim from the prototype's SEED_BOOKING so a
// fresh workspace opens with a usable booking playbook rather than an empty screen.
export const defaultBooking = (): BookingCfg => ({
  services: [
    { name: "Water heater repair", lane: "repair", triggers: "leaking, no hot water, pilot out, rusty water, water heater not working" },
    { name: "Water heater replacement", lane: "estimate", triggers: "replace water heater, new water heater, tankless install, old one died" },
    { name: "AC / heating repair", lane: "repair", triggers: "not cooling, warm air, no heat, ac stopped, furnace, no power" },
    { name: "AC / system replacement", lane: "estimate", triggers: "replace my whole, new system, replace my ac, new ac unit" },
    { name: "Drain cleaning", lane: "flat", price: 99, triggers: "drain cleaning, clogged, slow drain, backed up, snake" },
    { name: "Sewer camera inspection", lane: "flat", price: 285, triggers: "sewer camera, camera inspection, locate the line" },
    { name: "Leak detection & repair", lane: "repair", triggers: "leak, dripping, water damage" },
    { name: "Toilet & fixture install", lane: "repair", triggers: "running toilet, leaking toilet, wont flush, faucet" },
    { name: "Whole-house repipe / re-pipe", lane: "estimate", triggers: "repipe, re-pipe, galvanized, whole house repipe, low pressure everywhere, old pipes" },
  ],
  notServices: "New construction · septic · well pumps",
  serviceFee: 89,
  feeCredited: true,
});
```

- Step: write the failing test `modules/settings/app/get-settings.test.ts` (with an in-file `FakeSettingsRepository` shared by all app tests via copy — mirrors `FakeCompanyRepository`):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { OrgSettings, type BookingCfg } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
} from "../domain/settings-repository";
import { GetSettingsUseCase } from "./get-settings";
import { defaultBooking } from "./default-booking";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

export class FakeSettingsRepository implements SettingsRepository {
  config: OrgSettings | null = null;
  pricebook: PricebookItem[] = [];
  laborRates: LaborRate[] = [];
  terms: JobTerm[] = [];
  sources: LeadSource[] = [];

  async getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings> {
    if (this.config) return this.config;
    const r = OrgSettings.create({
      orgId: asOrgId(orgId), trade: "plumbing", markupBps: 3500,
      visitScopeMinutes: 30, visitRepairMinutes: 90, visitInstallMinutes: 240,
      techSeesPrice: true, techTexts: true, frontDesk: true, scopeOn: false,
      hoursWdOpen: 8, hoursWdClose: 17, hoursSatOpen: 0, hoursSatClose: 0,
      hoursSunOpen: 0, hoursSunClose: 0, areaCities: "", areaRadiusMi: 25,
      booking: defaults(), createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error("seed config invalid");
    this.config = r.value;
    return this.config;
  }
  async saveConfig(s: OrgSettings): Promise<void> { this.config = s; }

  async listPricebook() { return this.pricebook; }
  async createPricebook(i: { id: string; label: string; unitPriceCents: number; costCents: number; position: number }) {
    const row = { id: i.id, label: i.label, unitPriceCents: i.unitPriceCents, costCents: i.costCents, position: i.position };
    this.pricebook = [...this.pricebook, row]; return row;
  }
  async savePricebook(item: PricebookItem) {
    const before = this.pricebook.length;
    this.pricebook = this.pricebook.map((p) => (p.id === item.id ? item : p));
    return this.pricebook.some((p) => p.id === item.id) ? 1 : before - this.pricebook.length;
  }
  async archivePricebook(id: string) {
    const before = this.pricebook.length; this.pricebook = this.pricebook.filter((p) => p.id !== id);
    return before - this.pricebook.length;
  }

  async listLaborRates() { return this.laborRates; }
  async createLaborRate(i: { id: string; label: string; rateCentsPerHour: number; position: number }) {
    const row = { id: i.id, label: i.label, rateCentsPerHour: i.rateCentsPerHour, position: i.position };
    this.laborRates = [...this.laborRates, row]; return row;
  }
  async saveLaborRate(r: LaborRate) { this.laborRates = this.laborRates.map((x) => (x.id === r.id ? r : x)); return this.laborRates.some((x) => x.id === r.id) ? 1 : 0; }
  async countActiveLaborRates() { return this.laborRates.length; }
  async archiveLaborRate(id: string) { const b = this.laborRates.length; this.laborRates = this.laborRates.filter((x) => x.id !== id); return b - this.laborRates.length; }

  async listTerms() { return this.terms; }
  async createTerm(i: { id: string; title: string; body: string; position: number }) { const row = { id: i.id, title: i.title, body: i.body, position: i.position }; this.terms = [...this.terms, row]; return row; }
  async saveTerm(t: JobTerm) { this.terms = this.terms.map((x) => (x.id === t.id ? t : x)); return this.terms.some((x) => x.id === t.id) ? 1 : 0; }
  async archiveTerm(id: string) { const b = this.terms.length; this.terms = this.terms.filter((x) => x.id !== id); return b - this.terms.length; }

  async listSources() { return this.sources; }
  async createSource(i: { id: string; label: string; position: number }) { const row = { id: i.id, label: i.label, position: i.position }; this.sources = [...this.sources, row]; return row; }
  async saveSource(s: LeadSource) { this.sources = this.sources.map((x) => (x.id === s.id ? s : x)); return this.sources.some((x) => x.id === s.id) ? 1 : 0; }
  async archiveSource(id: string) { const b = this.sources.length; this.sources = this.sources.filter((x) => x.id !== id); return b - this.sources.length; }
}

describe("GetSettingsUseCase", () => {
  let repo: FakeSettingsRepository;
  let useCase: GetSettingsUseCase;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    useCase = new GetSettingsUseCase(repo);
  });

  it("lazily creates a defaults config on first read", async () => {
    const result = await useCase.exec(ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.config.props.trade).toBe("plumbing");
      expect(result.value.config.props.booking.services.length).toBeGreaterThan(0);
    }
  });

  it("returns all four collections in the payload", async () => {
    await repo.createPricebook({ id: "p1", orgId: ORG, label: "Camera", unitPriceCents: 28500, costCents: 0, position: 0 });
    await repo.createSource({ id: "s1", orgId: ORG, label: "Google", position: 0 });
    const result = await useCase.exec(ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.pricebook).toHaveLength(1);
      expect(result.value.sources).toHaveLength(1);
      expect(result.value.laborRates).toEqual([]);
      expect(result.value.terms).toEqual([]);
    }
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/get-settings.test.ts
```

Expected: "Cannot find module './get-settings'".

- Step: write `modules/settings/app/get-settings.ts`:

```typescript
import type { Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { OrgSettings } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
} from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

export interface SettingsSnapshot {
  readonly config: OrgSettings;
  readonly pricebook: PricebookItem[];
  readonly laborRates: LaborRate[];
  readonly terms: JobTerm[];
  readonly sources: LeadSource[];
}

// Read use-case: fetch (lazily creating) the org_settings row + all four collections in one call.
export class GetSettingsUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<SettingsSnapshot, AppError>> {
    const config = await this.repo.getConfig(orgId, defaultBooking);
    const [pricebook, laborRates, terms, sources] = await Promise.all([
      this.repo.listPricebook(),
      this.repo.listLaborRates(),
      this.repo.listTerms(),
      this.repo.listSources(),
    ]);
    return ok({ config, pricebook, laborRates, terms, sources });
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/app/get-settings.test.ts
```

Expected: both tests green.

- Step: write the failing test `modules/settings/app/update-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { GetSettingsUseCase } from "./get-settings";
import { UpdateConfigUseCase } from "./update-config";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

describe("UpdateConfigUseCase", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;
  let useCase: UpdateConfigUseCase;

  beforeEach(async () => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    useCase = new UpdateConfigUseCase(repo, clock);
    // ensure a row exists to patch
    await new GetSettingsUseCase(repo).exec(ORG);
  });

  it("patches markup and persists", async () => {
    const result = await useCase.exec({ markupBps: 4200 }, ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.markupBps).toBe(4200);
    expect(repo.config?.props.markupBps).toBe(4200);
  });

  it("patches the booking blob", async () => {
    const result = await useCase.exec(
      { booking: { services: [], notServices: "x", serviceFee: 120, feeCredited: false } },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.booking.serviceFee).toBe(120);
  });

  it("returns a validation error for negative markup and does not persist it", async () => {
    const result = await useCase.exec({ markupBps: -1 }, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") expect(result.error.field).toBe("markupBps");
    expect(repo.config?.props.markupBps).toBe(3500);
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/update-config.test.ts
```

Expected: "Cannot find module './update-config'".

- Step: write `modules/settings/app/update-config.ts`:

```typescript
import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OrgSettings, OrgSettingsProps } from "../domain/org-settings";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

export type UpdateConfigCommand = Partial<
  Omit<OrgSettingsProps, "orgId" | "createdAt" | "updatedAt">
>;

// Patch the scalar/jsonb config for an org. Lazily materialises the row first so an org that has
// never opened Settings can still save.
export class UpdateConfigUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateConfigCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.repo.getConfig(orgId, defaultBooking);
    const patched = current.patch(cmd, this.clock.now());
    if (!patched.ok) return patched;
    await this.repo.saveConfig(patched.value);
    logger.info({ orgId }, "settings.config.updated");
    return ok(patched.value);
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/app/update-config.test.ts
```

Expected: three tests green.

- Step: write the failing test `modules/settings/app/pricebook.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import {
  CreatePricebookUseCase, UpdatePricebookUseCase, RemovePricebookUseCase,
} from "./pricebook";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("Pricebook use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects an empty label", async () => {
    const uc = new CreatePricebookUseCase(repo, fixedIds("p1"));
    const r = await uc.exec({ label: "  ", unitPriceCents: 100, costCents: 0 }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: mints an id and appends", async () => {
    const uc = new CreatePricebookUseCase(repo, fixedIds("p1"));
    const r = await uc.exec({ label: "Camera", unitPriceCents: 28500, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.id).toBe("p1");
    expect(repo.pricebook).toHaveLength(1);
  });

  it("update: not-found returns NotFound", async () => {
    const uc = new UpdatePricebookUseCase(repo, clock);
    const r = await uc.exec({ id: "nope", label: "x" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("remove: archives an existing row", async () => {
    await repo.createPricebook({ id: "p1", orgId: ORG, label: "Camera", unitPriceCents: 1, costCents: 0, position: 0 });
    const uc = new RemovePricebookUseCase(repo, clock);
    const r = await uc.exec({ id: "p1" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.pricebook).toHaveLength(0);
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/pricebook.test.ts
```

Expected: "Cannot find module './pricebook'".

- Step: write `modules/settings/app/pricebook.ts`:

```typescript
import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PricebookItem, SettingsRepository } from "../domain/settings-repository";

export interface CreatePricebookCommand {
  readonly id?: string;
  readonly label: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly position?: number;
}

export class CreatePricebookUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly ids: IdGenerator) {}
  async exec(cmd: CreatePricebookCommand, orgId: string): Promise<Result<PricebookItem, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const item = await this.repo.createPricebook({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      label,
      unitPriceCents: Math.max(0, Math.round(cmd.unitPriceCents)),
      costCents: Math.max(0, Math.round(cmd.costCents)),
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: item.id }, "settings.pricebook.created");
    return ok(item);
  }
}

export interface UpdatePricebookCommand {
  readonly id: string;
  readonly label?: string;
  readonly unitPriceCents?: number;
  readonly costCents?: number;
  readonly position?: number;
}

export class UpdatePricebookUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: UpdatePricebookCommand, orgId: string): Promise<Result<PricebookItem, AppError>> {
    const existing = (await this.repo.listPricebook()).find((p) => p.id === cmd.id);
    if (!existing) return err(notFound("pricebook item not found"));
    if (cmd.label !== undefined && cmd.label.trim().length === 0) {
      return err(validation("label is required", "label"));
    }
    const next: PricebookItem = {
      id: existing.id,
      label: cmd.label !== undefined ? cmd.label.trim() : existing.label,
      unitPriceCents: cmd.unitPriceCents !== undefined ? Math.max(0, Math.round(cmd.unitPriceCents)) : existing.unitPriceCents,
      costCents: cmd.costCents !== undefined ? Math.max(0, Math.round(cmd.costCents)) : existing.costCents,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.savePricebook(next);
    if (count === 0) return err(notFound("pricebook item not found"));
    void this.clock.now();
    logger.info({ orgId, id: next.id }, "settings.pricebook.updated");
    return ok(next);
  }
}

export interface RemovePricebookCommand {
  readonly id: string;
}

export class RemovePricebookUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: RemovePricebookCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archivePricebook(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("pricebook item not found"));
    logger.info({ orgId, id: cmd.id }, "settings.pricebook.removed");
    return ok({ ok: true });
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/app/pricebook.test.ts
```

Expected: four tests green.

- Step: write the failing test `modules/settings/app/labor-rates.test.ts` (note the ≥1-rate guard on remove):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import {
  CreateLaborRateUseCase, UpdateLaborRateUseCase, RemoveLaborRateUseCase,
} from "./labor-rates";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("LaborRate use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
  });

  it("create: rejects empty label", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec({ label: " ", rateCentsPerHour: 17000 }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: appends with minted id", async () => {
    const uc = new CreateLaborRateUseCase(repo, fixedIds("l1"));
    const r = await uc.exec({ label: "Standard", rateCentsPerHour: 17000 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.rateCentsPerHour).toBe(17000);
  });

  it("remove: refuses to delete the last active rate (conflict)", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, position: 0 });
    const uc = new RemoveLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l1" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
    expect(repo.laborRates).toHaveLength(1);
  });

  it("remove: deletes when more than one remains", async () => {
    await repo.createLaborRate({ id: "l1", orgId: ORG, label: "Standard", rateCentsPerHour: 17000, position: 0 });
    await repo.createLaborRate({ id: "l2", orgId: ORG, label: "Emergency", rateCentsPerHour: 25500, position: 1 });
    const uc = new RemoveLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "l2" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.laborRates).toHaveLength(1);
  });

  it("update: not-found returns NotFound", async () => {
    const uc = new UpdateLaborRateUseCase(repo, clock);
    const r = await uc.exec({ id: "nope", label: "x" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/labor-rates.test.ts
```

Expected: "Cannot find module './labor-rates'".

- Step: write `modules/settings/app/labor-rates.ts`:

```typescript
import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, conflict, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { LaborRate, SettingsRepository } from "../domain/settings-repository";

export interface CreateLaborRateCommand {
  readonly id?: string;
  readonly label: string;
  readonly rateCentsPerHour: number;
  readonly position?: number;
}

export class CreateLaborRateUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly ids: IdGenerator) {}
  async exec(cmd: CreateLaborRateCommand, orgId: string): Promise<Result<LaborRate, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const rate = await this.repo.createLaborRate({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      label,
      rateCentsPerHour: Math.max(0, Math.round(cmd.rateCentsPerHour)),
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: rate.id }, "settings.laborRate.created");
    return ok(rate);
  }
}

export interface UpdateLaborRateCommand {
  readonly id: string;
  readonly label?: string;
  readonly rateCentsPerHour?: number;
  readonly position?: number;
}

export class UpdateLaborRateUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: UpdateLaborRateCommand, orgId: string): Promise<Result<LaborRate, AppError>> {
    const existing = (await this.repo.listLaborRates()).find((r) => r.id === cmd.id);
    if (!existing) return err(notFound("labor rate not found"));
    if (cmd.label !== undefined && cmd.label.trim().length === 0) {
      return err(validation("label is required", "label"));
    }
    const next: LaborRate = {
      id: existing.id,
      label: cmd.label !== undefined ? cmd.label.trim() : existing.label,
      rateCentsPerHour: cmd.rateCentsPerHour !== undefined ? Math.max(0, Math.round(cmd.rateCentsPerHour)) : existing.rateCentsPerHour,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.saveLaborRate(next);
    if (count === 0) return err(notFound("labor rate not found"));
    void this.clock.now();
    logger.info({ orgId, id: next.id }, "settings.laborRate.updated");
    return ok(next);
  }
}

export interface RemoveLaborRateCommand {
  readonly id: string;
}

export class RemoveLaborRateUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: RemoveLaborRateCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    // Invariant: never remove the last active rate (matches the prototype guard).
    if ((await this.repo.countActiveLaborRates()) <= 1) {
      return err(conflict("cannot remove the last labor rate"));
    }
    const count = await this.repo.archiveLaborRate(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("labor rate not found"));
    logger.info({ orgId, id: cmd.id }, "settings.laborRate.removed");
    return ok({ ok: true });
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/app/labor-rates.test.ts
```

Expected: five tests green.

- Step: write the failing test `modules/settings/app/terms.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { CreateTermUseCase, UpdateTermUseCase, RemoveTermUseCase } from "./terms";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("JobTerm use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;
  beforeEach(() => { repo = new FakeSettingsRepository(); clock = new FixedClock(new Date("2026-07-09T12:00:00Z")); });

  it("create: rejects empty title or body", async () => {
    const uc = new CreateTermUseCase(repo, fixedIds("t1"));
    const r1 = await uc.exec({ title: " ", body: "x" }, ORG);
    expect(r1.ok).toBe(false);
    const r2 = await uc.exec({ title: "x", body: " " }, ORG);
    expect(r2.ok).toBe(false);
  });

  it("create: appends", async () => {
    const uc = new CreateTermUseCase(repo, fixedIds("t1"));
    const r = await uc.exec({ title: "Warranty", body: "12 months" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.terms).toHaveLength(1);
  });

  it("remove: not-found returns NotFound", async () => {
    const uc = new RemoveTermUseCase(repo, clock);
    const r = await uc.exec({ id: "nope" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("update: patches body", async () => {
    await repo.createTerm({ id: "t1", orgId: ORG, title: "Warranty", body: "old", position: 0 });
    const uc = new UpdateTermUseCase(repo, clock);
    const r = await uc.exec({ id: "t1", body: "new" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.body).toBe("new");
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/terms.test.ts
```

Expected: "Cannot find module './terms'".

- Step: write `modules/settings/app/terms.ts`:

```typescript
import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { JobTerm, SettingsRepository } from "../domain/settings-repository";

export interface CreateTermCommand {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly position?: number;
}

export class CreateTermUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly ids: IdGenerator) {}
  async exec(cmd: CreateTermCommand, orgId: string): Promise<Result<JobTerm, AppError>> {
    const title = cmd.title.trim();
    const body = cmd.body.trim();
    if (title.length === 0) return err(validation("title is required", "title"));
    if (body.length === 0) return err(validation("body is required", "body"));
    const term = await this.repo.createTerm({ id: cmd.id ?? this.ids.newId(), orgId, title, body, position: cmd.position ?? 0 });
    logger.info({ orgId, id: term.id }, "settings.term.created");
    return ok(term);
  }
}

export interface UpdateTermCommand {
  readonly id: string;
  readonly title?: string;
  readonly body?: string;
  readonly position?: number;
}

export class UpdateTermUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: UpdateTermCommand, orgId: string): Promise<Result<JobTerm, AppError>> {
    const existing = (await this.repo.listTerms()).find((t) => t.id === cmd.id);
    if (!existing) return err(notFound("term not found"));
    if (cmd.title !== undefined && cmd.title.trim().length === 0) return err(validation("title is required", "title"));
    if (cmd.body !== undefined && cmd.body.trim().length === 0) return err(validation("body is required", "body"));
    const next: JobTerm = {
      id: existing.id,
      title: cmd.title !== undefined ? cmd.title.trim() : existing.title,
      body: cmd.body !== undefined ? cmd.body.trim() : existing.body,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.saveTerm(next);
    if (count === 0) return err(notFound("term not found"));
    void this.clock.now();
    logger.info({ orgId, id: next.id }, "settings.term.updated");
    return ok(next);
  }
}

export interface RemoveTermCommand {
  readonly id: string;
}

export class RemoveTermUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: RemoveTermCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archiveTerm(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("term not found"));
    logger.info({ orgId, id: cmd.id }, "settings.term.removed");
    return ok({ ok: true });
  }
}
```

- Step: run it, expected PASS:

```
npx vitest run modules/settings/app/terms.test.ts
```

Expected: four tests green.

- Step: write the failing test `modules/settings/app/sources.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import { FakeSettingsRepository } from "./get-settings.test";
import { CreateSourceUseCase, RemoveSourceUseCase } from "./sources";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const fixedIds = (id: string) => ({ newId: () => id });

describe("LeadSource use-cases", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;
  beforeEach(() => { repo = new FakeSettingsRepository(); clock = new FixedClock(new Date("2026-07-09T12:00:00Z")); });

  it("create: rejects empty label", async () => {
    const uc = new CreateSourceUseCase(repo, fixedIds("s1"));
    const r = await uc.exec({ label: "  " }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("label");
  });

  it("create: rejects a duplicate label (case-insensitive)", async () => {
    await repo.createSource({ id: "s1", orgId: ORG, label: "Google", position: 0 });
    const uc = new CreateSourceUseCase(repo, fixedIds("s2"));
    const r = await uc.exec({ label: "google" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });

  it("create: appends a new source", async () => {
    const uc = new CreateSourceUseCase(repo, fixedIds("s1"));
    const r = await uc.exec({ label: "Yard sign" }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.sources).toHaveLength(1);
  });

  it("remove: not-found returns NotFound", async () => {
    const uc = new RemoveSourceUseCase(repo, clock);
    const r = await uc.exec({ id: "nope" }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
```

- Step: run it, expected FAIL:

```
npx vitest run modules/settings/app/sources.test.ts
```

Expected: "Cannot find module './sources'".

- Step: write `modules/settings/app/sources.ts`:

```typescript
import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, conflict, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { LeadSource, SettingsRepository } from "../domain/settings-repository";

export interface CreateSourceCommand {
  readonly id?: string;
  readonly label: string;
  readonly position?: number;
}

export class CreateSourceUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly ids: IdGenerator) {}
  async exec(cmd: CreateSourceCommand, orgId: string): Promise<Result<LeadSource, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const existing = await this.repo.listSources();
    if (existing.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      return err(conflict("source already exists"));
    }
    const source = await this.repo.createSource({ id: cmd.id ?? this.ids.newId(), orgId, label, position: cmd.position ?? 0 });
    logger.info({ orgId, id: source.id }, "settings.source.created");
    return ok(source);
  }
}

export interface RemoveSourceCommand {
  readonly id: string;
}

export class RemoveSourceUseCase {
  constructor(private readonly repo: SettingsRepository, private readonly clock: Clock) {}
  async exec(cmd: RemoveSourceCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archiveSource(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("source not found"));
    logger.info({ orgId, id: cmd.id }, "settings.source.removed");
    return ok({ ok: true });
  }
}
```

- Step: run the full app suite, expected PASS:

```
npx vitest run modules/settings/app/
```

Expected: all use-case tests green.

- Step: commit:

```
git add modules/settings/app/
git commit -m "feat: settings use-cases with validation + collection CRUD"
```

---

### Task 5: Infra — Drizzle repository + mapper

**Files:**
- Create `modules/settings/infra/settings-mapper.ts`
- Create `modules/settings/infra/drizzle-settings-repository.ts`

**Interfaces:**
- Consumes: schema tables (`orgSettings`, `pricebookItems`, `laborRates`, `jobTerms`, `leadSources`) from `@mallet/shared/db/schema`; `TenantTx` from `@mallet/shared/db/tx`; `OrgId`, `asOrgId`, `isOk`; `OrgSettings`, `BookingCfg`; `SettingsRepository` + collection types.
- Produces: `DrizzleSettingsRepository implements SettingsRepository`, `toOrgSettings(row)` mapper.

- Step: write `modules/settings/infra/settings-mapper.ts`:

```typescript
import { asOrgId } from "@mallet/shared/types";
import { orgSettings } from "@mallet/shared/db/schema";
import { OrgSettings, type BookingCfg } from "../domain/org-settings";

export type OrgSettingsRow = typeof orgSettings.$inferSelect;

// Reconstruct the OrgSettings aggregate from a DB row. The booking column is jsonb; it is trusted
// (written only by this app) but corrupt data throws rather than silently coercing.
export const toOrgSettings = (row: OrgSettingsRow): OrgSettings => {
  const result = OrgSettings.create({
    orgId: asOrgId(row.orgId),
    trade: row.trade,
    markupBps: row.markupBps,
    visitScopeMinutes: row.visitScopeMinutes,
    visitRepairMinutes: row.visitRepairMinutes,
    visitInstallMinutes: row.visitInstallMinutes,
    techSeesPrice: row.techSeesPrice,
    techTexts: row.techTexts,
    frontDesk: row.frontDesk,
    scopeOn: row.scopeOn,
    hoursWdOpen: row.hoursWdOpen,
    hoursWdClose: row.hoursWdClose,
    hoursSatOpen: row.hoursSatOpen,
    hoursSatClose: row.hoursSatClose,
    hoursSunOpen: row.hoursSunOpen,
    hoursSunClose: row.hoursSunClose,
    areaCities: row.areaCities,
    areaRadiusMi: row.areaRadiusMi,
    booking: row.booking as BookingCfg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt org_settings ${row.id}: ${result.error.message}`);
  return result.value;
};
```

- Step: write `modules/settings/infra/drizzle-settings-repository.ts`:

```typescript
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  orgSettings, pricebookItems, laborRates, jobTerms, leadSources,
} from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { OrgSettings, BookingCfg } from "../domain/org-settings";
import type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
} from "../domain/settings-repository";
import { toOrgSettings } from "./settings-mapper";

// Real persistence. Constructed with a tenant-scoped tx (withTenant already set current_org_id), so
// RLS appends org_id = current_org_id() to every statement. orgId stamps inserts + guards writes.
export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async getConfig(orgId: string, defaults: () => BookingCfg): Promise<OrgSettings> {
    // Lazy create: insert the defaults row if absent. onConflictDoNothing on the unique(org_id)
    // makes concurrent first-reads collapse to one row. Then select the (now guaranteed) row.
    await this.tx
      .insert(orgSettings)
      .values({ orgId: this.orgId, booking: defaults() })
      .onConflictDoNothing({ target: orgSettings.orgId });
    const rows = await this.tx
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, this.orgId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("org_settings row missing after lazy create");
    return toOrgSettings(row);
  }

  async saveConfig(settings: OrgSettings): Promise<void> {
    const p = settings.props;
    await this.tx
      .update(orgSettings)
      .set({
        trade: p.trade,
        markupBps: p.markupBps,
        visitScopeMinutes: p.visitScopeMinutes,
        visitRepairMinutes: p.visitRepairMinutes,
        visitInstallMinutes: p.visitInstallMinutes,
        techSeesPrice: p.techSeesPrice,
        techTexts: p.techTexts,
        frontDesk: p.frontDesk,
        scopeOn: p.scopeOn,
        hoursWdOpen: p.hoursWdOpen,
        hoursWdClose: p.hoursWdClose,
        hoursSatOpen: p.hoursSatOpen,
        hoursSatClose: p.hoursSatClose,
        hoursSunOpen: p.hoursSunOpen,
        hoursSunClose: p.hoursSunClose,
        areaCities: p.areaCities,
        areaRadiusMi: p.areaRadiusMi,
        booking: p.booking,
        updatedAt: p.updatedAt,
      })
      .where(eq(orgSettings.orgId, this.orgId));
  }

  // ── pricebook ─────────────────────────────────────────────────────────────
  async listPricebook(): Promise<PricebookItem[]> {
    const rows = await this.tx
      .select()
      .from(pricebookItems)
      .where(and(eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt)))
      .orderBy(asc(pricebookItems.position), asc(pricebookItems.createdAt));
    return rows.map((r) => ({ id: r.id, label: r.label, unitPriceCents: r.unitPriceCents, costCents: r.costCents, position: r.position }));
  }
  async createPricebook(input: { id: string; orgId: string; label: string; unitPriceCents: number; costCents: number; position: number }): Promise<PricebookItem> {
    const rows = await this.tx.insert(pricebookItems).values({ id: input.id, orgId: this.orgId, label: input.label, unitPriceCents: input.unitPriceCents, costCents: input.costCents, position: input.position }).returning();
    const r = rows[0];
    if (!r) throw new Error("pricebook insert returned no row");
    return { id: r.id, label: r.label, unitPriceCents: r.unitPriceCents, costCents: r.costCents, position: r.position };
  }
  async savePricebook(item: PricebookItem): Promise<number> {
    const rows = await this.tx.update(pricebookItems).set({ label: item.label, unitPriceCents: item.unitPriceCents, costCents: item.costCents, position: item.position }).where(and(eq(pricebookItems.id, item.id), eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt))).returning();
    return rows.length;
  }
  async archivePricebook(id: string, now: Date): Promise<number> {
    const rows = await this.tx.update(pricebookItems).set({ deletedAt: now, updatedAt: now }).where(and(eq(pricebookItems.id, id), eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt))).returning();
    return rows.length;
  }

  // ── labor rates ─────────────────────────────────────────────────────────────
  async listLaborRates(): Promise<LaborRate[]> {
    const rows = await this.tx.select().from(laborRates).where(and(eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt))).orderBy(asc(laborRates.position), asc(laborRates.createdAt));
    return rows.map((r) => ({ id: r.id, label: r.label, rateCentsPerHour: r.rateCentsPerHour, position: r.position }));
  }
  async createLaborRate(input: { id: string; orgId: string; label: string; rateCentsPerHour: number; position: number }): Promise<LaborRate> {
    const rows = await this.tx.insert(laborRates).values({ id: input.id, orgId: this.orgId, label: input.label, rateCentsPerHour: input.rateCentsPerHour, position: input.position }).returning();
    const r = rows[0];
    if (!r) throw new Error("labor rate insert returned no row");
    return { id: r.id, label: r.label, rateCentsPerHour: r.rateCentsPerHour, position: r.position };
  }
  async saveLaborRate(rate: LaborRate): Promise<number> {
    const rows = await this.tx.update(laborRates).set({ label: rate.label, rateCentsPerHour: rate.rateCentsPerHour, position: rate.position }).where(and(eq(laborRates.id, rate.id), eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt))).returning();
    return rows.length;
  }
  async countActiveLaborRates(): Promise<number> {
    const rows = await this.tx.select({ id: laborRates.id }).from(laborRates).where(and(eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt)));
    return rows.length;
  }
  async archiveLaborRate(id: string, now: Date): Promise<number> {
    const rows = await this.tx.update(laborRates).set({ deletedAt: now, updatedAt: now }).where(and(eq(laborRates.id, id), eq(laborRates.orgId, this.orgId), isNull(laborRates.deletedAt))).returning();
    return rows.length;
  }

  // ── terms ─────────────────────────────────────────────────────────────
  async listTerms(): Promise<JobTerm[]> {
    const rows = await this.tx.select().from(jobTerms).where(and(eq(jobTerms.orgId, this.orgId), isNull(jobTerms.deletedAt))).orderBy(asc(jobTerms.position), asc(jobTerms.createdAt));
    return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, position: r.position }));
  }
  async createTerm(input: { id: string; orgId: string; title: string; body: string; position: number }): Promise<JobTerm> {
    const rows = await this.tx.insert(jobTerms).values({ id: input.id, orgId: this.orgId, title: input.title, body: input.body, position: input.position }).returning();
    const r = rows[0];
    if (!r) throw new Error("term insert returned no row");
    return { id: r.id, title: r.title, body: r.body, position: r.position };
  }
  async saveTerm(term: JobTerm): Promise<number> {
    const rows = await this.tx.update(jobTerms).set({ title: term.title, body: term.body, position: term.position }).where(and(eq(jobTerms.id, term.id), eq(jobTerms.orgId, this.orgId), isNull(jobTerms.deletedAt))).returning();
    return rows.length;
  }
  async archiveTerm(id: string, now: Date): Promise<number> {
    const rows = await this.tx.update(jobTerms).set({ deletedAt: now, updatedAt: now }).where(and(eq(jobTerms.id, id), eq(jobTerms.orgId, this.orgId), isNull(jobTerms.deletedAt))).returning();
    return rows.length;
  }

  // ── sources ─────────────────────────────────────────────────────────────
  async listSources(): Promise<LeadSource[]> {
    const rows = await this.tx.select().from(leadSources).where(and(eq(leadSources.orgId, this.orgId), isNull(leadSources.deletedAt))).orderBy(asc(leadSources.position), asc(leadSources.createdAt));
    return rows.map((r) => ({ id: r.id, label: r.label, position: r.position }));
  }
  async createSource(input: { id: string; orgId: string; label: string; position: number }): Promise<LeadSource> {
    const rows = await this.tx.insert(leadSources).values({ id: input.id, orgId: this.orgId, label: input.label, position: input.position }).returning();
    const r = rows[0];
    if (!r) throw new Error("source insert returned no row");
    return { id: r.id, label: r.label, position: r.position };
  }
  async saveSource(source: LeadSource): Promise<number> {
    const rows = await this.tx.update(leadSources).set({ label: source.label, position: source.position }).where(and(eq(leadSources.id, source.id), eq(leadSources.orgId, this.orgId), isNull(leadSources.deletedAt))).returning();
    return rows.length;
  }
  async archiveSource(id: string, now: Date): Promise<number> {
    const rows = await this.tx.update(leadSources).set({ deletedAt: now, updatedAt: now }).where(and(eq(leadSources.id, id), eq(leadSources.orgId, this.orgId), isNull(leadSources.deletedAt))).returning();
    return rows.length;
  }
}
```

- Step: typecheck the infra layer:

```
npx tsc --noEmit
```

Expected: 0 errors (repo satisfies `SettingsRepository`; mapper types align with `$inferSelect`).

- Step: commit:

```
git add modules/settings/infra/
git commit -m "feat: drizzle settings repository + mapper with lazy-create"
```

---

### Task 6: API — DTOs, router, integration test, module barrel, registration

**Files:**
- Create `modules/settings/api/settings-dto.ts`
- Create `modules/settings/api/settings-router.ts`
- Create `modules/settings/api/settings-router.int.test.ts`
- Create `modules/settings/index.ts`
- Modify `trpc/root.ts` (import + register `settings: createSettingsRouter()`)

**Interfaces:**
- Consumes: `router`, `ownerOrOffice` (`@/trpc/init`); `orThrow` (`@/trpc/errors`); all use-cases + `DrizzleSettingsRepository`; `ctx.tx`, `ctx.principal.orgId`, `ctx.deps.clock`, `ctx.deps.ids`.
- Produces: `createSettingsRouter()` returning `v1.settings.{get, updateConfig, pricebook.*, laborRates.*, terms.*, sources.*}`; barrel export.

- Step: write `modules/settings/api/settings-dto.ts`:

```typescript
import { z } from "zod";
import type { SettingsSnapshot } from "../app/get-settings";
import type { PricebookItem, LaborRate, JobTerm, LeadSource } from "../domain/settings-repository";
import type { OrgSettings } from "../domain/org-settings";

export const bookingServiceDTO = z.object({
  name: z.string(),
  lane: z.enum(["repair", "estimate", "flat"]),
  price: z.number().optional(),
  triggers: z.string(),
});
export const bookingCfgDTO = z.object({
  services: z.array(bookingServiceDTO),
  notServices: z.string(),
  serviceFee: z.number(),
  feeCredited: z.boolean(),
});

export const orgSettingsDTO = z.object({
  trade: z.string(),
  markupBps: z.number().int(),
  visitScopeMinutes: z.number().int(),
  visitRepairMinutes: z.number().int(),
  visitInstallMinutes: z.number().int(),
  techSeesPrice: z.boolean(),
  techTexts: z.boolean(),
  frontDesk: z.boolean(),
  scopeOn: z.boolean(),
  hoursWdOpen: z.number().int(),
  hoursWdClose: z.number().int(),
  hoursSatOpen: z.number().int(),
  hoursSatClose: z.number().int(),
  hoursSunOpen: z.number().int(),
  hoursSunClose: z.number().int(),
  areaCities: z.string(),
  areaRadiusMi: z.number().int(),
  booking: bookingCfgDTO,
});

export const pricebookItemDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  unitPriceCents: z.number().int(),
  costCents: z.number().int(),
  position: z.number().int(),
});
export const laborRateDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  rateCentsPerHour: z.number().int(),
  position: z.number().int(),
});
export const jobTermDTO = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  position: z.number().int(),
});
export const leadSourceDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  position: z.number().int(),
});

export const settingsSnapshotDTO = z.object({
  config: orgSettingsDTO,
  pricebook: z.array(pricebookItemDTO),
  laborRates: z.array(laborRateDTO),
  terms: z.array(jobTermDTO),
  sources: z.array(leadSourceDTO),
});

export const toOrgSettingsDTO = (s: OrgSettings): z.infer<typeof orgSettingsDTO> => {
  const p = s.props;
  return {
    trade: p.trade, markupBps: p.markupBps,
    visitScopeMinutes: p.visitScopeMinutes, visitRepairMinutes: p.visitRepairMinutes, visitInstallMinutes: p.visitInstallMinutes,
    techSeesPrice: p.techSeesPrice, techTexts: p.techTexts, frontDesk: p.frontDesk, scopeOn: p.scopeOn,
    hoursWdOpen: p.hoursWdOpen, hoursWdClose: p.hoursWdClose, hoursSatOpen: p.hoursSatOpen, hoursSatClose: p.hoursSatClose, hoursSunOpen: p.hoursSunOpen, hoursSunClose: p.hoursSunClose,
    areaCities: p.areaCities, areaRadiusMi: p.areaRadiusMi, booking: p.booking,
  };
};
export const toPricebookDTO = (i: PricebookItem): z.infer<typeof pricebookItemDTO> => ({ ...i });
export const toLaborRateDTO = (r: LaborRate): z.infer<typeof laborRateDTO> => ({ ...r });
export const toJobTermDTO = (t: JobTerm): z.infer<typeof jobTermDTO> => ({ ...t });
export const toLeadSourceDTO = (s: LeadSource): z.infer<typeof leadSourceDTO> => ({ ...s });
export const toSnapshotDTO = (s: SettingsSnapshot): z.infer<typeof settingsSnapshotDTO> => ({
  config: toOrgSettingsDTO(s.config),
  pricebook: s.pricebook.map(toPricebookDTO),
  laborRates: s.laborRates.map(toLaborRateDTO),
  terms: s.terms.map(toJobTermDTO),
  sources: s.sources.map(toLeadSourceDTO),
});
```

- Step: write `modules/settings/api/settings-router.ts`:

```typescript
import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleSettingsRepository } from "../infra/drizzle-settings-repository";
import { GetSettingsUseCase } from "../app/get-settings";
import { UpdateConfigUseCase } from "../app/update-config";
import { CreatePricebookUseCase, UpdatePricebookUseCase, RemovePricebookUseCase } from "../app/pricebook";
import { CreateLaborRateUseCase, UpdateLaborRateUseCase, RemoveLaborRateUseCase } from "../app/labor-rates";
import { CreateTermUseCase, UpdateTermUseCase, RemoveTermUseCase } from "../app/terms";
import { CreateSourceUseCase, RemoveSourceUseCase } from "../app/sources";
import {
  settingsSnapshotDTO, orgSettingsDTO, pricebookItemDTO, laborRateDTO, jobTermDTO, leadSourceDTO,
  bookingCfgDTO, toSnapshotDTO, toOrgSettingsDTO, toPricebookDTO, toLaborRateDTO, toJobTermDTO, toLeadSourceDTO,
} from "./settings-dto";

const okDTO = z.object({ ok: z.boolean() });

const updateConfigInput = z.object({
  trade: z.string().min(1).max(50).optional(),
  markupBps: z.number().int().min(0).max(1_000_000).optional(),
  visitScopeMinutes: z.number().int().min(0).max(1440).optional(),
  visitRepairMinutes: z.number().int().min(0).max(1440).optional(),
  visitInstallMinutes: z.number().int().min(0).max(1440).optional(),
  techSeesPrice: z.boolean().optional(),
  techTexts: z.boolean().optional(),
  frontDesk: z.boolean().optional(),
  scopeOn: z.boolean().optional(),
  hoursWdOpen: z.number().int().min(0).max(24).optional(),
  hoursWdClose: z.number().int().min(0).max(24).optional(),
  hoursSatOpen: z.number().int().min(0).max(24).optional(),
  hoursSatClose: z.number().int().min(0).max(24).optional(),
  hoursSunOpen: z.number().int().min(0).max(24).optional(),
  hoursSunClose: z.number().int().min(0).max(24).optional(),
  areaCities: z.string().max(1000).optional(),
  areaRadiusMi: z.number().int().min(0).max(500).optional(),
  booking: bookingCfgDTO.optional(),
});

export const createSettingsRouter = () =>
  router({
    get: ownerOrOffice
      .output(settingsSnapshotDTO)
      .query(async ({ ctx }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const result = await new GetSettingsUseCase(repo).exec(ctx.principal.orgId);
        return toSnapshotDTO(orThrow(result));
      }),

    updateConfig: ownerOrOffice
      .input(updateConfigInput)
      .output(orgSettingsDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const result = await new UpdateConfigUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
        return toOrgSettingsDTO(orThrow(result));
      }),

    pricebook: router({
      create: ownerOrOffice
        .input(z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(500), unitPriceCents: z.number().int().min(0), costCents: z.number().int().min(0), position: z.number().int().optional() }))
        .output(pricebookItemDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreatePricebookUseCase(repo, ctx.deps.ids).exec(input, ctx.principal.orgId);
          return toPricebookDTO(orThrow(result));
        }),
      update: ownerOrOffice
        .input(z.object({ id: z.string().uuid(), label: z.string().min(1).max(500).optional(), unitPriceCents: z.number().int().min(0).optional(), costCents: z.number().int().min(0).optional(), position: z.number().int().optional() }))
        .output(pricebookItemDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdatePricebookUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return toPricebookDTO(orThrow(result));
        }),
      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemovePricebookUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return orThrow(result);
        }),
    }),

    laborRates: router({
      create: ownerOrOffice
        .input(z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(200), rateCentsPerHour: z.number().int().min(0), position: z.number().int().optional() }))
        .output(laborRateDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateLaborRateUseCase(repo, ctx.deps.ids).exec(input, ctx.principal.orgId);
          return toLaborRateDTO(orThrow(result));
        }),
      update: ownerOrOffice
        .input(z.object({ id: z.string().uuid(), label: z.string().min(1).max(200).optional(), rateCentsPerHour: z.number().int().min(0).optional(), position: z.number().int().optional() }))
        .output(laborRateDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdateLaborRateUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return toLaborRateDTO(orThrow(result));
        }),
      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveLaborRateUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return orThrow(result);
        }),
    }),

    terms: router({
      create: ownerOrOffice
        .input(z.object({ id: z.string().uuid().optional(), title: z.string().min(1).max(200), body: z.string().min(1).max(10_000), position: z.number().int().optional() }))
        .output(jobTermDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateTermUseCase(repo, ctx.deps.ids).exec(input, ctx.principal.orgId);
          return toJobTermDTO(orThrow(result));
        }),
      update: ownerOrOffice
        .input(z.object({ id: z.string().uuid(), title: z.string().min(1).max(200).optional(), body: z.string().min(1).max(10_000).optional(), position: z.number().int().optional() }))
        .output(jobTermDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdateTermUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return toJobTermDTO(orThrow(result));
        }),
      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveTermUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return orThrow(result);
        }),
    }),

    sources: router({
      create: ownerOrOffice
        .input(z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(200), position: z.number().int().optional() }))
        .output(leadSourceDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateSourceUseCase(repo, ctx.deps.ids).exec(input, ctx.principal.orgId);
          return toLeadSourceDTO(orThrow(result));
        }),
      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveSourceUseCase(repo, ctx.deps.clock).exec(input, ctx.principal.orgId);
          return orThrow(result);
        }),
    }),
  });
```

- Step: write `modules/settings/index.ts`:

```typescript
// Public surface for the settings module — the only sanctioned import seam.
export { createSettingsRouter } from "./api/settings-router";
export { OrgSettings } from "./domain/org-settings";
export type { OrgSettingsProps, BookingCfg, BookingService, ServiceLane } from "./domain/org-settings";
export type {
  SettingsRepository, PricebookItem, LaborRate, JobTerm, LeadSource,
} from "./domain/settings-repository";
export { GetSettingsUseCase } from "./app/get-settings";
export type { SettingsSnapshot } from "./app/get-settings";
export { UpdateConfigUseCase } from "./app/update-config";
export { DrizzleSettingsRepository } from "./infra/drizzle-settings-repository";
```

- Step: register the router — edit `trpc/root.ts`. Add the import beside the others:

```typescript
import { createSettingsRouter } from "@mallet/settings";
```

and add the line to the `v1` router (after `messaging: createMessagingRouter(),`):

```typescript
    settings: createSettingsRouter(),
```

- Step: write the failing integration test `modules/settings/api/settings-router.int.test.ts` (mirrors `company-router.int.test.ts` exactly — same `ctxFor`, `stubAuth`, live-DB gate):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => { throw new Error("authProvider should not be called"); },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("settings tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('SettingsApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('SettingsApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("get lazily creates a defaults row for a fresh org", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const snap = await caller.v1.settings.get();
    expect(snap.config.trade).toBe("plumbing");
    expect(snap.config.markupBps).toBe(3500);
    expect(snap.config.booking.services.length).toBeGreaterThan(0);
    expect(snap.pricebook).toEqual([]);
  });

  it("updateConfig persists scalars and the booking blob", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const cfg = await caller.v1.settings.updateConfig({ markupBps: 4200, booking: { services: [], notServices: "septic", serviceFee: 120, feeCredited: false } });
    expect(cfg.markupBps).toBe(4200);
    expect(cfg.booking.serviceFee).toBe(120);
    const snap = await caller.v1.settings.get();
    expect(snap.config.markupBps).toBe(4200);
  });

  it("pricebook create/update/remove round-trips", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.settings.pricebook.create({ label: "Sewer camera", unitPriceCents: 28500, costCents: 0 });
    expect(created.unitPriceCents).toBe(28500);
    const updated = await caller.v1.settings.pricebook.update({ id: created.id, unitPriceCents: 30000 });
    expect(updated.unitPriceCents).toBe(30000);
    const removed = await caller.v1.settings.pricebook.remove({ id: created.id });
    expect(removed.ok).toBe(true);
    const snap = await caller.v1.settings.get();
    expect(snap.pricebook.some((p) => p.id === created.id)).toBe(false);
  });

  it("labor rate cannot delete the last active rate (CONFLICT)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const only = await caller.v1.settings.laborRates.create({ label: "Standard", rateCentsPerHour: 17000 });
    await expect(caller.v1.settings.laborRates.remove({ id: only.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("duplicate source label is rejected with CONFLICT", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await caller.v1.settings.sources.create({ label: "Google" });
    await expect(caller.v1.settings.sources.create({ label: "google" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("org B sees none of org A's collections (RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.settings.pricebook.create({ label: "A-only", unitPriceCents: 100, costCents: 0 });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const snapB = await callerB.v1.settings.get();
    expect(snapB.pricebook.some((p) => p.id === created.id)).toBe(false);
    await expect(callerB.v1.settings.pricebook.remove({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from settings", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerTech.v1.settings.updateConfig({ markupBps: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- Step: run the int test, expected PASS (live DB present):

```
npm run test:int -- modules/settings/api/settings-router.int.test.ts
```

Expected: all 7 cases green (or the whole suite `describe.skip`s cleanly when no DB is configured — matching companies).

- Step: typecheck (router is now wired into `AppRouter`, so `RouterOutputs` for the hydrator resolves in Task 8):

```
npx tsc --noEmit
```

Expected: 0 errors.

- Step: commit:

```
git add modules/settings/api/ modules/settings/index.ts trpc/root.ts
git commit -m "feat: v1.settings router + DTOs + integration test; register in root"
```

---

### Task 7: Store — persisting settings-slice (server ids, no SEED_* as source of truth)

**Files:**
- Modify `lib/store/slices/settings-slice.ts` (rewrite the actions; keep the state shapes but change `LaborRate.id` to `string`, add ids to `PbItem`/`TermItem`/sources; drop `_nextLaborId`; keep `SEED_*` renamed to `EMPTY_*` starting values so the store renders before hydration, but they are no longer the source of truth — the hydrator overwrites them)
- Create `lib/store/slices/settings-slice.test.ts`

**Interfaces:**
- Consumes: `trpcVanilla.v1.settings.*` (Task 6); `crypto.randomUUID`.
- Produces: settings-slice actions that persist; a pure helper `buildBookingPayload(booking)` (mirrors `buildLeadUpdatePayload`) exported for unit tests; state now carries server ids on all collections.

> The collections change to carry stable server ids. `PbItem` gains `id: string`; `TermItem`
> gains `id: string`; `sources` becomes `{ id: string; label: string }[]`; `LaborRate.id` becomes
> `string`. The Settings page (Task 9) is updated to key on `id` and pass ids to update/remove.

- Step: write the failing test `lib/store/slices/settings-slice.test.ts` (module-mock `trpcVanilla`, mirroring `leads-slice.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreatePb = vi.fn().mockResolvedValue({ id: "srv-pb", label: "Camera", unitPriceCents: 28500, costCents: 0, position: 0 });
const mockRemovePb = vi.fn().mockResolvedValue({ ok: true });
const mockUpdateConfig = vi.fn().mockResolvedValue({ markupBps: 4200 });
const mockCreateSource = vi.fn().mockResolvedValue({ id: "srv-src", label: "Home show", position: 0 });

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      settings: {
        updateConfig: { mutate: (...a: unknown[]) => mockUpdateConfig(...a) },
        pricebook: {
          create: { mutate: (...a: unknown[]) => mockCreatePb(...a) },
          update: { mutate: vi.fn().mockResolvedValue({ id: "srv-pb", label: "Camera", unitPriceCents: 30000, costCents: 0, position: 0 }) },
          remove: { mutate: (...a: unknown[]) => mockRemovePb(...a) },
        },
        laborRates: { create: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn().mockResolvedValue({ ok: true }) } },
        terms: { create: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn().mockResolvedValue({ ok: true }) } },
        sources: { create: { mutate: (...a: unknown[]) => mockCreateSource(...a) }, remove: { mutate: vi.fn().mockResolvedValue({ ok: true }) } },
      },
    },
  },
}));

import { createSettingsSlice } from "./settings-slice";
import type { SettingsSlice } from "./settings-slice";

function makeStore() {
  let state = {} as SettingsSlice;
  const set = (partial: Partial<SettingsSlice> | ((s: SettingsSlice) => Partial<SettingsSlice>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = createSettingsSlice(set as never, get as never, {} as never);
  return { get, set };
}

describe("settings-slice persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("addPricebookItem optimistically appends then reconciles the server id", async () => {
    const store = makeStore();
    store.get().addPricebookItem("Camera", 28500, 0);
    // optimistic row present immediately
    expect(store.get().pricebook.some((p) => p.label === "Camera")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreatePb).toHaveBeenCalledTimes(1);
    // the mutate payload carries a client uuid + cents
    const arg = mockCreatePb.mock.calls[0]![0] as { label: string; unitPriceCents: number };
    expect(arg.label).toBe("Camera");
    expect(arg.unitPriceCents).toBe(28500);
    // reconciled to the server id
    expect(store.get().pricebook.some((p) => p.id === "srv-pb")).toBe(true);
  });

  it("setMarkup persists via updateConfig (bps)", async () => {
    const store = makeStore();
    store.get().setMarkup(42);
    expect(store.get().markup).toBe(42);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ markupBps: 4200 });
  });

  it("addSource dedupes case-insensitively before persisting", async () => {
    const store = makeStore();
    store.set({ sources: [{ id: "x", label: "Google" }] });
    store.get().addSource("google");
    await Promise.resolve();
    expect(mockCreateSource).not.toHaveBeenCalled();
    expect(store.get().sources).toHaveLength(1);
  });

  it("removePricebookItem rolls back on rejection", async () => {
    mockRemovePb.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    store.set({ pricebook: [{ id: "p1", d: "Camera", r: 285, h: 0, c: 0 }] });
    store.get().removePricebookItem("p1");
    // optimistic removal
    expect(store.get().pricebook).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    // rolled back
    expect(store.get().pricebook.some((p) => p.id === "p1")).toBe(true);
  });
});
```

- Step: run it, expected FAIL (actions are not persisting; ids are numeric; signatures differ):

```
npx vitest run lib/store/slices/settings-slice.test.ts
```

Expected: failures — `mockCreatePb` never called, `pricebook` items have no `id`, `removePricebookItem` expects an index not an id.

- Step: rewrite `lib/store/slices/settings-slice.ts`. Change the shapes to carry ids and switch actions to optimistic → `trpcVanilla.v1.settings.*` → reconcile/rollback. Key edits:

  1. Shape ids (top of file):

```typescript
export interface PbItem { id: string; d: string; r: number; h: number; c: number; }
export interface LaborRate { id: string; name: string; rate: number; }
export interface TermItem { id: string; t: string; body: string; }
export interface SourceItem { id: string; label: string; }
```

  2. Import the vanilla client + drop the counter:

```typescript
import type { StateCreator } from "zustand";
import { trpcVanilla } from "@/lib/trpc/vanilla";
// (remove: let _nextLaborId = 1000;)
```

  3. Rename `SEED_*` to `EMPTY_*` pre-hydration values (they render before the hydrator lands but are NOT the source of truth). `sources` becomes `SourceItem[]`; `booking.serviceFee` stays dollars:

```typescript
// Pre-hydration placeholders — SettingsHydrator overwrites these from v1.settings.get.
// Not a source of truth; a fresh org gets server defaults (defaultBooking + empty collections).
const EMPTY_PRICEBOOK: PbItem[] = [];
const EMPTY_LABOR_RATES: LaborRate[] = [];
const EMPTY_TERMS: TermItem[] = [];
const EMPTY_SOURCES: SourceItem[] = [];
const EMPTY_BOOKING: BookingCfg = { services: [], notServices: "", serviceFee: 89, feeCredited: true, hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 }, area: { cities: "", radiusMi: 25 } };
const EMPTY_VISIT_DUR: VisitDur = { scope: 0.5, repair: 1.5, install: 4 };
const EMPTY_MARKUP = 35;
const EMPTY_TRADE = "plumbing";
const EMPTY_TOGGLES: SettingsToggles = { techSeesPrice: true, techTexts: true, frontDesk: true, scopeOn: false };
```

  4. Add a `setSettings` hydration action to the interface + a pure `bookingToPayload` helper, and rewrite each mutating action. Representative rewrites (apply the same optimistic → mutate → reconcile/rollback shape to every action):

```typescript
export interface SettingsSlice {
  pricebook: PbItem[];
  laborRates: LaborRate[];
  terms: TermItem[];
  sources: SourceItem[];
  booking: BookingCfg;
  visitDur: VisitDur;
  markup: number;
  trade: string;
  toggles: SettingsToggles;

  /** Replace the whole slice — called by SettingsHydrator. */
  setSettings: (snapshot: {
    pricebook: PbItem[]; laborRates: LaborRate[]; terms: TermItem[]; sources: SourceItem[];
    booking: BookingCfg; visitDur: VisitDur; markup: number; trade: string; toggles: SettingsToggles;
  }) => void;

  addPricebookItem: (d: string, r: number, c: number) => void;
  updatePricebookItem: (id: string, field: "d" | "r" | "c", value: string) => void;
  removePricebookItem: (id: string) => void;

  addLaborRate: (name: string, rate: number) => void;
  updateLaborRate: (id: string, field: "name" | "rate", value: string) => void;
  removeLaborRate: (id: string) => void;

  addTerm: (t: string, body: string) => void;
  removeTerm: (id: string) => void;

  addSource: (name: string) => void;
  removeSource: (id: string) => void;

  updateBookingService: (index: number, field: keyof BookingService, value: string) => void;
  addBookingService: (name: string) => void;
  removeBookingService: (index: number) => void;
  setServiceFee: (n: number) => void;
  setFeeCredited: (b: boolean) => void;
  setBookingField: (field: "notServices", value: string) => void;
  setBookingHours: (key: keyof BookingHours, value: number) => void;
  setBookingArea: (field: keyof BookingArea, value: string) => void;

  setVisitDur: (key: keyof VisitDur, minutes: number) => void;
  setMarkup: (n: number) => void;
  setTrade: (t: string) => void;
  setToggle: (key: keyof SettingsToggles, value: boolean) => void;
}
```

  5. Implement the actions (showing the load-bearing ones — apply the identical pattern to the rest):

```typescript
export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  pricebook: EMPTY_PRICEBOOK,
  laborRates: EMPTY_LABOR_RATES,
  terms: EMPTY_TERMS,
  sources: EMPTY_SOURCES,
  booking: EMPTY_BOOKING,
  visitDur: EMPTY_VISIT_DUR,
  markup: EMPTY_MARKUP,
  trade: EMPTY_TRADE,
  toggles: EMPTY_TOGGLES,

  setSettings: (snapshot) => set({ ...snapshot }),

  // ---- pricebook ----
  addPricebookItem: (d, r, c) => {
    const desc = d.trim();
    if (!desc) return;
    const cost = Math.max(0, Math.round(Number.isFinite(c) ? c : 0));
    let rate = Math.max(0, Math.round(Number.isFinite(r) ? r : 0));
    if (get().pricebook.some((p) => p.d.trim().toLowerCase() === desc.toLowerCase())) return;
    if (!rate && cost) rate = Math.round(cost * (1 + (get().markup || 0) / 100));
    const id = crypto.randomUUID();
    const item: PbItem = { id, d: desc, r: rate, h: 0, c: cost };
    set((s) => ({ pricebook: [...s.pricebook, item] }));
    void trpcVanilla.v1.settings.pricebook.create
      .mutate({ id, label: desc, unitPriceCents: rate * 100, costCents: cost * 100 })
      .then((dto) => {
        set((s) => ({ pricebook: s.pricebook.map((p) => (p.id === id ? { ...p, id: dto.id, d: dto.label, r: Math.round(dto.unitPriceCents / 100), c: Math.round(dto.costCents / 100) } : p)) }));
      })
      .catch(() => {
        set((s) => ({ pricebook: s.pricebook.filter((p) => p.id !== id) }));
      });
  },

  updatePricebookItem: (id, field, value) => {
    const snapshot = get().pricebook;
    set((s) => ({
      pricebook: s.pricebook.map((p) => {
        if (p.id !== id) return p;
        if (field === "d") return { ...p, d: value };
        return { ...p, [field]: Math.max(0, Math.round(Number(value) || 0)) };
      }),
    }));
    const next = get().pricebook.find((p) => p.id === id);
    if (!next) return;
    void trpcVanilla.v1.settings.pricebook.update
      .mutate({ id, label: next.d, unitPriceCents: next.r * 100, costCents: next.c * 100 })
      .catch(() => set({ pricebook: snapshot }));
  },

  removePricebookItem: (id) => {
    const snapshot = get().pricebook;
    set((s) => ({ pricebook: s.pricebook.filter((p) => p.id !== id) }));
    void trpcVanilla.v1.settings.pricebook.remove.mutate({ id }).catch(() => set({ pricebook: snapshot }));
  },

  // ---- labor rates ----
  addLaborRate: (name, rate) => {
    const nm = name.trim();
    if (!nm) return;
    const r = Math.max(1, Math.round(Number.isFinite(rate) ? rate : 0)) || 170;
    const id = crypto.randomUUID();
    set((s) => ({ laborRates: [...s.laborRates, { id, name: nm, rate: r }] }));
    void trpcVanilla.v1.settings.laborRates.create
      .mutate({ id, label: nm, rateCentsPerHour: r * 100 })
      .then((dto) => set((s) => ({ laborRates: s.laborRates.map((x) => (x.id === id ? { id: dto.id, name: dto.label, rate: Math.round(dto.rateCentsPerHour / 100) } : x)) })))
      .catch(() => set((s) => ({ laborRates: s.laborRates.filter((x) => x.id !== id) })));
  },

  updateLaborRate: (id, field, value) => {
    const snapshot = get().laborRates;
    set((s) => ({
      laborRates: s.laborRates.map((lr) => {
        if (lr.id !== id) return lr;
        if (field === "rate") return { ...lr, rate: Math.max(1, Number(value) || lr.rate) };
        return { ...lr, name: value.trim() || lr.name };
      }),
    }));
    const next = get().laborRates.find((x) => x.id === id);
    if (!next) return;
    void trpcVanilla.v1.settings.laborRates.update
      .mutate({ id, label: next.name, rateCentsPerHour: next.rate * 100 })
      .catch(() => set({ laborRates: snapshot }));
  },

  removeLaborRate: (id) => {
    if (get().laborRates.length <= 1) return; // keep the client guard; server also enforces it
    const snapshot = get().laborRates;
    set((s) => ({ laborRates: s.laborRates.filter((lr) => lr.id !== id) }));
    void trpcVanilla.v1.settings.laborRates.remove.mutate({ id }).catch(() => set({ laborRates: snapshot }));
  },

  // ---- terms ----
  addTerm: (t, body) => {
    const name = t.trim();
    const text = body.trim();
    if (!name || !text) return;
    const id = crypto.randomUUID();
    set((s) => ({ terms: [...s.terms, { id, t: name, body: text }] }));
    void trpcVanilla.v1.settings.terms.create
      .mutate({ id, title: name, body: text })
      .then((dto) => set((s) => ({ terms: s.terms.map((x) => (x.id === id ? { id: dto.id, t: dto.title, body: dto.body } : x)) })))
      .catch(() => set((s) => ({ terms: s.terms.filter((x) => x.id !== id) })));
  },

  removeTerm: (id) => {
    const snapshot = get().terms;
    set((s) => ({ terms: s.terms.filter((x) => x.id !== id) }));
    void trpcVanilla.v1.settings.terms.remove.mutate({ id }).catch(() => set({ terms: snapshot }));
  },

  // ---- sources ----
  addSource: (name) => {
    const nm = name.trim();
    if (!nm) return;
    if (get().sources.some((x) => x.label.toLowerCase() === nm.toLowerCase())) return;
    const id = crypto.randomUUID();
    set((s) => ({ sources: [...s.sources, { id, label: nm }] }));
    void trpcVanilla.v1.settings.sources.create
      .mutate({ id, label: nm })
      .then((dto) => set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { id: dto.id, label: dto.label } : x)) })))
      .catch(() => set((s) => ({ sources: s.sources.filter((x) => x.id !== id) })));
  },

  removeSource: (id) => {
    const snapshot = get().sources;
    set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }));
    void trpcVanilla.v1.settings.sources.remove.mutate({ id }).catch(() => set({ sources: snapshot }));
  },

  // ---- booking (persist the whole blob via updateConfig on every edit) ----
  updateBookingService: (index, field, value) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: { ...s.booking, services: s.booking.services.map((svc, i) => {
        if (i !== index) return svc;
        if (field === "price") return { ...svc, price: Math.max(0, Number(value) || 0) };
        return { ...svc, [field]: value };
      }) },
    }));
    persistBooking(get, set, snapshot);
  },

  addBookingService: (name) => {
    const nm = name.trim();
    if (!nm) return;
    const snapshot = get().booking;
    set((s) => ({ booking: { ...s.booking, services: [...s.booking.services, { name: nm, lane: "repair", triggers: "" }] } }));
    persistBooking(get, set, snapshot);
  },

  removeBookingService: (index) => {
    const snapshot = get().booking;
    set((s) => ({ booking: { ...s.booking, services: s.booking.services.filter((_, i) => i !== index) } }));
    persistBooking(get, set, snapshot);
  },

  setServiceFee: (n) => { const snapshot = get().booking; set((s) => ({ booking: { ...s.booking, serviceFee: Math.max(0, Number(n) || 0) } })); persistBooking(get, set, snapshot); },
  setFeeCredited: (b) => { const snapshot = get().booking; set((s) => ({ booking: { ...s.booking, feeCredited: b } })); persistBooking(get, set, snapshot); },
  setBookingField: (field, value) => { const snapshot = get().booking; set((s) => ({ booking: { ...s.booking, [field]: value } })); persistBooking(get, set, snapshot); },
  setBookingHours: (key, value) => { const snapshot = get().booking; set((s) => ({ booking: { ...s.booking, hours: { ...s.booking.hours, [key]: Math.max(0, Number(value) || 0) } } })); persistBooking(get, set, snapshot); },
  setBookingArea: (field, value) => { const snapshot = get().booking; set((s) => ({ booking: { ...s.booking, area: { ...s.booking.area, [field]: field === "radiusMi" ? Math.max(0, Number(value) || 0) : value } } })); persistBooking(get, set, snapshot); },

  // ---- misc config (scalars → updateConfig) ----
  setVisitDur: (key, minutes) => {
    const snapshot = { visitDur: get().visitDur };
    const hours = clampInt(minutes, 15) / 60;
    set((s) => ({ visitDur: { ...s.visitDur, [key]: hours } }));
    const col = key === "scope" ? "visitScopeMinutes" : key === "repair" ? "visitRepairMinutes" : "visitInstallMinutes";
    void trpcVanilla.v1.settings.updateConfig.mutate({ [col]: Math.round(hours * 60) }).catch(() => set(snapshot));
  },

  setMarkup: (n) => {
    const snapshot = { markup: get().markup };
    const markup = Math.max(0, Number(n) || 0);
    set({ markup });
    void trpcVanilla.v1.settings.updateConfig.mutate({ markupBps: Math.round(markup * 100) }).catch(() => set(snapshot));
  },

  setTrade: (t) => {
    const snapshot = { trade: get().trade };
    set({ trade: t });
    void trpcVanilla.v1.settings.updateConfig.mutate({ trade: t }).catch(() => set(snapshot));
  },

  setToggle: (key, value) => {
    const snapshot = { toggles: get().toggles };
    set((s) => ({ toggles: { ...s.toggles, [key]: value } }));
    const col = key === "techSeesPrice" ? "techSeesPrice" : key === "techTexts" ? "techTexts" : key === "frontDesk" ? "frontDesk" : "scopeOn";
    void trpcVanilla.v1.settings.updateConfig.mutate({ [col]: value }).catch(() => set(snapshot));
  },
});
```

  6. Add the shared `persistBooking` helper above the slice (booking is stored with `hours`/`area` in the store shape but the server's booking jsonb omits them — hours/area are top-level `hours_*`/`area_*` columns, so `persistBooking` sends BOTH the booking blob (services/notServices/serviceFee/feeCredited) and the hours/area scalar columns):

```typescript
type SetFn = (partial: Partial<SettingsSlice> | ((s: SettingsSlice) => Partial<SettingsSlice>)) => void;
type GetFn = () => SettingsSlice;

// Persist the AI Front Desk booking config. The store keeps hours+area nested under `booking`, but
// the server splits them: services/notServices/serviceFee/feeCredited → booking jsonb; hours/area →
// scalar columns. One updateConfig carries both. Rolls back to `snapshot` on failure.
function persistBooking(get: GetFn, set: SetFn, snapshot: BookingCfg): void {
  const b = get().booking;
  void trpcVanilla.v1.settings.updateConfig
    .mutate({
      booking: { services: b.services, notServices: b.notServices, serviceFee: b.serviceFee, feeCredited: b.feeCredited },
      hoursWdOpen: b.hours.wdOpen, hoursWdClose: b.hours.wdClose,
      hoursSatOpen: b.hours.satOpen, hoursSatClose: b.hours.satClose,
      hoursSunOpen: b.hours.sunOpen, hoursSunClose: b.hours.sunClose,
      areaCities: b.area.cities, areaRadiusMi: b.area.radiusMi,
    })
    .catch(() => set({ booking: snapshot }));
}
```

- Step: run the slice test, expected PASS:

```
npx vitest run lib/store/slices/settings-slice.test.ts
```

Expected: all four cases green.

- Step: commit:

```
git add lib/store/slices/settings-slice.ts lib/store/slices/settings-slice.test.ts
git commit -m "feat: persist settings-slice via v1.settings; server ids; drop SEED_* and id counter"
```

---

### Task 8: Store — `SettingsHydrator` + mount in office layout

**Files:**
- Create `features/settings/settings-hydrator.tsx`
- Modify `app/(office)/layout.tsx` (import + mount `<SettingsHydrator />`)

**Interfaces:**
- Consumes: `api.v1.settings.get.useQuery` + `RouterOutputs["v1"]["settings"]["get"]` (Task 6); `useAppStore` `setSettings` (Task 7); `HYDRATOR_STALE_MS`.
- Produces: `SettingsHydrator` component.

> `v1.settings.get` returns a single object (not a paginated list), so this hydrator does NOT use
> `useStoreHydrator` (which is list-shaped). It maps the DTO → store shape and calls `setSettings`
> in a `useEffect`, with the same `refetchOnWindowFocus: false` guard that protects optimistic writes.

- Step: write `features/settings/settings-hydrator.tsx`:

```tsx
"use client";

/**
 * features/settings/settings-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.settings.get and writes the org's
 * configuration into the Zustand store so the Settings page renders real DB data.
 *
 * Unlike list hydrators, settings.get returns a single snapshot object, so this maps the DTO
 * directly and calls setSettings. refetchOnWindowFocus:false so a focus-triggered refetch never
 * clobbers an in-flight optimistic write from a settings-slice action.
 *
 * Unit conversions on the read path: cents → dollars (pricebook r/c, labor rate), bps → percent
 * (markup), minutes → hours (visit durations). These mirror the write-path conversions in
 * settings-slice so a value round-trips unchanged.
 */

import { useEffect } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

type SettingsDTO = RouterOutputs["v1"]["settings"]["get"];

export function SettingsHydrator() {
  const setSettings = useAppStore((s) => s.setSettings);
  const { data, isError, error } = api.v1.settings.get.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:settings] load failed", error);
      }
      return;
    }
    if (!data) return;
    const dto: SettingsDTO = data;
    setSettings({
      pricebook: dto.pricebook.map((p) => ({ id: p.id, d: p.label, r: Math.round(p.unitPriceCents / 100), h: 0, c: Math.round(p.costCents / 100) })),
      laborRates: dto.laborRates.map((r) => ({ id: r.id, name: r.label, rate: Math.round(r.rateCentsPerHour / 100) })),
      terms: dto.terms.map((t) => ({ id: t.id, t: t.title, body: t.body })),
      sources: dto.sources.map((s) => ({ id: s.id, label: s.label })),
      booking: {
        services: dto.config.booking.services,
        notServices: dto.config.booking.notServices,
        serviceFee: dto.config.booking.serviceFee,
        feeCredited: dto.config.booking.feeCredited,
        hours: {
          wdOpen: dto.config.hoursWdOpen, wdClose: dto.config.hoursWdClose,
          satOpen: dto.config.hoursSatOpen, satClose: dto.config.hoursSatClose,
          sunOpen: dto.config.hoursSunOpen, sunClose: dto.config.hoursSunClose,
        },
        area: { cities: dto.config.areaCities, radiusMi: dto.config.areaRadiusMi },
      },
      visitDur: {
        scope: dto.config.visitScopeMinutes / 60,
        repair: dto.config.visitRepairMinutes / 60,
        install: dto.config.visitInstallMinutes / 60,
      },
      markup: Math.round(dto.config.markupBps / 100),
      trade: dto.config.trade,
      toggles: {
        techSeesPrice: dto.config.techSeesPrice,
        techTexts: dto.config.techTexts,
        frontDesk: dto.config.frontDesk,
        scopeOn: dto.config.scopeOn,
      },
    });
  }, [data, isError, error, setSettings]);

  return null;
}
```

- Step: mount it — edit `app/(office)/layout.tsx`. Add the import beside the others:

```tsx
import { SettingsHydrator } from "@/features/settings/settings-hydrator";
```

and add `<SettingsHydrator />` in the hydrator block after `<CompaniesHydrator />`:

```tsx
      <CompaniesHydrator />
      <SettingsHydrator />
```

- Step: typecheck (the hydrator's DTO type must resolve from the wired router):

```
npx tsc --noEmit
```

Expected: 0 errors — `RouterOutputs["v1"]["settings"]["get"]` is now a valid path.

- Step: commit:

```
git add features/settings/settings-hydrator.tsx "app/(office)/layout.tsx"
git commit -m "feat: SettingsHydrator seeds slice from v1.settings.get; mount in office layout"
```

---

### Task 9: Frontend — wire the Settings page controls to the persisting slice

**Files:**
- Modify `app/(office)/settings/page.tsx` — `SecSources`, `SecPricing`, `SecBooking`, `SecPipeline` (visit lengths), `SecWorkspace`/`TeamRolesBlock` (toggles), and the source/pricebook/labor/terms list keys switch from array index to `id`; remove the `SAMPLE_BRAND` import ONLY where it is not needed (branding card stays until Phase 3 — leave `SAMPLE_BRAND` import for the Branding card, which Phase 3 rewrites).

**Interfaces:**
- Consumes: the persisting slice actions with new signatures (Task 7) — `updatePricebookItem(id,…)`, `removePricebookItem(id)`, `updateLaborRate(id,…)`, `removeLaborRate(id)`, `removeTerm(id)`, `removeSource(id)`, and `sources: SourceItem[]`.
- Produces: no new exports; the page persists every edit.

> The toggle controls already call `setToggle` (which now persists — no page change needed there
> beyond confirming). The list-rendering changes are mechanical: use `item.id` as the React key and
> the arg to update/remove instead of the array index. `sources` is now `{id,label}[]`.

- Step: in `SecSources`, change the source list to key/act on `id`:

```tsx
        {sources.length > 0 ? (
          sources.map((s) => {
            const count = leads.filter((l) => l.source === s.label).length;
            return (
              <div key={s.id} className="stage-row">
                <span style={{ fontWeight: 700 }}>{s.label}</span>
                <span className="trig">{count} lead{count === 1 ? "" : "s"}</span>
                <button className="btn sm ghost" onClick={() => removeSource(s.id)}>✕</button>
              </div>
            );
          })
        ) : (
```

- Step: in `SecPricing`, change the pricebook rows to use `p.id` (key + update/remove args) and labor rows to already use `lr.id` (id is now a string — no change to calls, only the type). Pricebook block:

```tsx
          {pricebook.map((p) => (
            <div key={p.id} className="stage-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input type="text" defaultValue={p.d}
                onChange={(e) => updatePricebookItem(p.id, "d", e.target.value)}
                style={{ flex: 1, minWidth: 150, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input type="number" defaultValue={p.r}
                  onChange={(e) => updatePricebookItem(p.id, "r", e.target.value)}
                  style={{ width: 78, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted" style={{ fontSize: 11 }}>cost</span>
                <input type="number" defaultValue={p.c}
                  onChange={(e) => updatePricebookItem(p.id, "c", e.target.value)}
                  style={{ width: 64, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span className="muted" style={{ fontSize: "11.5px", minWidth: 62, textAlign: "right" }}>
                {p.c ? `${pbMarginPct(p)}% margin` : ""}
              </span>
              <button className="btn sm ghost" onClick={() => removePricebookItem(p.id)}>✕</button>
            </div>
          ))}
```

- Step: in `SecPricing`, change the terms rows to key/act on `id`:

```tsx
          {terms.map((t) => (
            <div key={t.id} className="stage-row">
              <span style={{ fontWeight: 700 }}>{t.t}</span>
              <span className="trig" style={{ maxWidth: 280, whiteSpace: "normal" }}>{t.body.slice(0, 60)}…</span>
              <button className="btn sm ghost" onClick={() => removeTerm(t.id)}>✕</button>
            </div>
          ))}
```

- Step: run typecheck + lint to confirm the page compiles against the new signatures:

```
npx tsc --noEmit && npm run lint
```

Expected: 0 type errors; ESLint 0 errors (the `SAMPLE_BRAND` import remains used by the Branding card, so no unused-import error).

- Step: build (SSR compile of the office route with the new hydrator + page):

```
npm run build
```

Expected: `✓ Compiled successfully`; the `/settings` route builds with no error.

- Step: commit:

```
git add "app/(office)/settings/page.tsx"
git commit -m "feat: wire Settings controls to persisting slice (id-keyed lists)"
```

---

### Task 10: Verify the full gate + open the PR

**Files:** none (verification + PR only).

- Step: run the whole gate in sequence and confirm each is green:

```
npx tsc --noEmit
```

Expected: 0 errors.

```
npm run lint
```

Expected: 0 errors (warnings tolerated per repo config; 0 errors required).

```
npx vitest run
```

Expected: all unit + integration suites pass, including `modules/settings/domain/*`, `modules/settings/app/*`, `modules/settings/api/settings-router.int.test.ts` (or cleanly skipped with no DB), and `lib/store/slices/settings-slice.test.ts`.

- Step: run coverage and confirm the repo thresholds (80 statements / 75 branches) hold:

```
npm run coverage
```

Expected: coverage run exits 0 with global thresholds met (80/75). If the booking-persist branch or a rollback branch is under-covered, add the missing case to `settings-slice.test.ts` before proceeding.

- Step: full build (final gate):

```
npm run build
```

Expected: `✓ Compiled successfully`, no type/route errors.

- Step: re-prove RLS on the migrated DB (defense-in-depth check before merge):

```
npm run db:rls-proof
```

Expected: exits 0 — the five settings tables deny cross-org access for the runtime role.

- Step: push the branch and open the PR:

```
git push -u origin phase-2-settings-backend
gh pr create --title "Phase 2: Settings backend" --body "$(cat <<'EOF'
## Summary
- New `modules/settings/` hexagonal module (domain / app / infra / api) mirroring `modules/companies/`.
- Five org-scoped tables (`org_settings`, `pricebook_items`, `labor_rates`, `job_terms`, `lead_sources`) with hand-written RLS (migrations 0043 DDL + 0044 RLS); money in cents, rates in bps, durations in integer minutes; soft-delete on the removable collections; `org_settings` lazily created with sane defaults on first read.
- `v1.settings` router: `get` (config + all four collections in one payload), `updateConfig` (scalars + booking jsonb), per-collection `create/update/remove` (labor keeps a ≥1-rate invariant; sources dedupe case-insensitively). Registered in `trpc/root.ts`.
- `SettingsHydrator` seeds the store from `v1.settings.get`; every `settings-slice` action switched to optimistic → `trpcVanilla.v1.settings.*` → reconcile/rollback. Removed `SEED_*` as source of truth and the `_nextLaborId` counter; collections now carry server ids.
- Settings page controls wired to the persisting slice (id-keyed lists).

## Test plan
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm run lint` — 0 errors
- [x] `npx vitest run` — unit + int green (domain, app use-cases, router int with live RLS + cross-tenant + RBAC, slice persistence)
- [x] `npm run coverage` — 80/75 thresholds met
- [x] `npm run build` — compiles
- [x] `npm run db:rls-proof` — settings tables tenant-isolated
- [ ] Manual: edit a pricebook line / add a source / toggle Front Desk, refresh — values survive (new device / new tab)
EOF
)"
```

Expected: PR created against the default branch; CI (typecheck · lint · unit · int · coverage · build) runs and passes.


## Phase 3: Branding

Make the org's brand identity fully DB-backed so every customer-facing quote and
invoice, plus the pipeline header, renders the org's real name/tagline/site/colour
(instead of the hardcoded `SAMPLE_BRAND` "Rivera Plumbing" / `DEFAULT_BRAND`
"My Business"), and so the Settings → Workspace → Branding card becomes editable
with a working save that survives refresh / new device / new tab.

**Dependency on Phase 2 (hard):** Phase 2 ships the `settings` module and the
`org_settings` table (one row per org, `unique(org_id)`, lazily created on first
`get`), the `v1.settings.get` query (returns the settings row + collections in
one payload for the hydrator), the `v1.settings.updateConfig` mutation, and the
`SettingsHydrator` component at `features/settings/settings-hydrator.tsx`. Phase 3
**extends** the same module and hydrator — it does not create a new module.

Interfaces this phase RELIES ON from Phase 2 (exact names, as specified in the
spec §"Phase 2 — Settings backend"):
- Table `org_settings` in `shared/db/schema/org-settings.ts`, exported from
  `shared/db/schema/index.ts`, with `orgId` FK to `orgs` (`onDelete: cascade`),
  `unique(org_id)`, `created_at`/`updated_at`, and RLS via `current_org_id()`.
- Settings module at `modules/settings/` following the companies hexagon:
  `domain/org-settings.ts` (an `OrgSettings` aggregate with a `patch(...)` +
  `props` accessor, exactly like `Company`), `domain/org-settings-repository.ts`
  (interface with `getOrCreate(orgId)` and `save(settings)`), `infra/`
  (`drizzle-org-settings-repository.ts` + `org-settings-mapper.ts`),
  `app/get-settings.ts` + `app/update-config.ts`, and `api/settings-router.ts` +
  `api/settings-dto.ts` (with `settingsDTO` + `toSettingsDTO`) registered in
  `trpc/root.ts` under `v1.settings`.
- Store: `SettingsHydrator` calls `api.v1.settings.get.useQuery(...)` and writes
  scalars/collections into `settings-slice`.

If any Phase-2 name differs at implementation time, this phase adapts to the real
name; the design contract (brand fields live on `org_settings`, name stays
`orgs.name`) does not change.

**Brand model (locked):** brand *name* is `orgs.name` (already persisted; already
exposed as `v1.identity.me.orgName`). The other five brand fields
(`brand_tagline`, `brand_site`, `brand_color`, `brand_logo_url`, `brand_initials`)
live on `org_settings`. `updateBrand` writes the five to `org_settings` **and**
`orgs.name` inside one org-scoped transaction, so a single save round-trips the
whole `Brand` shape (`{ site, name, initials, color, tagline }` +
`logoUrl?`). Logo image *upload* reuses the Phase-5 storage helper if that phase
has landed; if not, `brand_logo_url` accepts a plain URL string and the file
picker is deferred — text + colour ship regardless (spec §"Phase 3 — Branding").

**Store `Brand` type today** (`lib/store/types.ts` L293–299):
`{ site: string; name: string; initials: string; color: string; tagline: string }`.
Phase 3 adds an optional `logoUrl?: string` to it (Task 6). Both customer modals
(`cust-quote-modal.tsx` L520, `cust-invoice-modal.tsx` L237) and the pipeline
(`app/(office)/pipeline/page.tsx` L29) already read `useAppStore((s) => s.brand)`,
so once the store `brand` is hydrated they render real data with **zero** consumer
changes — this phase only has to (a) add columns, (b) add `updateBrand`, (c)
hydrate + persist `brand` in the store, and (d) make the Branding card editable.

Migrations continue from where Phase 2 stopped. Phase 2 is expected to consume
0043 (the `org_settings` create) and possibly 0043+n for its collection tables;
this plan uses **0044** for the brand-column migration and will renumber to the
next free integer if Phase 2 consumed more than one number (verify with
`ls shared/db/migrations` before generating).

---

### Task 1: Add brand columns to the `org_settings` schema

**Files:**
- Modify: `shared/db/schema/org-settings.ts` (the table Phase 2 created — add five
  columns to the existing `pgTable` definition).
- Test: `shared/db/schema/org-settings.brand.test.ts` (Create).

**Interfaces:**
- Consumes (Phase 2): the `orgSettings` `pgTable` export in
  `shared/db/schema/org-settings.ts`.
- Produces: five new columns on `orgSettings` — `brandTagline` (`text`, nullable),
  `brandSite` (`text`, nullable), `brandColor` (`text`, nullable), `brandLogoUrl`
  (`text`, nullable), `brandInitials` (`text`, nullable). All nullable so the
  Phase-2 lazy-create default row is valid without brand values, and so
  `getOrCreate` never has to invent a brand.

- Step — write the failing test. Create
  `shared/db/schema/org-settings.brand.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { getTableColumns } from "drizzle-orm";
  import { orgSettings } from "./org-settings";

  // Guards the brand columns Phase 3 adds to the Phase-2 org_settings table.
  // Pure schema-shape assertion — no DB needed.
  describe("org_settings brand columns", () => {
    const cols = getTableColumns(orgSettings);

    it.each([
      ["brandTagline", "brand_tagline"],
      ["brandSite", "brand_site"],
      ["brandColor", "brand_color"],
      ["brandLogoUrl", "brand_logo_url"],
      ["brandInitials", "brand_initials"],
    ])("exposes %s mapped to %s (text, nullable)", (prop, dbName) => {
      const col = cols[prop as keyof typeof cols];
      expect(col, `${prop} column missing`).toBeDefined();
      expect(col.name).toBe(dbName);
      expect(col.dataType).toBe("string");
      expect(col.notNull).toBe(false);
    });
  });
  ```

- Step — run it, expected FAIL (columns don't exist yet):
  `npx vitest run shared/db/schema/org-settings.brand.test.ts`
  Expected: `AssertionError: brandTagline column missing` (5 failing cases).

- Step — minimal implementation. In `shared/db/schema/org-settings.ts`, add the
  five columns inside the existing `pgTable("org_settings", { ... })` column
  object (place them after the existing scalar columns, before the timestamps):
  ```typescript
    // ── Brand identity (Phase 3) ─────────────────────────────────────────────
    // Brand NAME is orgs.name (not duplicated here). These are the rest of the
    // brand shown on customer quotes/invoices + the pipeline header. All nullable
    // so the lazily-created default org_settings row is valid without brand values.
    brandTagline: text("brand_tagline"),
    brandSite: text("brand_site"),
    brandColor: text("brand_color"),
    brandLogoUrl: text("brand_logo_url"),
    brandInitials: text("brand_initials"),
  ```
  (`text` is already imported by the Phase-2 file; if not, add it to the
  `drizzle-orm/pg-core` import.)

- Step — run it, expected PASS:
  `npx vitest run shared/db/schema/org-settings.brand.test.ts`
  Expected: `Test Files  1 passed (1)` · `Tests  5 passed (5)`.

- Step — commit:
  ```bash
  git add shared/db/schema/org-settings.ts shared/db/schema/org-settings.brand.test.ts
  git commit -m "feat: add brand columns to org_settings schema"
  ```

---

### Task 2: Generate migration 0044 (brand columns) + hand-add nothing new for RLS

**Files:**
- Create: `shared/db/migrations/0044_<generated_slug>.sql` (via drizzle-kit).
- Modify: `shared/db/migrations/meta/_journal.json` + the new snapshot
  (drizzle-kit writes these — do not hand-edit).

**Interfaces:**
- Consumes: the schema change from Task 1.
- Produces: an applied migration adding `brand_tagline`, `brand_site`,
  `brand_color`, `brand_logo_url`, `brand_initials` to `public.org_settings`.
  **No new RLS statement is needed** — `org_settings` already `ENABLE`/`FORCE`
  RLS with a `FOR ALL` policy keyed on `org_id` from Phase 2, and adding columns
  to an already-protected table inherits the row policy. This is verified below.

- Step — confirm the next free migration number:
  ```bash
  ls shared/db/migrations | grep -E '^[0-9]{4}_' | sort | tail -3
  ```
  Expected: the highest existing number is `0043_*` (Phase 2's `org_settings`
  create). If Phase 2 consumed more than one number, use the next free integer in
  place of `0044` throughout this task.

- Step — generate the migration from the schema diff:
  ```bash
  npm run db:generate
  ```
  Expected output includes a new file line, e.g.
  `[✓] Your SQL migration file ➜ shared/db/migrations/0044_<slug>.sql`
  and 5 `ALTER TABLE "org_settings" ADD COLUMN` statements.

- Step — read the generated SQL to confirm it is exactly five `ADD COLUMN`s and
  no destructive statement. Open `shared/db/migrations/0044_<slug>.sql`; expected
  body (order may vary):
  ```sql
  ALTER TABLE "org_settings" ADD COLUMN "brand_tagline" text;--> statement-breakpoint
  ALTER TABLE "org_settings" ADD COLUMN "brand_site" text;--> statement-breakpoint
  ALTER TABLE "org_settings" ADD COLUMN "brand_color" text;--> statement-breakpoint
  ALTER TABLE "org_settings" ADD COLUMN "brand_logo_url" text;--> statement-breakpoint
  ALTER TABLE "org_settings" ADD COLUMN "brand_initials" text;
  ```
  No RLS block is appended: the columns inherit the Phase-2 `org_settings`
  `FOR ALL USING (org_id = public.current_org_id())` policy. (Reference RLS syntax
  lives in `shared/db/migrations/0038_companies_rls.sql`; nothing to copy here
  because we are altering an already-protected table, not creating one.)

- Step — apply the migration against the test DB:
  ```bash
  npm run db:migrate
  ```
  Expected: no errors; `_journal.json` gains the `0044` entry.

- Step — verify the columns exist and RLS is still forced (adversarial: a bare
  `ADD COLUMN` must not have disabled `FORCE ROW LEVEL SECURITY`). Run:
  ```bash
  psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name='org_settings' and column_name like 'brand_%' order by 1;" \
    -c "select relrowsecurity, relforcerowsecurity from pg_class where relname='org_settings';"
  ```
  Expected: five rows (`brand_color, brand_initials, brand_logo_url, brand_site,
  brand_tagline`) and `relrowsecurity = t`, `relforcerowsecurity = t`.

- Step — commit:
  ```bash
  git add shared/db/migrations/0044_*.sql shared/db/migrations/meta
  git commit -m "feat: migration 0044 — org_settings brand columns"
  ```

---

### Task 3: `OrgSettings` domain — extend with brand + `patchBrand`

**Files:**
- Modify: `modules/settings/domain/org-settings.ts` (the Phase-2 aggregate —
  extend `OrgSettingsProps` + add a `patchBrand` method).
- Test: `modules/settings/domain/org-settings.brand.test.ts` (Create).

**Interfaces:**
- Consumes (Phase 2): the `OrgSettings` class with `OrgSettingsProps`, a private
  constructor, a `static create(props): Result<OrgSettings, ValidationError>`, a
  `patch(...)` for scalars, and a `get props()` accessor (mirrors `Company` at
  `modules/companies/domain/company.ts`).
- Produces on `OrgSettingsProps`: `brandName: string` (mirror of `orgs.name`,
  carried through the aggregate for validation + DTO), `brandTagline: string | null`,
  `brandSite: string | null`, `brandColor: string | null`,
  `brandLogoUrl: string | null`, `brandInitials: string | null`.
- Produces method:
  `patchBrand(fields: BrandPatch, now: Date): Result<OrgSettings, ValidationError>`
  where `BrandPatch = { name?: string; tagline?: string | null; site?: string | null; color?: string | null; logoUrl?: string | null; initials?: string | null }`
  (undefined = keep current; explicit null clears optional fields; `name` cannot
  be blank — it maps to a NOT NULL `orgs.name`).

- Step — write the failing test. Create
  `modules/settings/domain/org-settings.brand.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { isOk } from "@mallet/shared/types";
  import { OrgSettings, type OrgSettingsProps } from "./org-settings";
  import { baseSettingsProps } from "./org-settings.fixtures";

  // baseSettingsProps() returns a valid OrgSettingsProps for the org, with brand
  // fields defaulted (name "My Business", others null). Fixture lives beside the
  // Phase-2 domain test helpers; add it in this task if Phase 2 didn't.
  const make = (o: Partial<OrgSettingsProps> = {}): OrgSettings => {
    const r = OrgSettings.create(baseSettingsProps(o));
    if (!isOk(r)) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
    return r.value;
  };

  describe("OrgSettings.patchBrand", () => {
    const NOW = new Date("2026-07-10T12:00:00Z");

    it("patches all brand fields and stamps updatedAt", () => {
      const r = make().patchBrand(
        { name: "Rivera Plumbing", tagline: "Licensed & insured", site: "riveraplumbing.com", color: "#9C5B34", logoUrl: null, initials: "RP" },
        NOW,
      );
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.props.brandName).toBe("Rivera Plumbing");
        expect(r.value.props.brandTagline).toBe("Licensed & insured");
        expect(r.value.props.brandSite).toBe("riveraplumbing.com");
        expect(r.value.props.brandColor).toBe("#9C5B34");
        expect(r.value.props.brandInitials).toBe("RP");
        expect(r.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
      }
    });

    it("undefined keeps current, explicit null clears optionals", () => {
      const seeded = make({ brandTagline: "old", brandColor: "#111111" });
      const r = seeded.patchBrand({ tagline: null }, NOW); // color untouched
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.props.brandTagline).toBeNull();
        expect(r.value.props.brandColor).toBe("#111111");
      }
    });

    it("rejects a blank brand name (maps to NOT NULL orgs.name)", () => {
      const r = make().patchBrand({ name: "   " }, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("validation");
        expect(r.error.field).toBe("brandName");
      }
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run modules/settings/domain/org-settings.brand.test.ts`
  Expected: fails to compile / `patchBrand is not a function` (and
  `baseSettingsProps` may be missing brand fields).

- Step — minimal implementation. In `modules/settings/domain/org-settings.ts`,
  extend `OrgSettingsProps` with the six brand fields and add `patchBrand`.
  Add to the interface:
  ```typescript
    readonly brandName: string;
    readonly brandTagline: string | null;
    readonly brandSite: string | null;
    readonly brandColor: string | null;
    readonly brandLogoUrl: string | null;
    readonly brandInitials: string | null;
  ```
  Extend the existing `static create` name-invariant block so a blank brand name
  fails with field `"brandName"`:
  ```typescript
    const brandName = props.brandName.trim();
    if (brandName.length === 0) return err(validation("brand name is required", "brandName"));
  ```
  and pass `brandName` (trimmed) into the constructed props. Then add the method
  (place it beside the existing `patch`):
  ```typescript
    // Patch the brand-identity subset. undefined = keep current; explicit null
    // clears an optional field. brandName re-runs the NOT-NULL invariant via create.
    patchBrand(
      fields: {
        name?: string;
        tagline?: string | null;
        site?: string | null;
        color?: string | null;
        logoUrl?: string | null;
        initials?: string | null;
      },
      now: Date,
    ): Result<OrgSettings, ValidationError> {
      return OrgSettings.create({
        ...this.p,
        brandName: fields.name !== undefined ? fields.name : this.p.brandName,
        brandTagline: fields.tagline !== undefined ? fields.tagline : this.p.brandTagline,
        brandSite: fields.site !== undefined ? fields.site : this.p.brandSite,
        brandColor: fields.color !== undefined ? fields.color : this.p.brandColor,
        brandLogoUrl: fields.logoUrl !== undefined ? fields.logoUrl : this.p.brandLogoUrl,
        brandInitials: fields.initials !== undefined ? fields.initials : this.p.brandInitials,
        updatedAt: now,
      });
    }
  ```
  Then create `modules/settings/domain/org-settings.fixtures.ts` (or extend the
  Phase-2 fixture if it exists) so `baseSettingsProps` supplies brand defaults:
  ```typescript
  import { asOrgId, type OrgId } from "@mallet/shared/types";
  import type { OrgSettingsProps } from "./org-settings";

  const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

  // Valid OrgSettingsProps for domain tests. Extend with Phase-2 scalar defaults
  // (trade, markupBps, etc.); this file only guarantees the brand fields are valid.
  export const baseSettingsProps = (o: Partial<OrgSettingsProps> = {}): OrgSettingsProps => ({
    orgId: ORG,
    // …Phase-2 scalar defaults (trade, markupBps, visitDurationHours, toggles,
    //   business hours, booking jsonb) go here…
    brandName: "My Business",
    brandTagline: null,
    brandSite: null,
    brandColor: null,
    brandLogoUrl: null,
    brandInitials: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...o,
  });
  ```

- Step — run it, expected PASS:
  `npx vitest run modules/settings/domain/org-settings.brand.test.ts`
  Expected: `Tests  3 passed (3)`.

- Step — commit:
  ```bash
  git add modules/settings/domain/org-settings.ts modules/settings/domain/org-settings.brand.test.ts modules/settings/domain/org-settings.fixtures.ts
  git commit -m "feat: OrgSettings.patchBrand + brand fields on the aggregate"
  ```

---

### Task 4: `UpdateBrandUseCase` (app layer)

**Files:**
- Create: `modules/settings/app/update-brand.ts`.
- Test: `modules/settings/app/update-brand.test.ts`.

**Interfaces:**
- Consumes: `OrgSettings.patchBrand` (Task 3); the Phase-2
  `OrgSettingsRepository` interface (`domain/org-settings-repository.ts`) with
  `getOrCreate(orgId: string): Promise<OrgSettings>` and
  `save(settings: OrgSettings): Promise<void>`; the shared `Clock`. Because brand
  *name* is `orgs.name`, this use-case also needs to write the name — it does so
  via a narrow port so the app layer stays infra-free.
- Produces:
  - Port `OrgNameWriter` (declared in this file):
    `interface OrgNameWriter { setName(orgId: string, name: string, now: Date): Promise<void>; }`.
  - `UpdateBrandCommand` (below) and `UpdateBrandUseCase` with
    `exec(cmd, orgId): Promise<Result<OrgSettings, AppError>>` — the returned
    `OrgSettings` already carries the reconciled `brandName`.

- Step — write the failing test. Create
  `modules/settings/app/update-brand.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach } from "vitest";
  import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
  import { OrgSettings } from "../domain/org-settings";
  import { baseSettingsProps } from "../domain/org-settings.fixtures";
  import type { OrgSettingsRepository } from "../domain/org-settings-repository";
  import { UpdateBrandUseCase, type OrgNameWriter, type UpdateBrandCommand } from "./update-brand";

  const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

  class FakeSettingsRepo implements OrgSettingsRepository {
    saved: OrgSettings | null = null;
    constructor(private readonly current: OrgSettings) {}
    async getOrCreate(): Promise<OrgSettings> { return this.saved ?? this.current; }
    async save(s: OrgSettings): Promise<void> { this.saved = s; }
  }

  class FakeOrgNameWriter implements OrgNameWriter {
    calls: { orgId: string; name: string }[] = [];
    async setName(orgId: string, name: string): Promise<void> { this.calls.push({ orgId, name }); }
  }

  describe("UpdateBrandUseCase", () => {
    let clock: FixedClock;
    let repo: FakeSettingsRepo;
    let names: FakeOrgNameWriter;
    let useCase: UpdateBrandUseCase;

    beforeEach(() => {
      clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
      const seed = OrgSettings.create(baseSettingsProps());
      if (!isOk(seed)) throw new Error("seed failed");
      repo = new FakeSettingsRepo(seed.value);
      names = new FakeOrgNameWriter();
      useCase = new UpdateBrandUseCase(repo, names, clock);
    });

    it("persists brand fields to org_settings and the name to orgs", async () => {
      const cmd: UpdateBrandCommand = {
        name: "Rivera Plumbing",
        tagline: "Licensed & insured",
        site: "riveraplumbing.com",
        color: "#9C5B34",
        logoUrl: null,
        initials: "RP",
      };
      const r = await useCase.exec(cmd, ORG);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.props.brandName).toBe("Rivera Plumbing");
        expect(r.value.props.brandColor).toBe("#9C5B34");
      }
      expect(repo.saved).not.toBeNull();
      expect(names.calls).toEqual([{ orgId: ORG, name: "Rivera Plumbing" }]);
    });

    it("does not write orgs.name when the command omits name", async () => {
      const r = await useCase.exec({ tagline: "New tagline" }, ORG);
      expect(isOk(r)).toBe(true);
      expect(names.calls).toHaveLength(0);
    });

    it("returns a validation error and writes nothing when name is blank", async () => {
      const r = await useCase.exec({ name: "   " }, ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("validation");
      expect(repo.saved).toBeNull();
      expect(names.calls).toHaveLength(0);
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run modules/settings/app/update-brand.test.ts`
  Expected: module `./update-brand` not found.

- Step — minimal implementation. Create `modules/settings/app/update-brand.ts`:
  ```typescript
  import type { Result, AppError, Clock } from "@mallet/shared/types";
  import { ok } from "@mallet/shared/types";
  import { logger } from "@mallet/shared/observability";
  import type { OrgSettings } from "../domain/org-settings";
  import type { OrgSettingsRepository } from "../domain/org-settings-repository";

  export interface UpdateBrandCommand {
    readonly name?: string;
    readonly tagline?: string | null;
    readonly site?: string | null;
    readonly color?: string | null;
    readonly logoUrl?: string | null;
    readonly initials?: string | null;
  }

  // Narrow port: brand NAME lives on orgs.name, not org_settings. The Drizzle impl
  // (Task 5) updates orgs in the same org-scoped tx; the app layer stays infra-free.
  export interface OrgNameWriter {
    setName(orgId: string, name: string, now: Date): Promise<void>;
  }

  export class UpdateBrandUseCase {
    constructor(
      private readonly settings: OrgSettingsRepository,
      private readonly orgNames: OrgNameWriter,
      private readonly clock: Clock,
    ) {}

    async exec(cmd: UpdateBrandCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
      const current = await this.settings.getOrCreate(orgId);
      const now = this.clock.now();

      const patched = current.patchBrand(
        {
          name: cmd.name,
          tagline: cmd.tagline,
          site: cmd.site,
          color: cmd.color,
          logoUrl: cmd.logoUrl,
          initials: cmd.initials,
        },
        now,
      );
      if (!patched.ok) return patched;

      await this.settings.save(patched.value);
      // Only touch orgs.name when the caller actually sent a name.
      if (cmd.name !== undefined) {
        await this.orgNames.setName(orgId, patched.value.props.brandName, now);
      }

      logger.info({ orgId }, "brand.updated");
      return ok(patched.value);
    }
  }
  ```

- Step — run it, expected PASS:
  `npx vitest run modules/settings/app/update-brand.test.ts`
  Expected: `Tests  3 passed (3)`.

- Step — commit:
  ```bash
  git add modules/settings/app/update-brand.ts modules/settings/app/update-brand.test.ts
  git commit -m "feat: UpdateBrandUseCase persists brand + org name"
  ```

---

### Task 5: Infra — persist brand columns + org name; extend the mapper

**Files:**
- Modify: `modules/settings/infra/drizzle-org-settings-repository.ts` (add brand
  columns to the `save` `.set({...})` and to `getOrCreate`'s default insert; add a
  `setName` method that satisfies `OrgNameWriter`).
- Modify: `modules/settings/infra/org-settings-mapper.ts` (map the new brand
  columns row↔domain).
- Test: covered by the router integration test in Task 6 (infra has no isolated
  unit test in this hexagon — same as `DrizzleCompanyRepository`, which is only
  exercised through `company-router.int.test.ts`).

**Interfaces:**
- Consumes: the `orgSettings` table with brand columns (Task 1), the extended
  `OrgSettings` aggregate (Task 3), `OrgNameWriter` (Task 4), the Phase-2
  `TenantTx` constructor arg + `orgId`.
- Produces: `DrizzleOrgSettingsRepository` now implements both
  `OrgSettingsRepository` and `OrgNameWriter` (single class, injected twice in the
  router). `toDomain` reconstructs the six brand fields.

- Step — extend the mapper. In `modules/settings/infra/org-settings-mapper.ts`,
  add the brand fields to the `OrgSettings.create({...})` call in `toDomain`
  (brand name comes from a joined `orgs.name`, passed in by the repo — see next
  step; the mapper takes it as a second argument):
  ```typescript
  export const toDomain = (row: OrgSettingsRow, orgName: string): OrgSettings => {
    const result = OrgSettings.create({
      orgId: asOrgId(row.orgId),
      // …Phase-2 scalar fields…
      brandName: orgName,
      brandTagline: row.brandTagline,
      brandSite: row.brandSite,
      brandColor: row.brandColor,
      brandLogoUrl: row.brandLogoUrl,
      brandInitials: row.brandInitials,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    if (!result.ok) throw new Error(`corrupt org_settings ${row.orgId}: ${result.error.message}`);
    return result.value;
  };
  ```

- Step — extend the repository. In
  `modules/settings/infra/drizzle-org-settings-repository.ts`:
  1. In `getOrCreate`, after selecting/creating the `org_settings` row, join the
     org name so `toDomain(row, orgName)` can be called:
     ```typescript
     import { orgs, orgSettings } from "@mallet/shared/db/schema";
     // …
     const [org] = await this.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, this.orgId)).limit(1);
     const orgName = org?.name ?? "My Business";
     return toDomain(row, orgName);
     ```
     (The default-insert branch stamps only `orgId`; the brand columns default to
     NULL — the aggregate's `brandName` comes from `orgs.name`, never from the
     settings row.)
  2. In `save`, add the five brand columns to the existing `.set({...})`:
     ```typescript
     .set({
       // …Phase-2 scalar columns…
       brandTagline: p.brandTagline,
       brandSite: p.brandSite,
       brandColor: p.brandColor,
       brandLogoUrl: p.brandLogoUrl,
       brandInitials: p.brandInitials,
       updatedAt: p.updatedAt,
     })
     ```
     (`save` does NOT write `orgs.name` — that is `setName`'s job; `save` never
     touches the `orgs` table, keeping the two writes explicit.)
  3. Add the `OrgNameWriter` method to the class:
     ```typescript
     // Brand NAME lives on orgs.name. Guarded by RLS + explicit org_id; the
     // caller only reaches here for its own org (org id from the principal).
     async setName(orgId: string, name: string, now: Date): Promise<void> {
       await this.tx
         .update(orgs)
         .set({ name })
         .where(eq(orgs.id, orgId));
       // now is accepted for signature symmetry with the port; orgs has no updatedAt.
     }
     ```
     Update the `class DrizzleOrgSettingsRepository implements OrgSettingsRepository`
     declaration to `implements OrgSettingsRepository, OrgNameWriter`.

- Step — typecheck the module in isolation (no isolated infra test; the router
  int test in Task 6 exercises it end-to-end):
  `npx tsc --noEmit`
  Expected: no errors.

- Step — commit:
  ```bash
  git add modules/settings/infra/drizzle-org-settings-repository.ts modules/settings/infra/org-settings-mapper.ts
  git commit -m "feat: persist brand columns + org name in settings repository"
  ```

---

### Task 6: `v1.settings.updateBrand` router procedure + extend `settingsDTO` with brand

**Files:**
- Modify: `modules/settings/api/settings-dto.ts` (add a `brand` object to
  `settingsDTO` + populate it in `toSettingsDTO`).
- Modify: `modules/settings/api/settings-router.ts` (add the `updateBrand`
  mutation; it returns the full `settingsDTO` so the store reconciles brand +
  everything in one shot).
- Modify: `modules/settings/api/settings-router.int.test.ts` (add brand cases —
  create the file only if Phase 2 did not).

**Interfaces:**
- Consumes: `UpdateBrandUseCase` + `OrgNameWriter` (Task 4),
  `DrizzleOrgSettingsRepository` (Task 5), `ownerOrOffice` procedure builder
  (`trpc/init.ts` L73), `orThrow` (`trpc/errors.ts`), the Phase-2
  `GetSettingsUseCase` / `settingsDTO` / `toSettingsDTO`.
- Produces: `v1.settings.updateBrand` mutation. Input DTO `updateBrandInput`;
  output the full `settingsDTO`, whose `brand` object is
  `{ name: string; tagline: string | null; site: string | null; color: string | null; logoUrl: string | null; initials: string | null }`.

- Step — extend `settings-dto.ts`. Add to the `settingsDTO` object:
  ```typescript
  export const brandDTO = z.object({
    name: z.string(),
    tagline: z.string().nullable(),
    site: z.string().nullable(),
    color: z.string().nullable(),
    logoUrl: z.string().nullable(),
    initials: z.string().nullable(),
  });
  ```
  add `brand: brandDTO,` to `settingsDTO`, and in `toSettingsDTO(settings)` add:
  ```typescript
    brand: {
      name: p.brandName,
      tagline: p.brandTagline,
      site: p.brandSite,
      color: p.brandColor,
      logoUrl: p.brandLogoUrl,
      initials: p.brandInitials,
    },
  ```
  (where `const p = settings.props;` already exists in the Phase-2 mapper).

- Step — write the failing integration test cases. Append to
  `modules/settings/api/settings-router.int.test.ts` (reuse the Phase-2
  `ctxFor` / org bootstrap; the block below assumes the same `hasDb` gate and
  admin `Sql` used by `company-router.int.test.ts`):
  ```typescript
  describe("v1.settings.updateBrand", () => {
    it("owner updates brand; get returns it and orgs.name reflects the name", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const updated = await caller.v1.settings.updateBrand({
        name: "Rivera Plumbing",
        tagline: "Licensed & insured",
        site: "riveraplumbing.com",
        color: "#9C5B34",
        initials: "RP",
      });
      expect(updated.brand.name).toBe("Rivera Plumbing");
      expect(updated.brand.color).toBe("#9C5B34");

      const fetched = await caller.v1.settings.get();
      expect(fetched.brand.name).toBe("Rivera Plumbing");
      expect(fetched.brand.tagline).toBe("Licensed & insured");

      const me = await caller.v1.identity.me();
      expect(me.orgName).toBe("Rivera Plumbing");
    });

    it("rejects a blank brand name with BAD_REQUEST", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await expect(
        caller.v1.settings.updateBrand({ name: "   " }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("a tech is forbidden from updateBrand", async () => {
      const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      await expect(
        callerTech.v1.settings.updateBrand({ name: "Nope" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("org B cannot read org A's brand (RLS isolation)", async () => {
      const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await callerA.v1.settings.updateBrand({ name: "Org A Plumbing", color: "#123456" });
      const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
      const bSettings = await callerB.v1.settings.get(); // lazily creates B's own row
      expect(bSettings.brand.color).not.toBe("#123456");
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run modules/settings/api/settings-router.int.test.ts`
  Expected: `v1.settings.updateBrand is not a function` (or type error on
  `updated.brand`).

- Step — minimal implementation. In `modules/settings/api/settings-router.ts`,
  add the input schema and the procedure inside the existing `router({ ... })`:
  ```typescript
  const updateBrandInput = z.object({
    name: z.string().min(1).max(200).optional(),
    tagline: z.string().max(500).nullable().optional(),
    site: z.string().max(2048).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    logoUrl: z.string().max(2048).nullable().optional(),
    initials: z.string().max(8).nullable().optional(),
  });
  // …inside the router:
    updateBrand: ownerOrOffice
      .input(updateBrandInput)
      .output(settingsDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleOrgSettingsRepository(ctx.tx, ctx.principal.orgId);
        // repo implements OrgSettingsRepository AND OrgNameWriter — inject it for both.
        const useCase = new UpdateBrandUseCase(repo, repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            name: input.name,
            tagline: input.tagline,
            site: input.site,
            color: input.color,
            logoUrl: input.logoUrl,
            initials: input.initials,
          },
          ctx.principal.orgId,
        );
        orThrow(result);
        // Return the FULL settings payload (brand + scalars + collections) so the
        // store reconciles everything from one response — same shape as get().
        const getUseCase = new GetSettingsUseCase(repo);
        const settings = await getUseCase.exec(ctx.principal.orgId);
        return toSettingsDTO(settings);
      }),
  ```
  Add the imports at the top of the router:
  `import { UpdateBrandUseCase } from "../app/update-brand";` (the `GetSettingsUseCase`,
  `DrizzleOrgSettingsRepository`, `settingsDTO`, `toSettingsDTO`, `z`, `ownerOrOffice`,
  `orThrow`, `router` are already imported by Phase 2).

- Step — run it, expected PASS (requires `APP_DATABASE_URL` + `DATABASE_URL`):
  `npx vitest run modules/settings/api/settings-router.int.test.ts`
  Expected: `Tests <n> passed` including the four brand cases. If the DB env is
  unset the suite is `describe.skip`ped (same gate as companies) and reports
  `0 passed / skipped` — CI provides the DB.

- Step — commit:
  ```bash
  git add modules/settings/api/settings-router.ts modules/settings/api/settings-dto.ts modules/settings/api/settings-router.int.test.ts
  git commit -m "feat: v1.settings.updateBrand + brand on settingsDTO"
  ```

---

### Task 7: Store — add `logoUrl` to `Brand`, `setBrand`/`updateBrand`, drop DEFAULT_BRAND as runtime value

**Files:**
- Modify: `lib/store/types.ts` (L293–299 — add optional `logoUrl?: string` to
  `Brand`).
- Modify: `lib/store/slices/data-slice.ts` (add `setBrand` + `updateBrand`; keep
  `DEFAULT_BRAND` only as the pre-hydration placeholder, not written by any save).
- Test: `lib/store/slices/data-slice.brand.test.ts` (Create).

**Interfaces:**
- Consumes: `trpcVanilla.v1.settings.updateBrand.mutate` (Task 6); the existing
  `DataSlice` + `Brand` type; the optimistic→persist→reconcile/rollback pattern
  from `addCompany`/`updateCompany` in the same file (L63–142).
- Produces on `DataSlice`:
  - `setBrand: (brand: Brand) => void` — replace the whole brand (called by the
    hydrator, Task 8).
  - `updateBrand: (patch: Partial<Brand>) => void` — optimistic patch → persist
    via `v1.settings.updateBrand.mutate` → reconcile from the returned
    `settingsDTO.brand` → rollback on error.

- Step — write the failing test. Create
  `lib/store/slices/data-slice.brand.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach, vi } from "vitest";
  import { createStore } from "zustand";
  import { createDataSlice, type DataSlice } from "./data-slice";
  import { trpcVanilla } from "@/lib/trpc/vanilla";

  vi.mock("@/lib/trpc/vanilla", () => ({
    trpcVanilla: { v1: { settings: { updateBrand: { mutate: vi.fn() } }, companies: { create: { mutate: vi.fn() }, update: { mutate: vi.fn() } } } },
  }));

  const flush = () => new Promise((r) => setTimeout(r, 0));

  describe("data-slice brand actions", () => {
    let store: ReturnType<typeof createStore<DataSlice>>;
    beforeEach(() => {
      vi.clearAllMocks();
      store = createStore<DataSlice>()((set, get, api) => createDataSlice(set, get, api));
    });

    it("setBrand replaces the whole brand", () => {
      store.getState().setBrand({ name: "Rivera", initials: "RP", color: "#9C5B34", site: "r.com", tagline: "tg" });
      expect(store.getState().brand.name).toBe("Rivera");
      expect(store.getState().brand.color).toBe("#9C5B34");
    });

    it("updateBrand optimistically patches, then reconciles from the DTO", async () => {
      (trpcVanilla.v1.settings.updateBrand.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
        brand: { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#000000", logoUrl: null, initials: "RP" },
      });
      store.getState().updateBrand({ color: "#111111" });
      // Optimistic value applied synchronously.
      expect(store.getState().brand.color).toBe("#111111");
      await flush();
      // Server canonical value reconciled (server normalised colour).
      expect(store.getState().brand.color).toBe("#000000");
      expect(store.getState().brand.name).toBe("Rivera Plumbing");
      expect(trpcVanilla.v1.settings.updateBrand.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#111111" }),
      );
    });

    it("updateBrand rolls back to the snapshot on error", async () => {
      store.getState().setBrand({ name: "Keep", initials: "KP", color: "#abcabc", site: "keep.com", tagline: "safe" });
      (trpcVanilla.v1.settings.updateBrand.mutate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
      store.getState().updateBrand({ name: "Doomed" });
      expect(store.getState().brand.name).toBe("Doomed"); // optimistic
      await flush();
      expect(store.getState().brand.name).toBe("Keep"); // rolled back
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run lib/store/slices/data-slice.brand.test.ts`
  Expected: `setBrand is not a function`.

- Step — add `logoUrl` to the `Brand` type. In `lib/store/types.ts` change:
  ```typescript
  export interface Brand {
    site: string;
    name: string;
    initials: string;
    color: string;
    tagline: string;
    logoUrl?: string;
  }
  ```

- Step — minimal implementation in `lib/store/slices/data-slice.ts`. Add to the
  `DataSlice` interface:
  ```typescript
    /** Replace the whole brand — called by BrandHydrator on hydration. */
    setBrand: (brand: Brand) => void;
    /**
     * Optimistically patch the brand, then persist via v1.settings.updateBrand.
     * Reconciles from the returned settingsDTO.brand; rolls back on error.
     */
    updateBrand: (patch: Partial<Brand>) => void;
  ```
  Add to the slice body (after `setTechs`):
  ```typescript
    setBrand: (brand) => set({ brand }),

    updateBrand: (patch) => {
      const snapshot = get().brand;
      // Optimistic — the Branding card + customer surfaces reflect it immediately.
      set((s) => ({ brand: { ...s.brand, ...patch } }));

      void trpcVanilla.v1.settings.updateBrand
        .mutate({
          name: patch.name,
          tagline: patch.tagline ?? null,
          site: patch.site ?? null,
          color: patch.color ?? null,
          logoUrl: patch.logoUrl ?? null,
          initials: patch.initials ?? null,
        })
        .then((dto) => {
          const b = dto.brand;
          // Reconcile to the server's canonical brand (name from orgs.name, etc.).
          set({
            brand: {
              name: b.name,
              tagline: b.tagline ?? "",
              site: b.site ?? "",
              color: b.color ?? "",
              initials: b.initials ?? "",
              logoUrl: b.logoUrl ?? undefined,
            },
          });
        })
        .catch(() => {
          // Rollback to the pre-mutation snapshot.
          set({ brand: snapshot });
        });
    },
  ```
  Leave `DEFAULT_BRAND` in place as the *pre-hydration placeholder only*
  (`brand: { ...DEFAULT_BRAND }` initial value stays) but update its comment to
  make clear it is never persisted:
  ```typescript
  // Placeholder shown ONLY until BrandHydrator seeds the real brand from
  // v1.settings.get + v1.identity.me. Never written back to the DB.
  const DEFAULT_BRAND: Brand = {
    site: "",
    name: "My Business",
    initials: "MB",
    color: "#6B7280",
    tagline: "",
  };
  ```

- Step — run it, expected PASS:
  `npx vitest run lib/store/slices/data-slice.brand.test.ts`
  Expected: `Tests  3 passed (3)`.

- Step — commit:
  ```bash
  git add lib/store/types.ts lib/store/slices/data-slice.ts lib/store/slices/data-slice.brand.test.ts
  git commit -m "feat: setBrand/updateBrand store actions (optimistic + persist)"
  ```

---

### Task 8: `BrandHydrator` — seed store `brand` from `v1.settings.get` + `v1.identity.me`

**Files:**
- Create: `features/settings/brand-hydrator.tsx`.
- Modify: `app/(office)/layout.tsx` (mount `<BrandHydrator />` alongside the other
  hydrators, L47).
- Test: `features/settings/brand-hydrator.test.tsx` (Create).

**Interfaces:**
- Consumes: `api.v1.settings.get.useQuery` (Phase 2), `api.v1.identity.me.useQuery`
  (`orgName`), `useAppStore((s) => s.setBrand)` (Task 7), `HYDRATOR_STALE_MS`
  (`lib/store/hydrator-config.ts`). The brand *name* comes from `me.orgName`
  because `settings.get.brand.name` also derives from `orgs.name` — either source
  is authoritative; we take `me.orgName` so the greeting name and brand name never
  diverge on the client.
- Produces: `<BrandHydrator />`. A dedicated hydrator (not folded into a shared
  `useStoreHydrator`) because brand is a single object, not a paginated list — the
  `useStoreHydrator` hook (`lib/store/use-store-hydrator.ts`) is list-shaped
  (`{ items, nextCursor }`) and does not fit a scalar.

- Step — write the failing test. Create
  `features/settings/brand-hydrator.test.tsx`:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render } from "@testing-library/react";
  import { BrandHydrator } from "./brand-hydrator";

  const setBrand = vi.fn();
  vi.mock("@/lib/store/app-store", () => ({
    useAppStore: (sel: (s: { setBrand: typeof setBrand }) => unknown) => sel({ setBrand }),
  }));

  const getQuery = vi.fn();
  const meQuery = vi.fn();
  vi.mock("@/lib/trpc/client", () => ({
    api: {
      v1: {
        settings: { get: { useQuery: () => getQuery() } },
        identity: { me: { useQuery: () => meQuery() } },
      },
    },
  }));

  describe("BrandHydrator", () => {
    beforeEach(() => vi.clearAllMocks());

    it("writes brand to the store when both queries resolve", () => {
      getQuery.mockReturnValue({
        data: { brand: { name: "ignored", tagline: "Licensed", site: "r.com", color: "#9C5B34", logoUrl: null, initials: "RP" } },
        isError: false, error: null,
      });
      meQuery.mockReturnValue({ data: { orgName: "Rivera Plumbing" }, isError: false, error: null });

      render(<BrandHydrator />);

      expect(setBrand).toHaveBeenCalledWith({
        name: "Rivera Plumbing", // from me.orgName, not settings.brand.name
        tagline: "Licensed",
        site: "r.com",
        color: "#9C5B34",
        initials: "RP",
        logoUrl: undefined,
      });
    });

    it("does not write until both queries have data", () => {
      getQuery.mockReturnValue({ data: undefined, isError: false, error: null });
      meQuery.mockReturnValue({ data: { orgName: "X" }, isError: false, error: null });
      render(<BrandHydrator />);
      expect(setBrand).not.toHaveBeenCalled();
    });

    it("does not throw on query error", () => {
      getQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("boom") });
      meQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("boom") });
      expect(() => render(<BrandHydrator />)).not.toThrow();
      expect(setBrand).not.toHaveBeenCalled();
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run features/settings/brand-hydrator.test.tsx`
  Expected: cannot find module `./brand-hydrator`.

- Step — minimal implementation. Create `features/settings/brand-hydrator.tsx`:
  ```typescript
  "use client";

  /**
   * features/settings/brand-hydrator.tsx
   * Mounts in the office layout. Seeds the store `brand` from v1.settings.get
   * (tagline/site/color/logo/initials) + v1.identity.me (orgName → brand.name).
   * Both customer modals and the pipeline already read useAppStore(s => s.brand),
   * so once this runs they render the org's real brand — no consumer changes.
   *
   * brand is a single object (not a paginated list), so this does not use the
   * shared useStoreHydrator hook (which is {items,nextCursor}-shaped).
   */

  import { useEffect } from "react";
  import { api } from "@/lib/trpc/client";
  import { useAppStore } from "@/lib/store/app-store";
  import type { Brand } from "@/lib/store/types";
  import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

  export function BrandHydrator() {
    const setBrand = useAppStore((s) => s.setBrand);

    // refetchOnWindowFocus: false — a background refetch must not clobber an
    // optimistic updateBrand the user just made (same guard as EstimatesHydrator).
    const settings = api.v1.settings.get.useQuery(undefined, {
      staleTime: HYDRATOR_STALE_MS,
      refetchOnWindowFocus: false,
    });
    const me = api.v1.identity.me.useQuery(undefined, {
      staleTime: HYDRATOR_STALE_MS,
      refetchOnWindowFocus: false,
    });

    const settingsData = settings.data;
    const orgName = me.data?.orgName;

    useEffect(() => {
      if (settings.isError || me.isError) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[hydrator:brand] load failed", settings.error ?? me.error);
        }
        return;
      }
      if (!settingsData || orgName === undefined) return;

      const b = settingsData.brand;
      const brand: Brand = {
        name: orgName,
        tagline: b.tagline ?? "",
        site: b.site ?? "",
        color: b.color ?? "",
        initials: b.initials ?? "",
        logoUrl: b.logoUrl ?? undefined,
      };
      setBrand(brand);
    }, [settingsData, orgName, settings.isError, me.isError, settings.error, me.error, setBrand]);

    return null;
  }
  ```

- Step — run it, expected PASS:
  `npx vitest run features/settings/brand-hydrator.test.tsx`
  Expected: `Tests  3 passed (3)`.

- Step — mount it. In `app/(office)/layout.tsx`, add the import beside the other
  hydrator imports (after L17):
  ```typescript
  import { BrandHydrator } from "@/features/settings/brand-hydrator";
  ```
  and add the element after `<CompaniesHydrator />` (L47):
  ```tsx
        <CompaniesHydrator />
        <BrandHydrator />
  ```

- Step — commit:
  ```bash
  git add features/settings/brand-hydrator.tsx features/settings/brand-hydrator.test.tsx "app/(office)/layout.tsx"
  git commit -m "feat: BrandHydrator seeds store brand from settings + me"
  ```

---

### Task 9: Settings page — replace `SAMPLE_BRAND` with real editable fields + working save

**Files:**
- Modify: `app/(office)/settings/page.tsx` — remove the `SAMPLE_BRAND` import
  (L20) and rewrite `SecWorkspace`'s Branding `FoldCard` (L88–104) to read
  `useAppStore((s) => s.brand)` and write via `updateBrand`.
- Test: `app/(office)/settings/branding-card.test.tsx` (Create) — renders the
  extracted Branding card and asserts edit→save calls `updateBrand`.

**Interfaces:**
- Consumes: `useAppStore((s) => s.brand)` + `useAppStore((s) => s.updateBrand)`
  (Task 7); the hydrated brand from `BrandHydrator` (Task 8).
- Produces: an editable Branding card. To keep it unit-testable in isolation and
  the file focused (coding-style: many small files), extract the card into
  `app/(office)/settings/branding-card.tsx` exporting `BrandingCard`, and have
  `SecWorkspace` render `<BrandingCard />` instead of the inline block.

- Step — write the failing test. Create
  `app/(office)/settings/branding-card.test.tsx`:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { BrandingCard } from "./branding-card";

  const updateBrand = vi.fn();
  let brand = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };

  vi.mock("@/lib/store/app-store", () => ({
    useAppStore: (sel: (s: { brand: typeof brand; updateBrand: typeof updateBrand }) => unknown) =>
      sel({ brand, updateBrand }),
  }));

  describe("BrandingCard", () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it("renders the hydrated brand (name + tagline), not SAMPLE_BRAND", () => {
      render(<BrandingCard />);
      expect(screen.getByDisplayValue("Rivera Plumbing")).toBeTruthy();
      expect(screen.getByDisplayValue("Licensed")).toBeTruthy();
      // The prototype placeholder must NOT appear.
      expect(screen.queryByDisplayValue("My Business")).toBeNull();
    });

    it("editing a field and saving calls updateBrand with the patch", () => {
      render(<BrandingCard />);
      fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Rivera Plumbing Co" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(updateBrand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Rivera Plumbing Co" }),
      );
    });

    it("does not save a blank business name", () => {
      render(<BrandingCard />);
      fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(updateBrand).not.toHaveBeenCalled();
    });
  });
  ```

- Step — run it, expected FAIL:
  `npx vitest run "app/(office)/settings/branding-card.test.tsx"`
  Expected: cannot find module `./branding-card`.

- Step — minimal implementation. Create
  `app/(office)/settings/branding-card.tsx`:
  ```typescript
  "use client";

  /**
   * Settings → Workspace → Branding card. Reads the hydrated store `brand`
   * (BrandHydrator seeds it) and persists edits via updateBrand (optimistic +
   * v1.settings.updateBrand). Replaces the prototype's SAMPLE_BRAND no-op save.
   * Logo image upload is deferred to the Phase-5 storage helper; brand_logo_url
   * accepts a URL string here so text + colour ship now.
   */

  import { useState } from "react";
  import { useAppStore } from "@/lib/store/app-store";

  const inputStyle = {
    flex: 1, minWidth: 160, border: "1.5px solid var(--line)", borderRadius: 8,
    padding: "8px 10px", fontFamily: "inherit", fontSize: 13,
  } as const;

  export function BrandingCard() {
    const brand = useAppStore((s) => s.brand);
    const updateBrand = useAppStore((s) => s.updateBrand);

    // Draft mirrors the store brand; edits are local until Save (so an optimistic
    // reconcile mid-typing does not yank the field out from under the user).
    const [name, setName] = useState(brand.name);
    const [tagline, setTagline] = useState(brand.tagline);
    const [site, setSite] = useState(brand.site);
    const [color, setColor] = useState(brand.color);
    const [initials, setInitials] = useState(brand.initials);
    const [saved, setSaved] = useState(false);

    function handleSave() {
      const trimmed = name.trim();
      if (!trimmed) return; // brand name maps to NOT NULL orgs.name
      updateBrand({
        name: trimmed,
        tagline: tagline.trim() || "",
        site: site.trim() || "",
        color: color || "",
        initials: (initials.trim() || trimmed.slice(0, 2)).toUpperCase(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }

    return (
      <div className="foldcard open">
        <div className="fhead">
          <span className="caret">▸</span>
          <h3>Branding</h3>
          <span className="fsum">{name}</span>
        </div>
        <div className="fbody">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div className="custlogo" style={{ background: color, color: "#fff" }}>
              {(initials || name.slice(0, 2)).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{name}</b>
              <div className="muted" style={{ fontSize: 12 }}>
                {tagline}{tagline && site ? " · " : ""}{site}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="brandName">Business name</label>
              <input id="brandName" type="text" value={name}
                onChange={(e) => { setName(e.target.value); setSaved(false); }} style={inputStyle} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="brandTagline">Tagline</label>
              <input id="brandTagline" type="text" value={tagline}
                onChange={(e) => { setTagline(e.target.value); setSaved(false); }}
                placeholder="Licensed &amp; insured · Your city" style={inputStyle} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="brandSite">Website</label>
              <input id="brandSite" type="text" value={site}
                onChange={(e) => { setSite(e.target.value); setSaved(false); }}
                placeholder="yourbusiness.com" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="brandColor">Brand colour</label>
                <input id="brandColor" type="color" value={color || "#6B7280"}
                  onChange={(e) => { setColor(e.target.value); setSaved(false); }}
                  style={{ width: 56, height: 34, border: "1.5px solid var(--line)", borderRadius: 8, padding: 2 }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="brandInitials">Logo initials</label>
                <input id="brandInitials" type="text" maxLength={3} value={initials}
                  onChange={(e) => { setInitials(e.target.value); setSaved(false); }}
                  style={{ width: 72, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button className="btn primary" onClick={handleSave} disabled={!name.trim()}>Save</button>
            {saved && <span style={{ color: "var(--green-900)", fontSize: 12, fontWeight: 600 }}>Saved ✓</span>}
          </div>
          <p className="muted" style={{ fontSize: "11.5px", marginTop: 8 }}>
            This is what customers see on every quote &amp; invoice. Logo image upload is coming;
            for now the coloured initials stand in.
          </p>
        </div>
      </div>
    );
  }
  ```

- Step — run it, expected PASS:
  `npx vitest run "app/(office)/settings/branding-card.test.tsx"`
  Expected: `Tests  3 passed (3)`.

- Step — wire it into the page and delete the sample import. In
  `app/(office)/settings/page.tsx`:
  1. Remove the import `import { SAMPLE_BRAND } from "@/lib/prototype-sample";`
     (L20).
  2. Add `import { BrandingCard } from "./branding-card";` with the other local
     imports.
  3. Replace the inline Branding `FoldCard` block (L88–104) with `<BrandingCard />`
     so `SecWorkspace` returns:
     ```tsx
       return (
         <>
           <BrandingCard />

           <FoldCard title="Guided demos" summary="replay">
             {/* …unchanged… */}
           </FoldCard>
           {/* …rest unchanged… */}
         </>
       );
     ```

- Step — verify no `SAMPLE_BRAND` reference remains anywhere in shipped screens
  (spec §Global constraint: no prototype-sample as a source of truth):
  ```bash
  grep -rn "SAMPLE_BRAND\|DEFAULT_BRAND" app components features | grep -v ".test."
  ```
  Expected: the only match is `DEFAULT_BRAND` inside `lib/store/slices/data-slice.ts`
  used solely as the pre-hydration placeholder initial value (allowed — it is not
  the prototype-sample import and is never persisted). Zero `SAMPLE_BRAND` matches.

- Step — commit:
  ```bash
  git add "app/(office)/settings/page.tsx" "app/(office)/settings/branding-card.tsx" "app/(office)/settings/branding-card.test.tsx"
  git commit -m "feat: editable Branding card wired to hydrated brand + save"
  ```

---

### Task 10: Confirm quote/invoice/pipeline consumers render the hydrated brand (regression guard)

**Files:**
- Test: `components/modals/cust-brand-consumers.test.tsx` (Create) — a focused
  regression test proving the two customer modals read the store `brand`, so a
  hydrated brand flows through with no consumer edit.
- No source edits: `cust-quote-modal.tsx` (L520), `cust-invoice-modal.tsx` (L237),
  and `pipeline/page.tsx` (L29) already read `useAppStore((s) => s.brand)` /
  `.brand.name` — this task only locks that in with a test so a future refactor
  cannot silently re-point them at a constant.

**Interfaces:**
- Consumes: the store `brand` (hydrated in Task 8); the modals' exported
  `CustQuoteModalContent` / `CustInvoiceModalContent` bodies.
- Produces: a regression test; no new runtime surface.

- Step — write the test (it should PASS immediately — the consumers already read
  the store; this codifies the invariant). Create
  `components/modals/cust-brand-consumers.test.tsx`:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { CustQuoteModalContent } from "./cust-quote-modal";

  // A brand that is unmistakably NOT the prototype sample.
  const HYDRATED = { name: "Hydrated HVAC", initials: "HH", color: "#123456", site: "hydrated.example", tagline: "From the DB" };

  const state = {
    brand: HYDRATED,
    estimates: [{ id: "e1", num: "Q-1", leadId: "l1", title: "Quote", status: "sent", age: 0, viewed: true, fu: { on: false, stage: 0 }, lines: [], reads: [], archived: false, trash: false }],
    leads: [{ id: "l1", name: "Cust", job: "Repair", source: "web" }],
    updateEstimate: vi.fn(), declineEstimate: vi.fn(), moveLeadStage: vi.fn(), updateLead: vi.fn(),
    recordRead: vi.fn(), endRead: vi.fn(),
  };

  vi.mock("@/lib/store/app-store", () => ({
    useAppStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
    useActiveModal: () => ({ id: "custQuote", params: { estId: "e1" } }),
  }));

  describe("customer quote surface renders the hydrated brand", () => {
    it("shows the store brand name, never SAMPLE_BRAND", () => {
      render(<CustQuoteModalContent />);
      expect(screen.getByText("Hydrated HVAC")).toBeTruthy();
      expect(screen.queryByText("Rivera Plumbing")).toBeNull();
    });
  });
  ```
  (If the modal's exact store selectors need more of `state` to render, extend the
  mocked `state` to match the fields the component reads — the load-bearing
  assertion is that `brand.name` comes from the store.)

- Step — run it, expected PASS:
  `npx vitest run "components/modals/cust-brand-consumers.test.tsx"`
  Expected: `Tests  1 passed (1)`. If it fails because the component reads an
  additional selector, add that field to `state` (test-only) until it renders —
  do NOT edit the component.

- Step — commit:
  ```bash
  git add "components/modals/cust-brand-consumers.test.tsx"
  git commit -m "test: lock customer surfaces to the hydrated store brand"
  ```

---

### Task 11: Verify the full repo gate + open the PR

**Files:** none (verification + PR only).

**Interfaces:** consumes everything above.

- Step — typecheck the whole repo:
  `npx tsc --noEmit`
  Expected: no output (exit 0). If a Phase-2 name differed (e.g. the settings DTO
  field is `businessHours` vs `hours`), fix the reference now and re-run.

- Step — lint, 0 errors:
  `npm run lint`
  Expected: `✔ No ESLint warnings or errors` (0 errors; the `no-console` disables
  in the hydrator are already annotated).

- Step — full unit + integration suite:
  `npx vitest run`
  Expected: all files pass, including
  `modules/settings/domain/org-settings.brand.test.ts`,
  `modules/settings/app/update-brand.test.ts`,
  `modules/settings/api/settings-router.int.test.ts` (brand cases),
  `lib/store/slices/data-slice.brand.test.ts`,
  `features/settings/brand-hydrator.test.tsx`,
  `app/(office)/settings/branding-card.test.tsx`,
  `components/modals/cust-brand-consumers.test.tsx`, and every pre-existing suite
  still green (no hydrator clobbering — the `refetchOnWindowFocus: false` guard).

- Step — coverage gate (repo threshold 80 lines / 75 branches per spec):
  `npx vitest run --coverage`
  Expected: `All files` coverage `>= 80%` statements/lines and `>= 75%` branches;
  the new files (`update-brand.ts`, `brand-hydrator.tsx`, `branding-card.tsx`,
  the brand slice actions) are each exercised by their tests above. If a branch is
  uncovered (e.g. the hydrator error path), it is already asserted by the
  "does not throw on query error" case.

- Step — production build:
  `npm run build`
  Expected: `✓ Compiled successfully`, no type or route errors; the office layout
  now mounts `<BrandHydrator />` without SSR issues (it is a `"use client"`
  component, same as the other hydrators).

- Step — adversarial self-review (spec §"Each phase … plus an adversarial
  review"). Confirm, with evidence:
  1. RLS still forced on `org_settings` — re-run the `pg_class` check from Task 2.
  2. Cross-tenant brand read blocked — the Task 6 "org B cannot read org A's
     brand" int test passed.
  3. No `SAMPLE_BRAND` import survives in a shipped screen — re-run the Task 9
     grep (`grep -rn "SAMPLE_BRAND" app components features | grep -v .test.`)
     → zero matches.
  4. `orgs.name` is only ever written for the caller's own org (from
     `ctx.principal.orgId`, never client input) — confirmed in `setName` +
     router.
  5. `updateBrand` follows optimistic → persist → reconcile → rollback — confirmed
     by the Task 7 rollback test.

- Step — branch, push, open the PR:
  ```bash
  git checkout -b phase-3-branding
  git push -u origin phase-3-branding
  gh pr create --title "Phase 3: Branding — DB-backed brand identity" --body "$(cat <<'EOF'
  ## Summary
  Makes the org brand fully DB-backed. Adds `brand_tagline/brand_site/brand_color/
  brand_logo_url/brand_initials` to `org_settings` (migration 0044), a
  `v1.settings.updateBrand` procedure that writes those + `orgs.name` in one
  org-scoped tx, store `setBrand`/`updateBrand` (optimistic → persist → reconcile
  /rollback), a `BrandHydrator`, and an editable Settings → Branding card. Every
  customer quote/invoice + the pipeline header now render the org's real brand;
  `SAMPLE_BRAND` is removed as a source of truth.

  ## Depends on
  Phase 2 (settings module + `org_settings` table + `v1.settings.get` +
  `SettingsHydrator`). Merge after Phase 2.

  ## Test plan
  - [x] `npx tsc --noEmit` clean
  - [x] `npm run lint` 0 errors
  - [x] `npx vitest run` green (unit + int, incl. cross-tenant brand isolation)
  - [x] `npx vitest run --coverage` >= 80/75
  - [x] `npm run build` succeeds
  - [x] RLS still FORCEd on `org_settings`; org B cannot read org A's brand
  - [x] No `SAMPLE_BRAND` import remains in a shipped screen
  EOF
  )"
  ```
  Expected: `gh` prints the new PR URL. Phase complete — green on the full gate.


## Phase 4: Jobs

Manual (unscheduled) jobs created in the UI do not survive a refresh: `addJob`
mints a client id and writes the store only; `updateJob`, `setJobSvc`,
`archiveJob`, and `deleteJob` never touch the DB. The `jobs` table also has no
`svc`/`job_type` column, so a job's service type has nowhere to persist. This
phase adds that column, three new `v1.jobs` procedures (`create`, `update`,
`archive`), and switches the five store actions to the optimistic → persist →
reconcile/rollback pattern the visit actions already use. After this phase a
manually-created job appears on the Schedule board and survives a full refresh.

**Reference pattern:** the `companies` module (create/update/archive use-cases,
`buildLeadUpdatePayload` in `leads-slice.ts` for the field-filter, and the visit
actions in `jobs-slice.ts` for the optimistic-reconcile shape). Every new
use-case mirrors `CreateCompanyUseCase`/`UpdateCompanyUseCase`/`ArchiveCompanyUseCase`.

**Cross-phase dependencies**

- CONSUMES from Phase 1: `addLead` returns a lead whose `id` is the reconciled
  server id (already awaited before the New-Job modal attaches children). The
  modal's `createJob` reads `match.id` / the created lead id for `leadId`.
- CONSUMES (existing): `leads` (`leadId` FK target `leads.org_id, leads.id`),
  the `ownerOrOffice` procedure builder (`@/trpc/init`), the job hydrator
  (`features/jobs/jobs-hydrator.tsx`) and `dtoJobToStoreJob` (`lib/store/dto-mapper.ts`).
- PRODUCES for later phases: the `jobs.svc` column and `job_type` alias (Phase 5
  job-lines/addons reads it), `v1.jobs.create` / `v1.jobs.update` / `v1.jobs.archive`,
  and persisting `addJob`/`updateJob`/`setJobSvc`/`archiveJob`/`deleteJob` store actions.

**Migration number:** Phases 2 and 3 land migrations `0043`/`0044`; this phase's
migration is **`0045`** (last on disk before this plan runs is `0042`).

**Naming decision (svc vs job_type):** the spec lists them as one concept. We add
ONE nullable text column named **`svc`** on `jobs` (matches the store field
`Job.svc` and the router input the slice already sends). `job_type` is the DTO
alias — the DTO field is named `svc`, no second column is created. This keeps the
store↔DB name identical and avoids a redundant column.

---

### Task 1: Migration 0045 — add `svc` to `jobs`

**Files:**
- Modify: `shared/db/schema/jobs.ts` (add the column in the `jobs` pgTable, after
  `notes` at L44) and add a `svc` length/whitespace `check`.
- Create: `shared/db/migrations/0045_jobs_svc.sql` (generated, then RLS/backfill note added).
- Modify: `shared/db/migrations/meta/_journal.json` + `meta/0045_snapshot.json`
  (drizzle-kit writes these — do not hand-edit).

**Interfaces:**
- Consumes: existing `jobs` table (`archived`/soft-delete already covered — the
  table has `deletedAt` at L47; `archiveJob`/`deleteJob` map to soft-delete, so NO
  separate `archived` column is added).
- Produces: `jobs.svc text` (nullable) column; `JobRow.svc: string | null` via
  `$inferSelect`.

Note on `archived`: the store `Job.archived` boolean is a client-local view state.
Soft-delete (`deleted_at`) is the DB truth. `archiveJob` sets `deleted_at`; the
hydrator's `list` already filters `isNull(jobs.deletedAt)`, so an archived job
drops off every list on next hydrate. No `archived` column is added (matches the
companies soft-delete model in `shared/db/schema/companies.ts`).

**Steps:**

- Step: add the column to the schema. Edit `shared/db/schema/jobs.ts` — insert
  after the `notes` line (currently L44 `notes: text("notes"),`):

```ts
    notes: text("notes"),
    // Service type ("service" | "estimate" | free-text trade label). Mirrors the store
    // Job.svc field; nullable because estimate-sourced jobs may not set one at creation.
    svc: text("svc"),
```

  and add this `check` to the table-config array (after the existing
  `jobs_window_check`, currently ending at L84):

```ts
    check(
      "jobs_svc_len_check",
      sql`${t.svc} is null or (char_length(btrim(${t.svc})) between 1 and 60)`,
    ),
```

- Step: generate the migration.

```
npm run db:generate
```

  Expected: drizzle-kit prints `[✓] Your SQL migration file ➜ shared/db/migrations/0045_<name>.sql`
  containing `ALTER TABLE "jobs" ADD COLUMN "svc" text;` plus the check constraint.
  Rename the emitted file to `shared/db/migrations/0045_jobs_svc.sql` and update the
  matching `tag` in `meta/_journal.json` to `0045_jobs_svc` (drizzle-kit's random
  slug is replaced with the stable name, mirroring `0038_companies_rls`).

- Step: confirm the file contents. The generated `0045_jobs_svc.sql` must read
  exactly (add the trailing comment by hand; RLS is already enabled on `jobs`
  from `0009_jobs_rls.sql` and inherits to the new column — no new policy needed):

```sql
-- Adds the service-type column to jobs. RLS already governs the jobs table
-- (0009_jobs_rls.sql, FORCE + tenant_isolation on org_id) and applies to every
-- column, so no new policy is required. No backfill: existing rows keep svc NULL
-- (rendered as "service" by the DTO mapper's default).
ALTER TABLE "jobs" ADD COLUMN "svc" text;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_svc_len_check" CHECK ("svc" is null or (char_length(btrim("svc")) between 1 and 60));
```

- Step: run the migration against the test DB.

```
npm run db:migrate
```

  Expected: `[✓] migrations applied successfully!` and the journal shows idx 45.

- Step: verify the column exists (typecheck is the fastest signal that
  `$inferSelect` now carries `svc`).

```
npx tsc --noEmit
```

  Expected: exits 0 (no new errors; `JobRow` now has `svc: string | null`).

- Step: commit.

```
git add shared/db/schema/jobs.ts shared/db/migrations/0045_jobs_svc.sql shared/db/migrations/meta/
git commit -m "feat: add svc column to jobs (migration 0045)"
```

---

### Task 2: Domain — carry `svc` on the `Job` aggregate + patch method

**Files:**
- Modify: `modules/jobs/domain/job.ts` (add `svc` to `JobProps` after `notes` at
  L101; add `svc` handling in `Job.create` and a new `patchFields` method).
- Modify: `modules/jobs/domain/job.test.ts` (or create if absent — see step) — add
  `patchFields` cases.

**Interfaces:**
- Consumes: `JobProps` (existing), `Result<Job, ValidationError>` from `Job.create`.
- Produces: `JobProps.svc: string | null`; `Job.patchFields(fields, now): Result<Job, ValidationError>`
  where `fields` is `{ title?: string | null; svc?: string | null; notes?: string | null }`.

Note: `addr`/`phone` from the store's `updateJob` are NOT job columns (they live on
the lead/service address model). The domain `patchFields` only touches DB-backed
scalars (`title`, `svc`, `notes`). The store filters `addr`/`phone` out before the
network call (Task 6) exactly as `buildLeadUpdatePayload` drops local-only keys.

**Steps:**

- Step: write the failing test. Append to `modules/jobs/domain/job.test.ts`:

```ts
describe("Job.patchFields", () => {
  const baseNow = new Date("2026-07-10T12:00:00Z");
  const makeJob = () => {
    const r = Job.create({
      id: asJobId("11111111-1111-1111-1111-111111111111"),
      orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
      num: "JOB-1000",
      leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
      sourceEstimateId: null,
      assigneeUserId: null,
      title: "Original",
      svc: "service",
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: null,
      visits: [],
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    if (!isOk(r)) throw new Error("setup failed");
    return r.value;
  };

  it("patches title/svc/notes and bumps updatedAt", () => {
    const now = new Date("2026-07-10T13:00:00Z");
    const r = makeJob().patchFields({ title: "New", svc: "estimate", notes: "gate code 4" }, now);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBe("New");
      expect(r.value.props.svc).toBe("estimate");
      expect(r.value.props.notes).toBe("gate code 4");
      expect(r.value.props.updatedAt).toBe(now);
    }
  });

  it("undefined field keeps the current value; explicit null clears it", () => {
    const r = makeJob().patchFields({ title: null }, baseNow);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBeNull();
      expect(r.value.props.svc).toBe("service"); // untouched
    }
  });
});
```

  (Ensure the file imports `asJobId, asOrgId, asLeadId, zeroMoney, isOk` from
  `@mallet/shared/types` — the existing `job.test.ts` already imports most; add
  any missing ones.)

- Step: run it, expected FAIL (`patchFields` does not exist; `svc` not on props).

```
npx vitest run modules/jobs/domain/job.test.ts
```

  Expected: `TypeError: makeJob(...).patchFields is not a function` (and a TS
  compile error on the `svc` prop).

- Step: minimal implementation. In `modules/jobs/domain/job.ts` add to `JobProps`
  after the `notes` line (L101 `readonly notes: string | null;`):

```ts
  readonly svc: string | null; // service type; nullable
```

  In `Job.create`, add a trim-normalize (before the final `return ok(...)` at L130):

```ts
    const svc = props.svc === null ? null : props.svc.trim();
    if (svc !== null && (svc.length === 0 || svc.length > 60)) {
      return err(validation("service type must be 1–60 characters", "svc"));
    }
```

  and change the final return to carry the normalized `svc`:

```ts
    return ok(new Job({ ...props, num, svc }));
```

  Then add the method (after `assignTo`, before `get props`):

```ts
  // Patch DB-backed scalar fields (title/svc/notes) while the job is not terminal.
  // Undefined = keep current; explicit null clears an optional field. Re-validates
  // through Job.create (mirrors Company.patch).
  patchFields(
    fields: { title?: string | null; svc?: string | null; notes?: string | null },
    now: Date,
  ): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot edit a completed or canceled job", "status"));
    }
    return Job.create({
      ...this.p,
      title: fields.title !== undefined ? fields.title : this.p.title,
      svc: fields.svc !== undefined ? fields.svc : this.p.svc,
      notes: fields.notes !== undefined ? fields.notes : this.p.notes,
      updatedAt: now,
    });
  }
```

- Step: run it, expected PASS.

```
npx vitest run modules/jobs/domain/job.test.ts
```

  Expected: all cases green (the new `Job.patchFields` block + existing suite).

- Step: commit.

```
git add modules/jobs/domain/job.ts modules/jobs/domain/job.test.ts
git commit -m "feat: carry svc on Job aggregate + patchFields method"
```

---

### Task 3: Infra — persist `svc` through the repository + mapper; add `create`/`archive`

**Files:**
- Modify: `modules/jobs/infra/job-mapper.ts` (map `row.svc` into `Job.create` at L36+).
- Modify: `modules/jobs/infra/drizzle-job-repository.ts` (add `svc` to
  `mutableColumns` at L44; add `insertManual` and `archive` methods; add `svc` to
  the DTO not needed here — mapper handles it).
- Modify: `modules/jobs/domain/job-repository.ts` (add `insertManual`, `archive`
  to the interface).

**Interfaces:**
- Consumes: `JobProps.svc` (Task 2), `Job` aggregate.
- Produces: `JobRepository.insertManual(job: Job): Promise<void>`,
  `JobRepository.archive(id: JobId, now: Date): Promise<number>`; `mutableColumns`
  now writes `svc`.

`insertManual` is distinct from `insertForEstimate` (which is ON CONFLICT DO
NOTHING keyed on the estimate). A manual job has `sourceEstimateId: null` and a
client-authored id, so it is a plain insert via the existing `save()` upsert path —
but a dedicated method keeps the use-case intention explicit and lets the repo
guard against colliding ids. We reuse `save()` internally.

**Steps:**

- Step: write the failing test — add `svc` round-trip + archive to the existing
  repo test. Find `modules/jobs/infra/drizzle-job-repository.int.test.ts` (the
  jobs repo integration test) and append:

```ts
  it("persists svc on save and reads it back", async () => {
    const repo = new DrizzleJobRepository(tx, orgId);
    const num = await repo.nextNumber();
    const job = makeManualJob({ num, svc: "estimate" }); // helper builds a manual Job
    await repo.insertManual(job);
    const back = await repo.findById(job.props.id);
    expect(back?.props.svc).toBe("estimate");
  });

  it("archive soft-deletes the job so findById returns null", async () => {
    const repo = new DrizzleJobRepository(tx, orgId);
    const num = await repo.nextNumber();
    const job = makeManualJob({ num, svc: "service" });
    await repo.insertManual(job);
    const count = await repo.archive(job.props.id, new Date());
    expect(count).toBe(1);
    expect(await repo.findById(job.props.id)).toBeNull();
  });
```

  If no `makeManualJob` helper exists in that test file, add one that builds a
  valid `Job` (mirroring `ScheduleJobUseCase` field set) with `sourceEstimateId:
  null`, a random-uuid id, and the given `num`/`svc`.

- Step: run it, expected FAIL.

```
npx vitest run --config vitest.integration.config.ts modules/jobs/infra/drizzle-job-repository.int.test.ts
```

  Expected: `repo.insertManual is not a function` / `repo.archive is not a function`.

- Step: minimal implementation. In `modules/jobs/infra/job-mapper.ts`, add `svc`
  to the `Job.create({ ... })` call (after `notes: row.notes,` at L52):

```ts
    notes: row.notes,
    svc: row.svc ?? null,
```

  In `modules/jobs/infra/drizzle-job-repository.ts` `mutableColumns` (after
  `notes: p.notes,` at L58):

```ts
      notes: p.notes,
      svc: p.svc,
```

  Add the two methods (after `save`, before `insertForEstimate`):

```ts
  // Plain insert for a manually-created (non-estimate) job. Reuses the save() upsert so
  // visits (if any) persist too; a client-authored id makes this idempotent under retry.
  async insertManual(job: Job): Promise<void> {
    await this.save(job);
  }

  // Soft-delete a job. Returns the number of rows affected (0 = not found / already gone).
  async archive(id: JobId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobs)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)))
      .returning({ id: jobs.id });
    return rows.length;
  }
```

  In `modules/jobs/domain/job-repository.ts`, add to the `JobRepository` interface
  (after `save(job: Job): Promise<void>;` at L19):

```ts
  insertManual(job: Job): Promise<void>;
  archive(id: JobId, now: Date): Promise<number>;
```

- Step: run it, expected PASS.

```
npx vitest run --config vitest.integration.config.ts modules/jobs/infra/drizzle-job-repository.int.test.ts
```

  Expected: the new `svc` and `archive` cases green (skips cleanly if no test DB env).

- Step: commit.

```
git add modules/jobs/infra/job-mapper.ts modules/jobs/infra/drizzle-job-repository.ts modules/jobs/domain/job-repository.ts
git commit -m "feat: persist svc + add insertManual/archive to job repository"
```

---

### Task 4: App — `CreateManualJobUseCase`, `UpdateJobUseCase`, `ArchiveJobUseCase`

**Files:**
- Create: `modules/jobs/app/create-manual-job.ts` + `create-manual-job.test.ts`
- Create: `modules/jobs/app/update-job.ts` + `update-job.test.ts`
- Create: `modules/jobs/app/archive-job.ts` + `archive-job.test.ts`
- Modify: `modules/jobs/index.ts` (export the three use-cases, mirroring L11-18).

**Interfaces:**
- Consumes: `JobRepository` (Task 3), `Clock`, `IdGenerator`, `EventBus`
  (`@mallet/shared/ports`), `Job.create`/`Job.patchFields` (Task 2).
- Produces:
  - `CreateManualJobUseCase.exec(cmd: { id?: string; orgId: OrgId; leadId: LeadId; title: string | null; svc: string | null; addr: string | null; phone: string | null; notes: string | null }): Promise<Result<Job, AppError>>`
  - `UpdateJobUseCase.exec(cmd: { jobId: JobId; title?: string | null; svc?: string | null; notes?: string | null }): Promise<Result<Job, AppError>>`
  - `ArchiveJobUseCase.exec(cmd: { jobId: JobId }): Promise<Result<{ ok: boolean }, AppError>>`

`addr`/`phone` are accepted by the create command for parity with the modal but are
NOT persisted on the job (no columns); they are dropped in the use-case with a note.
This mirrors how the store already sends them and keeps the DTO honest.

**Steps (CreateManualJob):**

- Step: write the failing test. Create `modules/jobs/app/create-manual-job.test.ts`
  (mirror `create-company.test.ts`'s FakeRepository + FixedClock harness):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asLeadId, asJobId, FixedClock, isOk, type OrgId, type LeadId } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { CreateManualJobUseCase } from "./create-manual-job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MINTED = "44444444-4444-4444-4444-444444444444";

class FakeRepo implements JobRepository {
  saved?: Job;
  numCalls = 0;
  async nextNumber() { this.numCalls++; return "JOB-1000"; }
  async save(j: Job) { this.saved = j; }
  async insertManual(j: Job) { this.saved = j; }
  async archive() { return 1; }
  async insertForEstimate() { return true; }
  async findById() { return null; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
}

const ids = (id = MINTED) => ({ newId: () => id });

describe("CreateManualJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeRepo;
  let useCase: CreateManualJobUseCase;
  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
    repo = new FakeRepo();
    useCase = new CreateManualJobUseCase(repo, new InMemoryEventBus(), clock, ids());
  });

  it("creates an unscheduled job for a lead with svc + minted num", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: "Water heater", svc: "service", addr: "1 Main St", phone: "555", notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.leadId).toBe(LEAD);
      expect(r.value.props.svc).toBe("service");
      expect(r.value.props.num).toBe("JOB-1000");
      expect(r.value.props.status).toBe("scheduled");
      expect(r.value.props.sourceEstimateId).toBeNull();
    }
    expect(repo.saved).toBeDefined();
  });

  it("uses the caller-provided id when present", async () => {
    const r = await useCase.exec({ id: "55555555-5555-5555-5555-555555555555", orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.id).toBe("55555555-5555-5555-5555-555555555555");
  });

  it("mints an id when none is provided", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    if (isOk(r)) expect(r.value.props.id).toBe(MINTED);
  });
});
```

- Step: run it, expected FAIL (module does not exist).

```
npx vitest run modules/jobs/app/create-manual-job.test.ts
```

  Expected: `Failed to resolve import "./create-manual-job"`.

- Step: minimal implementation. Create `modules/jobs/app/create-manual-job.ts`
  (mirror `schedule-job.ts` but with a client-authored id + svc, status
  "scheduled", zero total):

```ts
import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { asJobId, zeroMoney, ok, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CreateManualJobCommand {
  readonly id?: string; // client-authored id for optimistic UI; minted when absent
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly svc: string | null;
  // addr/phone accepted for modal parity but NOT persisted (no job columns) — dropped here.
  readonly addr: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
}

// A dispatcher creating a standalone job by hand (no source estimate). total is 0:
// money lives in Finance/invoicing, not on the work order (mirrors ScheduleJobUseCase).
export class CreateManualJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateManualJobCommand): Promise<Result<Job, AppError>> {
    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const job = Job.create({
      id: asJobId(cmd.id ?? this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      sourceEstimateId: null,
      assigneeUserId: null,
      title: cmd.title,
      svc: cmd.svc,
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: cmd.notes,
      visits: [],
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(job)) return job;

    await this.repo.insertManual(job.value);
    await this.bus.emit({
      name: "job.scheduled",
      orgId: cmd.orgId,
      payload: { jobId: job.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    logger.info({ jobId: job.value.props.id, orgId: cmd.orgId }, "job.created_manual");
    return ok(job.value);
  }
}
```

- Step: run it, expected PASS.

```
npx vitest run modules/jobs/app/create-manual-job.test.ts
```

  Expected: 3 cases green.

- Step: write the failing UpdateJob test. Create `modules/jobs/app/update-job.test.ts`
  (mirror `update-company.test.ts`: not-found path + happy patch):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, asLeadId, FixedClock, isOk, zeroMoney } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { UpdateJobUseCase } from "./update-job";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JID = asJobId("11111111-1111-1111-1111-111111111111");

function makeJob() {
  const r = Job.create({
    id: JID, orgId: ORG, num: "JOB-1", leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    sourceEstimateId: null, assigneeUserId: null, title: "Old", svc: "service", status: "scheduled",
    scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, canceledAt: null,
    cancelReason: null, total: zeroMoney, notes: null, visits: [],
    createdAt: new Date("2026-07-10T00:00:00Z"), updatedAt: new Date("2026-07-10T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("setup"); return r.value;
}

class FakeRepo implements JobRepository {
  constructor(private job: Job | null) {}
  saved?: Job;
  async nextNumber() { return "JOB-1"; }
  async save(j: Job) { this.saved = j; this.job = j; }
  async insertManual(j: Job) { this.saved = j; }
  async archive() { return 1; }
  async insertForEstimate() { return true; }
  async findById() { return this.job; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
}

describe("UpdateJobUseCase", () => {
  let clock: FixedClock;
  beforeEach(() => { clock = new FixedClock(new Date("2026-07-10T13:00:00Z")); });

  it("patches title/svc/notes and saves", async () => {
    const repo = new FakeRepo(makeJob());
    const uc = new UpdateJobUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, title: "New", svc: "estimate", notes: "code 4" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBe("New");
      expect(r.value.props.svc).toBe("estimate");
      expect(r.value.props.notes).toBe("code 4");
    }
    expect(repo.saved).toBeDefined();
  });

  it("returns NOT_FOUND when the job is missing", async () => {
    const repo = new FakeRepo(null);
    const uc = new UpdateJobUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run modules/jobs/app/update-job.test.ts
```

  Expected: `Failed to resolve import "./update-job"`.

- Step: minimal implementation. Create `modules/jobs/app/update-job.ts`:

```ts
import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface UpdateJobCommand {
  readonly jobId: JobId;
  readonly title?: string | null;
  readonly svc?: string | null;
  readonly notes?: string | null;
}

// Edit a job's DB-backed scalars (title/svc/notes). addr/phone are not job columns and
// never reach here. Terminal jobs reject via Job.patchFields (mirrors UpdateCompanyUseCase).
export class UpdateJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const patched = job.patchFields(
      { title: cmd.title, svc: cmd.svc, notes: cmd.notes },
      this.clock.now(),
    );
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    logger.info({ jobId: cmd.jobId, orgId: patched.value.props.orgId }, "job.updated");
    return ok(patched.value);
  }
}
```

  (The `bus` param is retained for signature symmetry with the other use-cases and
  future emit; leave it unused for now — ESLint `no-unused-vars` allows constructor
  params. If lint flags it, prefix with `_bus` and drop from the constructor call
  site accordingly. Prefer keeping it and emitting a `job.updated` bus event to
  avoid the lint issue — add the emit after the save, mirroring cancel-job.ts.)

  To keep lint clean AND emit, add after the `save`:

```ts
    await this.bus.emit({
      name: "job.updated",
      orgId: patched.value.props.orgId,
      payload: { jobId: patched.value.props.id },
      occurredAt: this.clock.now(),
    });
```

  (Confirm `job.updated` is an accepted event name in the bus's event union; if the
  union is closed, add `job.updated` to it in the same file that defines job events,
  alongside `job.scheduled`/`job.canceled`.)

- Step: run it, expected PASS.

```
npx vitest run modules/jobs/app/update-job.test.ts
```

  Expected: 2 cases green.

- Step: write the failing ArchiveJob test. Create `modules/jobs/app/archive-job.test.ts`
  (mirror `archive-company.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { asJobId, FixedClock, isOk } from "@mallet/shared/types";
import { ArchiveJobUseCase } from "./archive-job";
import type { JobRepository } from "../domain/job-repository";

const JID = asJobId("11111111-1111-1111-1111-111111111111");

function repoWith(archiveResult: number): JobRepository {
  return {
    nextNumber: async () => "JOB-1",
    save: async () => {},
    insertManual: async () => {},
    archive: async () => archiveResult,
    insertForEstimate: async () => true,
    findById: async () => null,
    findBySourceEstimate: async () => null,
    list: async () => ({ items: [], nextCursor: null }),
    listByLead: async () => ({ items: [], nextCursor: null }),
  };
}

describe("ArchiveJobUseCase", () => {
  const clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));

  it("returns ok when a row is archived", async () => {
    const r = await new ArchiveJobUseCase(repoWith(1), clock).exec({ jobId: JID });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.ok).toBe(true);
  });

  it("returns NOT_FOUND when nothing was archived", async () => {
    const r = await new ArchiveJobUseCase(repoWith(0), clock).exec({ jobId: JID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run modules/jobs/app/archive-job.test.ts
```

  Expected: `Failed to resolve import "./archive-job"`.

- Step: minimal implementation. Create `modules/jobs/app/archive-job.ts`:

```ts
import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { JobRepository } from "../domain/job-repository";

export interface ArchiveJobCommand {
  readonly jobId: JobId;
}

// Soft-delete a job (deleted_at). Idempotent-safe: a second archive returns NOT_FOUND
// (mirrors ArchiveCompanyUseCase).
export class ArchiveJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ArchiveJobCommand): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archive(cmd.jobId, this.clock.now());
    if (count === 0) return err(notFound("job not found or already archived"));
    logger.info({ jobId: cmd.jobId }, "job.archived");
    return ok({ ok: true });
  }
}
```

- Step: run it, expected PASS.

```
npx vitest run modules/jobs/app/archive-job.test.ts
```

  Expected: 2 cases green.

- Step: export the three use-cases. In `modules/jobs/index.ts`, after
  `export { CancelJobUseCase } from "./app/cancel-job";`:

```ts
export { CreateManualJobUseCase } from "./app/create-manual-job";
export { UpdateJobUseCase } from "./app/update-job";
export { ArchiveJobUseCase } from "./app/archive-job";
```

- Step: commit.

```
git add modules/jobs/app/create-manual-job.ts modules/jobs/app/create-manual-job.test.ts modules/jobs/app/update-job.ts modules/jobs/app/update-job.test.ts modules/jobs/app/archive-job.ts modules/jobs/app/archive-job.test.ts modules/jobs/index.ts
git commit -m "feat: add CreateManualJob/UpdateJob/ArchiveJob use-cases"
```

---

### Task 5: API — `v1.jobs.create` / `v1.jobs.update` / `v1.jobs.archive` + DTO `svc`

**Files:**
- Modify: `modules/jobs/api/job-dto.ts` (add `svc` to `jobDTO` at L24-42 and to
  `toJobDTO` at L77-98; add `svc` to `jobSummaryDTO` + `toJobSummaryDTO`).
- Modify: `modules/jobs/api/job-router.ts` (add three procedures + inputs).
- Modify: `modules/jobs/api/job-router.int.test.ts` (add the three flows +
  cross-tenant + RBAC assertions).

**Interfaces:**
- Consumes: `CreateManualJobUseCase`/`UpdateJobUseCase`/`ArchiveJobUseCase` (Task 4),
  `DrizzleJobRepository` (Task 3), `ownerOrOffice`, `orThrow`, `asJobId`/`asLeadId`.
- Produces (client-facing tRPC surface later phases + the store consume):
  - `v1.jobs.create(input: { id?: uuid; leadId: uuid; title?: string; svc?: string; addr?: string; phone?: string; notes?: string }) -> jobDTO`
  - `v1.jobs.update(input: { jobId: uuid; title?: string|null; svc?: string|null; notes?: string|null }) -> jobDTO`
  - `v1.jobs.archive(input: { jobId: uuid }) -> { ok: boolean }`
  - `jobDTO.svc: string | null`

**Steps:**

- Step: write the failing integration test. Append to
  `modules/jobs/api/job-router.int.test.ts` (mirror the companies int test harness
  — it uses `appRouter.createCaller(ctxFor(orgId, role))`; the jobs int test already
  has a `ctxFor` + org setup; reuse them, and insert a lead via `caller.v1.customers.create`
  to obtain a real `leadId`):

```ts
  it("owner creates a manual job for a lead, edits it, and it lists back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Manual Job Cust", stage: "New customer" });

    const created = await caller.v1.jobs.create({
      leadId: lead.id, title: "Water heater", svc: "service", addr: "1 Main", phone: "555", notes: "gate 4",
    });
    expect(created.title).toBe("Water heater");
    expect(created.svc).toBe("service");
    expect(created.status).toBe("scheduled");

    const updated = await caller.v1.jobs.update({ jobId: created.id, title: "Water heater swap", svc: "estimate" });
    expect(updated.title).toBe("Water heater swap");
    expect(updated.svc).toBe("estimate");

    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.some((j) => j.id === created.id && j.svc === "estimate")).toBe(true);
  });

  it("archive soft-deletes a job; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Archive Job Cust", stage: "New customer" });
    const created = await caller.v1.jobs.create({ leadId: lead.id, title: "Temp" });
    const res = await caller.v1.jobs.archive({ jobId: created.id });
    expect(res.ok).toBe(true);
    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.some((j) => j.id === created.id)).toBe(false);
  });

  it("update/archive on unknown jobId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(caller.v1.jobs.update({ jobId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.v1.jobs.archive({ jobId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("org B cannot update or archive org A's job (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await callerA.v1.customers.create({ name: "RLS Job Cust", stage: "New customer" });
    const created = await callerA.v1.jobs.create({ leadId: lead.id, title: "Boundary" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(callerB.v1.jobs.update({ jobId: created.id, title: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.jobs.archive({ jobId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from job.create/update/archive", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.jobs.create({ leadId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerTech.v1.jobs.update({ jobId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerTech.v1.jobs.archive({ jobId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
```

  (Ensure `randomUUID` and the org fixtures `orgAId`/`orgBId`/`ctxFor` are already
  in this file — they are in the companies int test; if the jobs int test's harness
  differs, adapt to its existing helpers rather than duplicating them.)

- Step: run it, expected FAIL.

```
npx vitest run --config vitest.integration.config.ts modules/jobs/api/job-router.int.test.ts
```

  Expected: `caller.v1.jobs.create is not a function` (and `.svc` undefined on the
  list item).

- Step: minimal implementation. In `modules/jobs/api/job-dto.ts`:
  - add `svc: z.string().nullable(),` to `jobDTO` (after `notes` at L39) and to
    `jobSummaryDTO` (after `notes` at L54);
  - add `svc: p.svc,` to `toJobDTO`'s return (after `notes: p.notes,` at L94) and to
    `toJobSummaryDTO`'s return (after `notes: p.notes,` at L109).

  In `modules/jobs/api/job-router.ts`:
  - add the imports (after the existing use-case imports, L14):

```ts
import { CreateManualJobUseCase } from "../app/create-manual-job";
import { UpdateJobUseCase } from "../app/update-job";
import { ArchiveJobUseCase } from "../app/archive-job";
```

  - add the input schemas (near the other `const ...Input` block, after L53):

```ts
const createInput = z.object({
  id: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  title: z.string().max(200).optional(),
  svc: z.string().min(1).max(60).optional(),
  addr: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(10_000).optional(),
});
const updateJobInput = z.object({
  jobId: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  svc: z.string().min(1).max(60).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});
const archiveJobInput = z.object({ jobId: z.string().uuid() });
```

  - add the three procedures inside `router({ ... })` (place `create` right after
    `createFromEstimate`, and `update`/`archive` after `cancel`):

```ts
    create: ownerOrOffice
      .input(createInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateManualJobUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              id: input.id,
              orgId: ctx.principal.orgId,
              leadId: asLeadId(input.leadId),
              title: input.title ?? null,
              svc: input.svc ?? null,
              addr: input.addr ?? null,
              phone: input.phone ?? null,
              notes: input.notes ?? null,
            }),
          ),
        );
      }),

    update: ownerOrOffice
      .input(updateJobInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              title: input.title,
              svc: input.svc,
              notes: input.notes,
            }),
          ),
        );
      }),

    archive: ownerOrOffice
      .input(archiveJobInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveJobUseCase(repo, ctx.deps.clock);
        return orThrow(await useCase.exec({ jobId: asJobId(input.jobId) }));
      }),
```

- Step: run it, expected PASS.

```
npx vitest run --config vitest.integration.config.ts modules/jobs/api/job-router.int.test.ts
```

  Expected: the five new flows green (create/edit/list, archive, not-found,
  cross-tenant RLS, RBAC).

- Step: commit.

```
git add modules/jobs/api/job-dto.ts modules/jobs/api/job-router.ts modules/jobs/api/job-router.int.test.ts
git commit -m "feat: add v1.jobs.create/update/archive + svc on jobDTO"
```

---

### Task 6: DTO mapper — carry `svc`/`addr`/`phone` through `dtoJobToStoreJob`

**Files:**
- Modify: `lib/store/dto-mapper.ts` (`JobDTO` widened; `dtoJobToStoreJob` reads
  `dto.svc` instead of hardcoding `"service"` at L155; keep `addr`/`phone` as `""`
  since the DTO has no such columns — documented).
- Modify: `lib/store/dto-mapper.test.ts` (add a `svc` reconcile assertion) — create
  if the file does not exist.

**Interfaces:**
- Consumes: `jobDTO` now has `svc` (Task 5). Note `JobDTO` type alias at L23 is
  derived from `v1.visits.createVisit` output; that DTO is the full `jobDTO`, which
  now includes `svc`, so no alias change is needed — only the mapping body.
- Produces: `dtoJobToStoreJob(dto)` returns `Job.svc = dto.svc ?? "service"` (keeps
  the old default when a legacy/estimate job has NULL svc).

**Steps:**

- Step: write the failing test. Add to `lib/store/dto-mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dtoJobToStoreJob } from "./dto-mapper";

const baseDto = {
  id: "11111111-1111-1111-1111-111111111111",
  num: "JOB-1",
  leadId: "33333333-3333-3333-3333-333333333333",
  sourceEstimateId: null,
  assigneeUserId: null,
  title: "Water heater",
  status: "scheduled" as const,
  scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null,
  canceledAt: null, cancelReason: null,
  total: { cents: 0, currency: "USD" as const },
  notes: "gate 4",
  svc: "estimate",
  visits: [],
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("dtoJobToStoreJob svc mapping", () => {
  it("reads svc from the DTO", () => {
    const job = dtoJobToStoreJob(baseDto as never);
    expect(job.svc).toBe("estimate");
  });

  it("falls back to 'service' when svc is null", () => {
    const job = dtoJobToStoreJob({ ...baseDto, svc: null } as never);
    expect(job.svc).toBe("service");
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/dto-mapper.test.ts
```

  Expected: `expected 'service' to be 'estimate'` (current code hardcodes `"service"`).

- Step: minimal implementation. In `lib/store/dto-mapper.ts` `dtoJobToStoreJob`,
  change the hardcoded `svc: "service",` (L155) to:

```ts
    svc: dto.svc ?? "service",
```

  (Leave `addr: ""` / `phone: ""` — the DTO carries no address/phone; those remain
  hydrated from the lead on the modal side. Add a one-line comment above them noting
  this.)

- Step: run it, expected PASS.

```
npx vitest run lib/store/dto-mapper.test.ts
```

  Expected: both cases green.

- Step: commit.

```
git add lib/store/dto-mapper.ts lib/store/dto-mapper.test.ts
git commit -m "feat: read svc from jobDTO in dtoJobToStoreJob"
```

---

### Task 7: Store — `addJob` persists via `v1.jobs.create` (remove the origin skip)

**Files:**
- Modify: `lib/store/slices/jobs-slice.ts` (`addJob` at L152-156 → optimistic +
  persist + reconcile/rollback; the module header comment L14-17 about
  `origin === "manual"` skipping the network is updated to note create now persists).
- Modify: `lib/store/slices/jobs-slice.test.ts` (create — mirror `leads-slice.test.ts`
  with a mocked `trpcVanilla`).

**Interfaces:**
- Consumes: `trpcVanilla.v1.jobs.create.mutate(input)` (Task 5), `dtoJobToStoreJob`
  (Task 6), `crypto.randomUUID`.
- Produces: `addJob(draft)` returns the optimistic Job synchronously (callers rely on
  `created.id` for `addVisit`); the client-authored id is sent to `create` so the
  server row id === optimistic id (no id swap on reconcile — matches `addVisit`).

Critical: `addJob` MUST stay synchronous-return (the New-Job modal calls
`addVisit(created.id, ...)` immediately after). We send a client-authored `id` (like
companies/visits) so no id reconciliation is needed and the follow-up `addVisit`
calls target a valid id. A manual job now sets `origin: JOB_ORIGIN.DB` on reconcile
so its visits persist through the existing visit actions.

**Steps:**

- Step: write the failing test. Create `lib/store/slices/jobs-slice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockArchive = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        create: { mutate: (...a: unknown[]) => mockCreate(...a) },
        update: { mutate: (...a: unknown[]) => mockUpdate(...a) },
        archive: { mutate: (...a: unknown[]) => mockArchive(...a) },
      },
      visits: {
        createVisit: { mutate: vi.fn() },
      },
    },
  },
}));

import { createJobsSlice, buildJobUpdatePayload } from "./jobs-slice";
import type { JobsSlice } from "./jobs-slice";
import type { Job } from "@/lib/store/types";

function makeStore() {
  let state: JobsSlice;
  const set = (partial: Partial<JobsSlice> | ((s: JobsSlice) => Partial<JobsSlice>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = createJobsSlice(set as never, get as never, {} as never);
  return { get, set };
}

const draft: Omit<Job, "id"> = {
  leadId: "lead-1", svc: "service", origin: "manual", title: "Water heater",
  addr: "1 Main", phone: "555", status: "unscheduled", archived: false,
  lines: [], addons: [], photos: [], notes: "gate 4", acts: [], visits: [],
};

describe("addJob persist", () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it("optimistically inserts the job and returns it synchronously", () => {
    mockCreate.mockResolvedValue({ id: "srv", num: "JOB-1", leadId: "lead-1", sourceEstimateId: null, assigneeUserId: null, title: "Water heater", status: "scheduled", scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, canceledAt: null, cancelReason: null, total: { cents: 0, currency: "USD" }, notes: "gate 4", svc: "service", visits: [], createdAt: "2026-07-10T00:00:00.000Z" });
    const { get } = makeStore();
    const created = get().addJob(draft);
    expect(created.id).toBeTruthy();
    expect(get().jobs[0]!.id).toBe(created.id);
  });

  it("sends a client-authored id + leadId/svc to v1.jobs.create", () => {
    mockCreate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob(draft);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, leadId: "lead-1", svc: "service", title: "Water heater" }),
    );
  });

  it("does not call create when leadId is empty (unassigned manual job)", () => {
    mockCreate.mockResolvedValue({} as never);
    const { get } = makeStore();
    get().addJob({ ...draft, leadId: "" });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: `buildJobUpdatePayload` import fails (added in Task 8) AND `mockCreate`
  is never called (current `addJob` is store-only). Split: temporarily drop the
  `buildJobUpdatePayload` import if it blocks — but since Task 8 adds it, keep the
  import and expect the failure to be the addJob assertions after the import resolves
  in Task 8. To keep this task self-contained, import ONLY `createJobsSlice` here and
  add the `buildJobUpdatePayload` import in Task 8's test edits.

  (Revised: this task's test imports only `createJobsSlice`; the `buildJobUpdatePayload`
  import line is added in Task 8.)

- Step: minimal implementation. In `lib/store/slices/jobs-slice.ts`, replace
  `addJob` (L152-156) with:

```ts
  // ---------------------------------------------------------------------------
  // addJob — client-authored id (so the returned id is valid for an immediate
  // addVisit) + optimistic insert + persist via v1.jobs.create + reconcile/rollback.
  // A manual job with no leadId (leadId === "") is a pure local draft — the DB
  // requires a lead FK, so we skip the network call and keep it store-only.
  // ---------------------------------------------------------------------------
  addJob: (draft) => {
    const id = crypto.randomUUID();
    const newJob: Job = { ...draft, id };
    set((s) => ({ jobs: [newJob, ...s.jobs] }));

    // No lead to attach to → cannot persist (jobs.lead_id is NOT NULL, composite FK).
    if (!newJob.leadId) return newJob;

    const priorJobs = get().jobs;
    trpcVanilla.v1.jobs.create
      .mutate({
        id,
        leadId: newJob.leadId,
        title: newJob.title || undefined,
        svc: newJob.svc || undefined,
        addr: newJob.addr || undefined,
        phone: newJob.phone || undefined,
        notes: newJob.notes || undefined,
      })
      .then((dto) => {
        // Reconcile: server row id === client id, so the board + any queued
        // addVisit calls stay valid. Preserve local-only visit rows already added.
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...dtoJobToStoreJob(dto), visits: j.visits } : j,
          ),
        }));
      })
      .catch((err: unknown) => {
        // Roll back: remove the optimistic job.
        set(() => ({ jobs: priorJobs.filter((j) => j.id !== id) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] addJob failed — rolled back", { id, err });
        }
      });

    return newJob;
  },
```

  Update the module header comment block (L14-17) to note that manual jobs WITH a
  lead now persist via `v1.jobs.create`; only lead-less local drafts stay store-only.

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: the three `addJob persist` cases green.

- Step: commit.

```
git add lib/store/slices/jobs-slice.ts lib/store/slices/jobs-slice.test.ts
git commit -m "feat: addJob persists via v1.jobs.create with client id"
```

---

### Task 8: Store — `updateJob` field-filter + persist; `setJobSvc` persists

**Files:**
- Modify: `lib/store/slices/jobs-slice.ts` (add `buildJobUpdatePayload` pure helper;
  `updateJob` at L158-159 → optimistic + persist + reconcile/rollback; `setJobSvc`
  at L161-162 → delegate to `updateJob({ svc })`).
- Modify: `lib/store/slices/jobs-slice.test.ts` (add `buildJobUpdatePayload` +
  `updateJob`/`setJobSvc` cases; add the `buildJobUpdatePayload` import).

**Interfaces:**
- Consumes: `trpcVanilla.v1.jobs.update.mutate(payload)` (Task 5), `dtoJobToStoreJob`.
- Produces: `buildJobUpdatePayload(jobId, patch): { jobId; title?; svc?; notes? } | null`
  — returns null when the patch touches ONLY local-only job fields
  (`checklist`/`lines`/`addons`/`photos`/`verify`/`acts`/`status`/`archived`/`invRequested`/
  `approvedOnSite`/`completion`/`expected`/`special`/`prep`/`addr`/`phone`/`visits`).
  Note `addr`/`phone` are local-only here because there is no job column for them.

**Steps:**

- Step: write the failing test. Add the import + cases to
  `lib/store/slices/jobs-slice.test.ts`:

```ts
import { buildJobUpdatePayload } from "./jobs-slice";

describe("buildJobUpdatePayload", () => {
  it("maps title/svc/notes to the update payload", () => {
    expect(buildJobUpdatePayload("j1", { title: "New" })).toEqual({ jobId: "j1", title: "New" });
    expect(buildJobUpdatePayload("j1", { svc: "estimate" })).toEqual({ jobId: "j1", svc: "estimate" });
    expect(buildJobUpdatePayload("j1", { notes: "x" })).toEqual({ jobId: "j1", notes: "x" });
  });

  it("returns null for a local-only patch (lines/checklist/addr/phone/status)", () => {
    expect(buildJobUpdatePayload("j1", { lines: [] })).toBeNull();
    expect(buildJobUpdatePayload("j1", { checklist: undefined })).toBeNull();
    expect(buildJobUpdatePayload("j1", { addr: "1 Main" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { phone: "555" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { invRequested: true })).toBeNull();
  });
});

describe("updateJob persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("persists a title change via v1.jobs.update", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" }); // local-only add (no create call)
    get().updateJob(created.id, { title: "Renamed" });
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Renamed"); // optimistic
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, title: "Renamed" }));
  });

  it("does NOT call update for a local-only patch (lines)", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" });
    get().updateJob(created.id, { lines: [{ d: "x", q: 1, r: 100 }] });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("setJobSvc persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("routes through update with { svc }", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" });
    get().setJobSvc(created.id, "estimate");
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBe("estimate");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, svc: "estimate" }));
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: `buildJobUpdatePayload is not exported` + `mockUpdate` never called.

- Step: minimal implementation. In `lib/store/slices/jobs-slice.ts`, add the pure
  helper near the top (after the `patchJob` helper, ~L71):

```ts
// Job fields that have a DB column via v1.jobs.update. Everything else on Job is
// local-only (visits ride their own mutations; lines/addons/verify/photos are
// Phase-5; addr/phone have no job column; status/archived derive server-side).
const JOB_UPDATE_KEYS = new Set<keyof Job>(["title", "svc", "notes"]);

export interface JobUpdatePayload {
  jobId: string;
  title?: string;
  svc?: string;
  notes?: string;
}

/**
 * Build the v1.jobs.update payload from a Job patch, keeping only DB-backed
 * fields. Returns null when the patch touches only local-only fields (skip the
 * network call). Mirrors buildLeadUpdatePayload in leads-slice.
 */
export function buildJobUpdatePayload(
  jobId: string,
  patch: Partial<Job>,
): JobUpdatePayload | null {
  const payload: JobUpdatePayload = { jobId };
  let hasPersisted = false;
  for (const key of Object.keys(patch) as (keyof Job)[]) {
    if (!JOB_UPDATE_KEYS.has(key)) continue;
    hasPersisted = true;
    if (key === "title") payload.title = patch.title;
    else if (key === "svc") payload.svc = patch.svc;
    else if (key === "notes") payload.notes = patch.notes;
  }
  return hasPersisted ? payload : null;
}
```

  Replace `updateJob` (L158-159) with:

```ts
  updateJob: (id, patch) => {
    const prior = snapshot(get().jobs, id);
    // 1. Optimistic apply (local-only fields update the store regardless).
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
    // 2. Persist only DB-backed fields; skip if the patch is local-only.
    const mutPayload = buildJobUpdatePayload(id, patch);
    if (mutPayload === null) return;
    trpcVanilla.v1.jobs.update
      .mutate(mutPayload)
      .then((dto) => {
        // 3. Reconcile server truth for the persisted scalars, preserving local-only
        //    fields already on the store record (lines/addons/verify/photos/visits).
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? { ...j, title: dto.title ?? j.title, svc: dto.svc ?? j.svc, notes: dto.notes ?? j.notes }
              : j,
          ),
        }));
      })
      .catch((err: unknown) => {
        // 4. Roll back the whole job to the pre-patch snapshot.
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] updateJob failed — rolled back", { id, patch, err });
        }
      });
  },
```

  Replace `setJobSvc` (L161-162) with a delegation:

```ts
  setJobSvc: (id, svc) => get().updateJob(id, { svc }),
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: `buildJobUpdatePayload`, `updateJob persist`, and `setJobSvc persist`
  cases all green (plus the Task 7 addJob cases).

- Step: commit.

```
git add lib/store/slices/jobs-slice.ts lib/store/slices/jobs-slice.test.ts
git commit -m "feat: updateJob/setJobSvc persist via v1.jobs.update"
```

---

### Task 9: Store — `archiveJob`/`deleteJob` → `v1.jobs.archive`

**Files:**
- Modify: `lib/store/slices/jobs-slice.ts` (`archiveJob` at L420-421 and `deleteJob`
  at L423-424 → optimistic + persist via `v1.jobs.archive` + rollback).
- Modify: `lib/store/slices/jobs-slice.test.ts` (add archive/delete cases).

**Interfaces:**
- Consumes: `trpcVanilla.v1.jobs.archive.mutate({ jobId })` (Task 5).
- Produces: persisting `archiveJob`/`deleteJob`. `deleteJob` now maps to the same
  soft-delete archive semantics (spec: "deleteJob repoints to archive; no hard
  deletes"). Both remove the job from the visible list (archiveJob sets
  `archived: true`; deleteJob filters it out) AND soft-delete server-side.

**Steps:**

- Step: write the failing test. Add to `lib/store/slices/jobs-slice.test.ts`:

```ts
describe("archiveJob / deleteJob persist", () => {
  beforeEach(() => { mockArchive.mockReset(); });

  it("archiveJob marks archived optimistically and calls v1.jobs.archive", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    // Seed a db-origin job directly via setJobs so leadId presence is irrelevant.
    get().setJobs([{ ...draft, id: "j-arch", origin: "db" }]);
    get().archiveJob("j-arch");
    expect(get().jobs.find((j) => j.id === "j-arch")!.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledWith({ jobId: "j-arch" });
  });

  it("deleteJob removes the job optimistically and calls v1.jobs.archive", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-del", origin: "db" }]);
    get().deleteJob("j-del");
    expect(get().jobs.some((j) => j.id === "j-del")).toBe(false);
    expect(mockArchive).toHaveBeenCalledWith({ jobId: "j-del" });
  });

  it("archiveJob does NOT call the server for a local-only (leadless manual) job", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-local", origin: "manual" }]);
    get().archiveJob("j-local");
    expect(mockArchive).not.toHaveBeenCalled();
  });
});
```

- Step: run it, expected FAIL.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: `mockArchive` never called (current actions are store-only).

- Step: minimal implementation. In `lib/store/slices/jobs-slice.ts`, replace
  `archiveJob` (L420-421) and `deleteJob` (L423-424) with:

```ts
  // Soft-delete server-side; mark archived locally so it drops off the active list.
  archiveJob: (id) => {
    const prior = snapshot(get().jobs, id);
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, archived: true } : j)) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return; // local-only draft — nothing to persist
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] archiveJob failed — rolled back", { id, err });
        }
      });
  },

  // deleteJob repoints to soft-delete (no hard deletes). Removes from the visible
  // list optimistically; re-inserts on failure.
  deleteJob: (id) => {
    const prior = snapshot(get().jobs, id);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return;
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .catch((err: unknown) => {
        // Rollback: re-insert the removed job at the front (order is not load-bearing here).
        set((s) => ({ jobs: [prior, ...s.jobs] }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] deleteJob failed — rolled back", { id, err });
        }
      });
  },
```

- Step: run it, expected PASS.

```
npx vitest run lib/store/slices/jobs-slice.test.ts
```

  Expected: the three archive/delete cases green (plus all prior slice cases).

- Step: commit.

```
git add lib/store/slices/jobs-slice.ts lib/store/slices/jobs-slice.test.ts
git commit -m "feat: archiveJob/deleteJob persist via v1.jobs.archive (soft-delete)"
```

---

### Task 10: Frontend — New-Job modal `createJob` persists + survives refresh

**Files:**
- Modify: `components/modals/new-job-modal.tsx` (`createJob` at L228-253 — no code
  change to the call itself; it already calls `addJob(...)` then `addVisit(...)`,
  which now persist. The only change is passing a resolved `leadId` for the "add new
  customer" path so create has a lead to FK against).
- Modify: `components/modals/new-job-modal.tsx` `createEstimate` is untouched (Phase 1
  already made `addLead` persist + awaited); `createJob` must resolve/await the lead
  when the customer is typed-but-new so `addJob` gets a persisted `leadId`.

**Interfaces:**
- Consumes: `addLead` (Phase 1 — persists, returns reconciled lead), `addJob` (Task 7),
  `addVisit` (existing — persists when `origin === "db"`).
- Produces: a manually-created Job row in the DB (via the reconcile in Task 7) that
  the JobsHydrator loads on next mount.

The gap: today `createJob` (L231-247) sets `leadId: match ? match.id : ""`. An empty
leadId means Task 7 skips persistence (no FK). To persist a job for a NEW customer,
`createJob` must first create the lead (as `createEstimate` already does at L194-201),
then use that lead's id.

**Steps:**

- Step: write the failing test. New-Job modal has no component test harness for
  persistence; assert at the store/wiring level instead. Add to
  `lib/store/slices/jobs-slice.test.ts` a documentation-level guard that a job
  created with a real leadId fires create (already covered by Task 7). The
  frontend behavior is verified by an e2e/manual check — add a Playwright spec
  `e2e/manual-job-persists.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// A manually created job survives a full page reload and appears on the board.
// Requires the seeded E2E org (npm run seed:e2e) + a running dev server.
test("manual job persists across refresh", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("button", { name: /new job/i }).click();
  await page.getByLabel(/what.?s the job/i).fill("E2E water heater");
  await page.getByLabel("Customer").fill("E2E Persist Cust");
  await page.getByRole("button", { name: /create job/i }).click();

  await expect(page.getByText("E2E water heater")).toBeVisible();
  await page.reload();
  await expect(page.getByText("E2E water heater")).toBeVisible();
});
```

- Step: run it, expected FAIL (before the leadId fix, a new-customer job is not
  persisted so it vanishes on reload).

```
npm run seed:e2e && npx playwright test e2e/manual-job-persists.spec.ts
```

  Expected: the post-reload `toBeVisible` assertion fails (job gone).

- Step: minimal implementation. In `components/modals/new-job-modal.tsx`, change
  `createJob` (L228-253) to resolve a lead first (mirroring `createEstimate`'s
  match-or-add at L189-201) so `addJob` always receives a real `leadId`:

```ts
  function createJob(job: string) {
    const rows = resolvedVisits();
    const custName = customer.trim();
    const match = matchLead(custName);

    // Resolve the lead: existing match, or create one (a job must FK to a lead to persist).
    const lead =
      match ??
      addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      });

    const created = addJob({
      leadId: lead.id,
      svc: njType,
      origin: "manual",
      title: job,
      addr: addr.trim() || (lead.address ?? ""),
      phone: phone.trim() || (lead.phone && lead.phone !== "—" ? lead.phone : ""),
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: notes.trim(),
      acts: [],
      visits: [],
    });
    rows.forEach((v) => addVisit(created.id, v.h));
    return created;
  }
```

  (Phase 1 made `addLead` persist with a client-authored/reconciled id available
  synchronously — the returned `lead.id` is stable and safe to pass to `addJob`.)

- Step: run it, expected PASS.

```
npx playwright test e2e/manual-job-persists.spec.ts
```

  Expected: the job is visible both before and after reload.

- Step: commit.

```
git add components/modals/new-job-modal.tsx e2e/manual-job-persists.spec.ts
git commit -m "feat: New-Job modal creates a lead so a manual job persists"
```

---

### Task 11: Verify the full gate + open the PR

**Files:** none (verification + PR).

**Interfaces:** Consumes every prior task in this phase.

**Steps:**

- Step: create the feature branch if not already on one (never commit Phase work to
  the default branch).

```
git checkout -b phase-4-jobs-persistence
```

  (If the earlier task commits were made on `main`, move them: `git branch -f
  phase-4-jobs-persistence HEAD` then reset `main` to origin — but prefer having
  branched before Task 1.)

- Step: typecheck.

```
npx tsc --noEmit
```

  Expected: exits 0, no errors.

- Step: lint (0 errors).

```
npm run lint
```

  Expected: `✔ No ESLint errors` (0 errors; pre-existing warnings unchanged).

- Step: unit + integration tests.

```
npx vitest run
```

  Expected: all suites pass, including `modules/jobs/domain/job.test.ts`,
  `modules/jobs/app/{create-manual-job,update-job,archive-job}.test.ts`,
  `lib/store/slices/jobs-slice.test.ts`, `lib/store/dto-mapper.test.ts`, and (with a
  test DB) `modules/jobs/api/job-router.int.test.ts` +
  `modules/jobs/infra/drizzle-job-repository.int.test.ts`.

- Step: coverage gate (80 lines / 75 branches).

```
npm run coverage
```

  Expected: global coverage >= 80% lines / 75% branches; the new use-cases, DTO
  mapping, router procedures, and slice actions are all exercised by the tests above.

- Step: production build.

```
npm run build
```

  Expected: `✓ Compiled successfully` — the new tRPC procedures type-check into the
  client `RouterOutputs`/`RouterInputs` and the modal wiring builds.

- Step: open the PR (analyze the full commit range, not just the latest commit).

```
git push -u origin phase-4-jobs-persistence
gh pr create --title "Phase 4: Jobs persistence (svc column + create/update/archive)" --body "$(cat <<'EOF'
## Summary
- Add `svc` column to `jobs` (migration 0045); no `archived` column — soft-delete via `deleted_at` is the DB truth.
- New `v1.jobs.create` (manual unscheduled job for a lead), `v1.jobs.update` (title/svc/notes), `v1.jobs.archive` — backed by `CreateManualJob`/`UpdateJob`/`ArchiveJob` use-cases mirroring the companies module.
- `dtoJobToStoreJob` now reads `svc` from the DTO.
- Store: `addJob` persists via `v1.jobs.create` (client-authored id, removes the origin-skip), `updateJob`/`setJobSvc` persist via `v1.jobs.update` (local-only fields filtered by `buildJobUpdatePayload`), `archiveJob`/`deleteJob` persist via `v1.jobs.archive` (both soft-delete).
- New-Job modal creates a lead first so a manual job always has a `leadId` FK and survives refresh.

## Test plan
- [x] Unit: `Job.patchFields`, all three use-cases (happy + not-found + validation), slice actions (optimistic/persist/reconcile/rollback), `buildJobUpdatePayload`, `dtoJobToStoreJob` svc mapping.
- [x] Integration (live RLS): create/update/list, archive, NOT_FOUND, cross-tenant isolation, tech FORBIDDEN.
- [x] E2E: a manually created job survives a full page reload and appears on the board.
- [x] Gate: typecheck · lint (0 errors) · vitest · coverage 80/75 · build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

  Expected: PR created against the default branch; CI runs the same gate green.


## Phase 5: Job execution data (add-ons / lines, verify answers, photos w/ Supabase Storage)

**Depends on:** Phase 4 (adds `v1.jobs.create`/`update`/`archive`, plus `job_type`/`svc` on `jobs`). This phase reuses the existing `jobs` table + `DrizzleJobRepository` from `@mallet/jobs` and its `toJobDTO` shape. The whole slice of job-execution state that is store-only today — `addAddon` (L426), `setAddonStatus` (L444), `setAddonInvSkip` (L452), `checkVerifyItem` (L460), `overrideVerifyItem` (L465), `uncheckVerifyItem` (L470), `addJobPhoto` (L479) in `lib/store/slices/jobs-slice.ts` — becomes DB-backed here.

**CONSUMES (from Phase 4):** `jobs` table + `v1.jobs` router (owner/office), `DrizzleJobRepository`, `jobDTO`/`toJobDTO`. `job_visits` (existing), `estimate_lines` schema pattern (child collection with composite FK + own `org_id` + own RLS).

**PRODUCES (later phases / store rely on these EXACT names):**
- Tables: `job_lines`, `job_addons`, `job_verify_answers`, `job_photos` (all org-scoped, RLS via `current_org_id()`, soft-delete on line/addon/photo; verify-answers hard-keyed on `(org_id, job_id, item_id)` with an `answer` state).
- Storage: bucket `job-photos` (private) with org-prefixed key layout `<org_id>/<job_id>/<uuid>.<ext>` and read/write policies scoped to `current_org_id()` (JWT-driven; documented below).
- Port: `PhotoStorageGateway` (`@mallet/jobs`), pilot binding `SupabasePhotoStorageGateway`, added to `AppDeps` as `photoStorageGateway: PhotoStorageGateway | null`.
- DTOs: `jobLineDTO`, `jobAddonDTO`, `jobVerifyAnswerDTO`, `jobPhotoDTO`, `photoUploadUrlDTO`; the existing `jobDTO`/`jobSummaryDTO` are EXTENDED with `lines`, `addons`, `verifyAnswers`, `photos` arrays so every mutation return + the hydrator carry execution data.
- Router `v1.jobs`: `addLine`, `updateLine`, `removeLine`, `setAddonStatus`, `setAddonInvSkip`, `setVerifyAnswer`, `photoUploadUrl`, `addPhoto`, `removePhoto` (all return the full refreshed `jobDTO`, mirroring `v1.visits.*`). `addAddon` is added alongside the addon-status ops so the found-work flow can persist a new addon.
- Store: the seven actions above switch to optimistic → `trpcVanilla.v1.jobs.<op>.mutate` → reconcile via `dtoJobToStoreJob` / rollback. `JobsHydrator` + `dtoJobToStoreJob` load `lines`/`addons`/`verify`/`photos`.

> **Convention note (units + soft-delete):** money in integer cents (`rateCents`, `costCents`); quantities are `numeric(12,2, mode:number)` like `estimate_lines`. Every table carries its own `org_id` (stamped on insert, isolated independently by RLS — same as `job_visits` per migration `0026`). `job_lines`/`job_addons`/`job_photos` soft-delete via `deleted_at`; `job_verify_answers` is an upsert-per-item table (unchecking hard-deletes the single answer row — matches `uncheckVerifyItem`, which removes the key). Migrations numbered from **0044** upward; RLS hand-written into each migration copying the `0026`/`0006` policy syntax exactly.

---

### Task 1: Schema — `job_lines`, `job_addons`, `job_verify_answers`, `job_photos`

**Files:**
- Create `shared/db/schema/job-execution.ts`
- Modify `shared/db/schema/index.ts` (add one export line)

**Interfaces:**
- Consumes: `jobs` (existing `pgTable`, exposes composite unique `jobs_org_id_uq` on `(org_id, id)`), `orgs`.
- Produces: `jobLines`, `jobAddons`, `jobVerifyAnswers`, `jobPhotos` Drizzle tables (`typeof jobLines.$inferSelect` etc. are the row types the mapper in Task 3 relies on).

**Steps:**

- Step: create the schema module. Write `shared/db/schema/job-execution.ts`:

```typescript
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { jobs } from "./jobs";

// Job execution data — the field-captured tail of a job. Every table carries its own org_id
// (stamped on insert) and is isolated independently by RLS (same model as job_visits, migration
// 0026). Composite FK (org_id, job_id) → jobs(org_id, id) so a child can never point at another
// tenant's job. Money is integer cents; quantities mirror estimate_lines' numeric(12,2).

// Billable job line items (the tech's line edits on the job, distinct from the estimate snapshot).
export const jobLines = pgTable(
  "job_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull().default(1),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_lines_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("job_lines_org_job_idx").on(t.orgId, t.jobId),
    check("job_lines_qty_check", sql`${t.quantity} >= 0`),
    check("job_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("job_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);

// Found-work add-ons discovered on site. status: proposed → approved | declined. invoiceSkip keeps
// an approved add-on off the current bill while leaving it on the job.
export const jobAddons = pgTable(
  "job_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull().default(1),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    isOptional: boolean("is_optional").notNull().default(false),
    invoiceSkip: boolean("invoice_skip").notNull().default(false),
    status: text("status").notNull().default("proposed"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_addons_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("job_addons_org_job_idx").on(t.orgId, t.jobId),
    check("job_addons_qty_check", sql`${t.quantity} >= 0`),
    check("job_addons_rate_check", sql`${t.rateCents} >= 0`),
    check("job_addons_cost_check", sql`${t.costCents} >= 0`),
    check("job_addons_status_check", sql`${t.status} in ('proposed', 'approved', 'declined')`),
  ],
);

// One before-you-leave checklist answer per (job, checklist item). Upsert-keyed on
// (org_id, job_id, item_id) so re-answering replaces; unchecking deletes the single row. state:
// pass (checked, via manual|photo) | override (N/A with reason). item_id is the store's numeric
// checklist item id (stable per checklist template).
export const jobVerifyAnswers = pgTable(
  "job_verify_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    itemId: integer("item_id").notNull(),
    state: text("state").notNull(),
    via: text("via"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "job_verify_answers_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    // One answer per checklist item per job — the upsert conflict target.
    unique("job_verify_answers_item_uq").on(t.orgId, t.jobId, t.itemId),
    index("job_verify_answers_org_job_idx").on(t.orgId, t.jobId),
    check("job_verify_answers_state_check", sql`${t.state} in ('pass', 'override')`),
  ],
);

// A field photo. storagePath is the org-prefixed key inside the private 'job-photos' bucket
// (<org_id>/<job_id>/<uuid>.<ext>). verifyPass true when the upload auto-passed the next photo
// checklist item (mirrors addJobPhoto's auto-pass). caption is optional free text.
export const jobPhotos = pgTable(
  "job_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    storagePath: text("storage_path").notNull(),
    caption: text("caption"),
    verifyPass: boolean("verify_pass").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_photos_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    // A storage path is written once per org — dedup guard against a double-record on retry.
    unique("job_photos_org_path_uq").on(t.orgId, t.storagePath),
    index("job_photos_org_job_idx").on(t.orgId, t.jobId),
  ],
);
```

- Step: export from the schema barrel. Edit `shared/db/schema/index.ts` — add after the `./messages` line:

```typescript
export * from "./job-execution";
```

- Step: typecheck the schema compiles. Run `npx tsc --noEmit`. Expected: `0` errors (this is schema-only; no test yet — the migration test in Task 2 exercises it).

- Step: commit.

```bash
git add shared/db/schema/job-execution.ts shared/db/schema/index.ts
git commit -m "feat(jobs): add job_lines/job_addons/job_verify_answers/job_photos schema"
```

---

### Task 2: Migration 0044 — create tables + hand-written RLS

**Files:**
- Create `shared/db/migrations/0044_job_execution.sql` (rename the drizzle-kit-generated file)
- Create `shared/db/migrations/0045_job_execution_rls.sql`
- Modify `shared/db/migrations/meta/_journal.json` + `meta/00XX_snapshot.json` (drizzle-kit writes these on generate)

**Interfaces:**
- Consumes: the Task 1 tables; existing `public.current_org_id()` SQL function (defined in migration `0001`, reused — never redefined).
- Produces: the four physical tables + four RLS policies. Later int tests (Task 8) rely on RLS being ON + FORCED.

**Steps:**

- Step: generate the DDL migration from the schema. Run:

```bash
npm run db:generate
```

Expected: drizzle-kit prints `4 tables` created and writes a new `shared/db/migrations/00XX_<random>.sql` plus updates `meta/_journal.json` and a new snapshot. (drizzle-kit does NOT emit RLS — that is hand-added in the next step.)

- Step: rename the generated DDL file to a stable numbered name and confirm its contents. Run:

```bash
mv "$(ls -t shared/db/migrations/00*.sql | head -1)" shared/db/migrations/0044_job_execution.sql
```

Then update the matching `_journal.json` entry `tag` to `0044_job_execution` (drizzle reads the folder + journal; the tag must match the filename base). The DDL body must contain (verify with `Read`):

```sql
CREATE TABLE "job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT 1 NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_lines_qty_check" CHECK ("job_lines"."quantity" >= 0),
	CONSTRAINT "job_lines_rate_check" CHECK ("job_lines"."rate_cents" >= 0),
	CONSTRAINT "job_lines_cost_check" CHECK ("job_lines"."cost_cents" >= 0)
);
--> statement-breakpoint
-- job_addons, job_verify_answers, job_photos CREATE TABLE blocks follow, then the
-- ADD CONSTRAINT ... FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id) lines and indexes.
```

(No hand-edit to the DDL itself — only the filename/tag rename. If the generated table order differs, that is fine; the FK + index statements are what matters and drizzle emits them.)

- Step: hand-write the RLS migration, copying the exact `0026`/`0006` syntax. Write `shared/db/migrations/0045_job_execution_rls.sql`:

```sql
-- Tenant isolation for job execution data. Same model as job_visits (0026) and estimate_lines
-- (0006): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy
-- keyed on org_id, fail-closed when unset. Each child table carries its own org_id (stamped on
-- insert), so it isolates independently of its parent job — the runtime role (NOBYPASSRLS) can
-- never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.job_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_addons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_addons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_verify_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_verify_answers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY job_lines_tenant_isolation ON public.job_lines
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_addons_tenant_isolation ON public.job_addons
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_verify_answers_tenant_isolation ON public.job_verify_answers
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_photos_tenant_isolation ON public.job_photos
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
```

- Step: register the RLS migration in the journal. drizzle-kit only tracks generated files, so add a hand-written entry to `shared/db/migrations/meta/_journal.json` `entries` array (copy the shape of the `0026`/`0041` `_rls` entries — an increasing `idx`, `version: "7"`, a `when` epoch-ms slightly after the 0044 entry, `tag: "0045_job_execution_rls"`, `breakpoints: true`).

- Step: apply the migrations against the test DB. Run:

```bash
npm run db:migrate
```

Expected: applies `0044_job_execution` then `0045_job_execution_rls` with no error; `psql` `\dt` would now show the four tables.

- Step: prove RLS is enforced on the new tables. Run the repo's RLS proof harness:

```bash
npm run db:rls-proof
```

Expected: output includes the four new tables with `rls=enabled force=true policies=1` (the script asserts every tenant table is ENABLED + FORCED; a missing policy fails the run).

- Step: commit.

```bash
git add shared/db/migrations/0044_job_execution.sql shared/db/migrations/0045_job_execution_rls.sql shared/db/migrations/meta
git commit -m "feat(jobs): migrate job execution tables 0044 + RLS 0045"
```

---

### Task 3: Domain value objects + repository interface extension

**Files:**
- Create `modules/jobs/domain/job-execution.ts`
- Create `modules/jobs/domain/job-execution.test.ts`
- Modify `modules/jobs/domain/job-repository.ts` (append execution-data methods)
- Modify `modules/jobs/index.ts` (export the new value-object types)

**Interfaces:**
- Consumes: `JobId`, `Money`, `Result`, `ValidationError`, `validation`, `ok`, `err`, `money` from `@mallet/shared/types`.
- Produces: `JobLine`, `JobAddon`, `JobVerifyAnswer`, `JobPhoto` value objects (with `.props`); `JOB_ADDON_STATUSES`, `isAddonStatus`, `VERIFY_STATES`, `isVerifyState`; the extended `JobRepository` interface (methods listed below) that Task 4 use-cases and Task 5 Drizzle repo depend on.

**Steps:**

- Step: write the failing test. Write `modules/jobs/domain/job-execution.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { asJobId, isOk, isErr } from "@mallet/shared/types";
import {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
} from "./job-execution";

const JOB = asJobId("11111111-1111-1111-1111-111111111111");

describe("JobLine", () => {
  it("rejects an empty description", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "  ",
      quantity: 1,
      rateCents: 5000,
      costCents: 0,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("description");
  });

  it("rejects a negative rate", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "Panel swap",
      quantity: 1,
      rateCents: -1,
      costCents: 0,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("rateCents");
  });

  it("trims description and exposes props on the happy path", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "  Panel swap  ",
      quantity: 2,
      rateCents: 5000,
      costCents: 1000,
      position: 3,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.description).toBe("Panel swap");
      expect(r.value.props.rate.cents).toBe(5000);
      expect(r.value.props.position).toBe(3);
    }
  });
});

describe("JobAddon", () => {
  it("rejects an unknown status", () => {
    const r = JobAddon.create({
      id: "a1",
      jobId: JOB,
      description: "Extra outlet",
      quantity: 1,
      rateCents: 9000,
      costCents: 0,
      isOptional: false,
      invoiceSkip: false,
      status: "bogus",
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("status");
  });

  it("accepts proposed/approved/declined and preserves invoiceSkip", () => {
    const r = JobAddon.create({
      id: "a1",
      jobId: JOB,
      description: "Extra outlet",
      quantity: 1,
      rateCents: 9000,
      costCents: 0,
      isOptional: true,
      invoiceSkip: true,
      status: "approved",
      position: 0,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("approved");
      expect(r.value.props.invoiceSkip).toBe(true);
    }
  });
});

describe("JobVerifyAnswer", () => {
  it("requires a reason when state is override", () => {
    const r = JobVerifyAnswer.create({
      jobId: JOB,
      itemId: 7,
      state: "override",
      via: null,
      reason: "  ",
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("reason");
  });

  it("accepts a pass answer with a via and no reason", () => {
    const r = JobVerifyAnswer.create({
      jobId: JOB,
      itemId: 7,
      state: "pass",
      via: "photo",
      reason: null,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.state).toBe("pass");
      expect(r.value.props.via).toBe("photo");
    }
  });
});

describe("JobPhoto", () => {
  it("rejects an empty storage path", () => {
    const r = JobPhoto.create({
      id: "p1",
      jobId: JOB,
      storagePath: "",
      caption: null,
      verifyPass: false,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("storagePath");
  });

  it("accepts a valid path", () => {
    const r = JobPhoto.create({
      id: "p1",
      jobId: JOB,
      storagePath: "org/job/photo.jpg",
      caption: "before",
      verifyPass: true,
      position: 0,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.storagePath).toBe("org/job/photo.jpg");
  });
});
```

- Step: run it, expected FAIL. Run `npx vitest run modules/jobs/domain/job-execution.test.ts`. Expected: FAIL with `Cannot find module './job-execution'`.

- Step: minimal implementation. Write `modules/jobs/domain/job-execution.ts`:

```typescript
import type { JobId, Money, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err, money } from "@mallet/shared/types";

export type AddonStatus = "proposed" | "approved" | "declined";
export const JOB_ADDON_STATUSES: readonly AddonStatus[] = ["proposed", "approved", "declined"];
export const isAddonStatus = (v: string): v is AddonStatus =>
  (JOB_ADDON_STATUSES as readonly string[]).includes(v);

export type VerifyState = "pass" | "override";
export const VERIFY_STATES: readonly VerifyState[] = ["pass", "override"];
export const isVerifyState = (v: string): v is VerifyState =>
  (VERIFY_STATES as readonly string[]).includes(v);

export interface JobLineProps {
  readonly id: string;
  readonly jobId: JobId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money;
  readonly cost: Money;
  readonly position: number;
}

export class JobLine {
  private constructor(private readonly p: JobLineProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    description: string;
    quantity: number;
    rateCents: number;
    costCents: number;
    position: number;
  }): Result<JobLine, ValidationError> {
    const description = input.description.trim();
    if (description.length === 0) return err(validation("line description is required", "description"));
    if (input.quantity < 0) return err(validation("quantity cannot be negative", "quantity"));
    if (input.rateCents < 0) return err(validation("rate cannot be negative", "rateCents"));
    if (input.costCents < 0) return err(validation("cost cannot be negative", "costCents"));
    return ok(
      new JobLine({
        id: input.id,
        jobId: input.jobId,
        description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        position: input.position,
      }),
    );
  }

  get props(): JobLineProps {
    return this.p;
  }
}

export interface JobAddonProps {
  readonly id: string;
  readonly jobId: JobId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money;
  readonly cost: Money;
  readonly isOptional: boolean;
  readonly invoiceSkip: boolean;
  readonly status: AddonStatus;
  readonly position: number;
}

export class JobAddon {
  private constructor(private readonly p: JobAddonProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    description: string;
    quantity: number;
    rateCents: number;
    costCents: number;
    isOptional: boolean;
    invoiceSkip: boolean;
    status: string;
    position: number;
  }): Result<JobAddon, ValidationError> {
    const description = input.description.trim();
    if (description.length === 0) return err(validation("add-on description is required", "description"));
    if (input.quantity < 0) return err(validation("quantity cannot be negative", "quantity"));
    if (input.rateCents < 0) return err(validation("rate cannot be negative", "rateCents"));
    if (input.costCents < 0) return err(validation("cost cannot be negative", "costCents"));
    if (!isAddonStatus(input.status)) return err(validation(`unknown add-on status: ${input.status}`, "status"));
    return ok(
      new JobAddon({
        id: input.id,
        jobId: input.jobId,
        description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        isOptional: input.isOptional,
        invoiceSkip: input.invoiceSkip,
        status: input.status,
        position: input.position,
      }),
    );
  }

  get props(): JobAddonProps {
    return this.p;
  }
}

export interface JobVerifyAnswerProps {
  readonly jobId: JobId;
  readonly itemId: number;
  readonly state: VerifyState;
  readonly via: string | null;
  readonly reason: string | null;
}

export class JobVerifyAnswer {
  private constructor(private readonly p: JobVerifyAnswerProps) {}

  static create(input: {
    jobId: JobId;
    itemId: number;
    state: string;
    via: string | null;
    reason: string | null;
  }): Result<JobVerifyAnswer, ValidationError> {
    if (!isVerifyState(input.state)) return err(validation(`unknown verify state: ${input.state}`, "state"));
    if (!Number.isInteger(input.itemId)) return err(validation("itemId must be an integer", "itemId"));
    const reason = input.reason?.trim() ?? null;
    if (input.state === "override" && (reason ?? "").length === 0) {
      return err(validation("an override answer requires a reason", "reason"));
    }
    return ok(
      new JobVerifyAnswer({
        jobId: input.jobId,
        itemId: input.itemId,
        state: input.state,
        via: input.via,
        reason,
      }),
    );
  }

  get props(): JobVerifyAnswerProps {
    return this.p;
  }
}

export interface JobPhotoProps {
  readonly id: string;
  readonly jobId: JobId;
  readonly storagePath: string;
  readonly caption: string | null;
  readonly verifyPass: boolean;
  readonly position: number;
}

export class JobPhoto {
  private constructor(private readonly p: JobPhotoProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    storagePath: string;
    caption: string | null;
    verifyPass: boolean;
    position: number;
  }): Result<JobPhoto, ValidationError> {
    const storagePath = input.storagePath.trim();
    if (storagePath.length === 0) return err(validation("storage path is required", "storagePath"));
    return ok(
      new JobPhoto({
        id: input.id,
        jobId: input.jobId,
        storagePath,
        caption: input.caption,
        verifyPass: input.verifyPass,
        position: input.position,
      }),
    );
  }

  get props(): JobPhotoProps {
    return this.p;
  }
}
```

- Step: extend the repository interface. Edit `modules/jobs/domain/job-repository.ts` — add the import and the methods. Add to the top import block:

```typescript
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto } from "./job-execution";
```

Then inside `interface JobRepository { ... }`, after `listByLead(...)`, append:

```typescript
  // ── job execution data (Phase 5) ─────────────────────────────────────────
  // Each returns the loaded child collections for a job so a use-case can hand the router the
  // refreshed full-job DTO. All are org-implicit (the tx is tenant-scoped) and non-deleted only.
  listExecution(jobId: JobId): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }>;
  addLine(line: JobLine, now: Date): Promise<void>;
  updateLine(line: JobLine, now: Date): Promise<number>; // rows affected; 0 = not found
  removeLine(jobId: JobId, lineId: string, now: Date): Promise<number>;
  addAddon(addon: JobAddon, now: Date): Promise<void>;
  setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number>;
  setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number>;
  upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void>;
  removeVerifyAnswer(jobId: JobId, itemId: number): Promise<number>;
  addPhoto(photo: JobPhoto, now: Date): Promise<void>;
  removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number>;
```

And add `AddonStatus` to the value-object import:

```typescript
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "./job-execution";
```

- Step: export the types. Edit `modules/jobs/index.ts` — add after the existing `export type { JobRepository, JobFilter } ...` line:

```typescript
export type {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
  AddonStatus,
  VerifyState,
} from "./domain/job-execution";
export { JOB_ADDON_STATUSES, VERIFY_STATES, isAddonStatus, isVerifyState } from "./domain/job-execution";
```

- Step: run it, expected PASS. Run `npx vitest run modules/jobs/domain/job-execution.test.ts`. Expected: all cases green (JobLine 3, JobAddon 2, JobVerifyAnswer 2, JobPhoto 2).

- Step: commit.

```bash
git add modules/jobs/domain/job-execution.ts modules/jobs/domain/job-execution.test.ts modules/jobs/domain/job-repository.ts modules/jobs/index.ts
git commit -m "feat(jobs): job execution value objects + repository interface"
```

---

### Task 4: Use-cases (add/update/remove line, addon status/skip/add, verify, photo add/remove)

**Files:**
- Create `modules/jobs/app/job-execution-use-cases.ts` (all execution use-cases in one cohesive module — each class < 40 lines)
- Create `modules/jobs/app/job-execution-use-cases.test.ts`
- Modify `modules/jobs/index.ts` (export the use-cases)

**Interfaces:**
- Consumes: extended `JobRepository` (Task 3), `JobLine`/`JobAddon`/`JobVerifyAnswer`/`JobPhoto` (Task 3), `Clock`, `IdGenerator`, `Result`, `AppError`, `notFound`, `ok`, `err`, `logger`. Each use-case, after mutating, calls `repo.findById(jobId)` + `repo.listExecution(jobId)` and returns `{ job, execution }` so the router can build the full DTO.
- Produces: `AddJobLineUseCase`, `UpdateJobLineUseCase`, `RemoveJobLineUseCase`, `AddJobAddonUseCase`, `SetAddonStatusUseCase`, `SetAddonInvoiceSkipUseCase`, `SetVerifyAnswerUseCase`, `AddJobPhotoUseCase`, `RemoveJobPhotoUseCase`; the shared `JobWithExecution` type the router (Task 7) consumes.

**Steps:**

- Step: write the failing test. Write `modules/jobs/app/job-execution-use-cases.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { asJobId, asOrgId, FixedClock, isOk, isErr, type JobId } from "@mallet/shared/types";
import { JobLine, JobAddon, JobVerifyAnswer, JobPhoto } from "../domain/job-execution";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";
import {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "./job-execution-use-cases";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING: JobId = asJobId("99999999-9999-9999-9999-999999999999");

// A fake job aggregate is enough for these use-cases — they only read findById !== null.
const fakeJob = { props: { id: JOB } } as unknown as Job;

class FakeRepo implements Partial<JobRepository> {
  jobs = new Map<string, Job>([[JOB, fakeJob]]);
  lines: JobLine[] = [];
  addons: JobAddon[] = [];
  answers: JobVerifyAnswer[] = [];
  photos: JobPhoto[] = [];

  async findById(id: JobId): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async listExecution(): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }> {
    return { lines: this.lines, addons: this.addons, verifyAnswers: this.answers, photos: this.photos };
  }
  async addLine(line: JobLine): Promise<void> {
    this.lines.push(line);
  }
  async updateLine(line: JobLine): Promise<number> {
    const i = this.lines.findIndex((l) => l.props.id === line.props.id);
    if (i < 0) return 0;
    this.lines[i] = line;
    return 1;
  }
  async removeLine(_j: JobId, lineId: string): Promise<number> {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.props.id !== lineId);
    return before - this.lines.length;
  }
  async addAddon(addon: JobAddon): Promise<void> {
    this.addons.push(addon);
  }
  async setAddonStatus(_j: JobId, addonId: string): Promise<number> {
    return this.addons.some((a) => a.props.id === addonId) ? 1 : 0;
  }
  async setAddonInvoiceSkip(_j: JobId, addonId: string): Promise<number> {
    return this.addons.some((a) => a.props.id === addonId) ? 1 : 0;
  }
  async upsertVerifyAnswer(answer: JobVerifyAnswer): Promise<void> {
    this.answers.push(answer);
  }
  async removeVerifyAnswer(_j: JobId, itemId: number): Promise<number> {
    const before = this.answers.length;
    this.answers = this.answers.filter((a) => a.props.itemId !== itemId);
    return before - this.answers.length;
  }
  async addPhoto(photo: JobPhoto): Promise<void> {
    this.photos.push(photo);
  }
  async removePhoto(_j: JobId, photoId: string): Promise<number> {
    const before = this.photos.length;
    this.photos = this.photos.filter((p) => p.props.id !== photoId);
    return before - this.photos.length;
  }
}

const ids = (id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") => ({ newId: () => id });

describe("job execution use-cases", () => {
  let repo: FakeRepo;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeRepo();
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
  });

  it("AddJobLine inserts and returns the job + execution with the new line", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "Panel swap", quantity: 1, rateCents: 5000, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.lines).toHaveLength(1);
  });

  it("AddJobLine on a missing job returns not_found", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: MISSING, description: "x", quantity: 1, rateCents: 100, costCents: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("AddJobLine rejects an empty description (validation)", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "  ", quantity: 1, rateCents: 100, costCents: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("UpdateJobLine on an unknown line returns not_found", async () => {
    const uc = new UpdateJobLineUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, lineId: "nope", description: "x", quantity: 1, rateCents: 100, costCents: 0, position: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("RemoveJobLine deletes and returns the job", async () => {
    await new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids("line-1")).exec(
      { jobId: JOB, description: "L", quantity: 1, rateCents: 100, costCents: 0 },
      ORG,
    );
    const r = await new RemoveJobLineUseCase(repo as unknown as JobRepository, clock).exec({ jobId: JOB, lineId: "line-1" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.lines).toHaveLength(0);
  });

  it("AddJobAddon inserts a proposed addon", async () => {
    const uc = new AddJobAddonUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "Extra outlet", quantity: 1, rateCents: 9000, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.addons[0]?.props.status).toBe("proposed");
  });

  it("SetAddonStatus on a missing addon returns not_found", async () => {
    const uc = new SetAddonStatusUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, addonId: "missing", status: "approved" }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("SetAddonInvoiceSkip on a missing addon returns not_found", async () => {
    const uc = new SetAddonInvoiceSkipUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, addonId: "missing", invoiceSkip: true }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("SetVerifyAnswer with state=pass upserts an answer", async () => {
    const uc = new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, itemId: 3, state: "pass", via: "manual", reason: null }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.verifyAnswers).toHaveLength(1);
  });

  it("SetVerifyAnswer with state=override and no reason is validation", async () => {
    const uc = new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, itemId: 3, state: "override", via: null, reason: " " }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("SetVerifyAnswer with state=clear removes the answer", async () => {
    await new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock).exec(
      { jobId: JOB, itemId: 3, state: "pass", via: "manual", reason: null },
      ORG,
    );
    const r = await new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock).exec(
      { jobId: JOB, itemId: 3, state: "clear", via: null, reason: null },
      ORG,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.verifyAnswers).toHaveLength(0);
  });

  it("AddJobPhoto records the metadata row", async () => {
    const uc = new AddJobPhotoUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, storagePath: "org/job/p.jpg", caption: null, verifyPass: true }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.photos).toHaveLength(1);
  });

  it("RemoveJobPhoto on a missing photo returns not_found", async () => {
    const uc = new RemoveJobPhotoUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, photoId: "missing" }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
```

- Step: run it, expected FAIL. Run `npx vitest run modules/jobs/app/job-execution-use-cases.test.ts`. Expected: FAIL with `Cannot find module './job-execution-use-cases'`.

- Step: minimal implementation. Write `modules/jobs/app/job-execution-use-cases.ts`:

```typescript
import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
  type AddonStatus,
} from "../domain/job-execution";

// The unit every execution use-case returns: the (still-loaded) job header + its refreshed child
// collections. The router maps this into the full jobDTO so the client re-syncs the whole job.
export interface JobWithExecution {
  readonly job: Job;
  readonly execution: {
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  };
}

// Load the job (fail-closed not_found) + its execution collections for the return value.
async function loadOrThrow(
  repo: JobRepository,
  jobId: JobId,
): Promise<Result<JobWithExecution, AppError>> {
  const job = await repo.findById(jobId);
  if (!job) return err(notFound("job not found"));
  const execution = await repo.listExecution(jobId);
  return ok({ job, execution });
}

export interface AddJobLineCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly position?: number;
}

export class AddJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const line = JobLine.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      position: cmd.position ?? 0,
    });
    if (!line.ok) return line;
    await this.repo.addLine(line.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_line.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface UpdateJobLineCommand {
  readonly jobId: JobId;
  readonly lineId: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly position: number;
}

export class UpdateJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const line = JobLine.create({
      id: cmd.lineId,
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      position: cmd.position,
    });
    if (!line.ok) return line;
    const affected = await this.repo.updateLine(line.value, this.clock.now());
    if (affected === 0) return err(notFound("job line not found"));
    logger.info({ jobId: cmd.jobId, lineId: cmd.lineId, orgId }, "job_line.updated");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface RemoveJobLineCommand {
  readonly jobId: JobId;
  readonly lineId: string;
}

export class RemoveJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.removeLine(cmd.jobId, cmd.lineId, this.clock.now());
    if (affected === 0) return err(notFound("job line not found"));
    logger.info({ jobId: cmd.jobId, lineId: cmd.lineId, orgId }, "job_line.removed");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface AddJobAddonCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly isOptional?: boolean;
  readonly position?: number;
}

export class AddJobAddonUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobAddonCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const addon = JobAddon.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      isOptional: cmd.isOptional ?? false,
      invoiceSkip: false,
      status: "proposed",
      position: cmd.position ?? 0,
    });
    if (!addon.ok) return addon;
    await this.repo.addAddon(addon.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_addon.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface SetAddonStatusCommand {
  readonly jobId: JobId;
  readonly addonId: string;
  readonly status: AddonStatus;
}

export class SetAddonStatusUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetAddonStatusCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.setAddonStatus(cmd.jobId, cmd.addonId, cmd.status, this.clock.now());
    if (affected === 0) return err(notFound("job add-on not found"));
    logger.info({ jobId: cmd.jobId, addonId: cmd.addonId, status: cmd.status, orgId }, "job_addon.status_set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface SetAddonInvoiceSkipCommand {
  readonly jobId: JobId;
  readonly addonId: string;
  readonly invoiceSkip: boolean;
}

export class SetAddonInvoiceSkipUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetAddonInvoiceSkipCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.setAddonInvoiceSkip(cmd.jobId, cmd.addonId, cmd.invoiceSkip, this.clock.now());
    if (affected === 0) return err(notFound("job add-on not found"));
    logger.info({ jobId: cmd.jobId, addonId: cmd.addonId, orgId }, "job_addon.invoice_skip_set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

// state 'clear' removes the answer (mirrors uncheckVerifyItem); pass|override upsert one.
export interface SetVerifyAnswerCommand {
  readonly jobId: JobId;
  readonly itemId: number;
  readonly state: "pass" | "override" | "clear";
  readonly via: string | null;
  readonly reason: string | null;
}

export class SetVerifyAnswerUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetVerifyAnswerCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    if (cmd.state === "clear") {
      await this.repo.removeVerifyAnswer(cmd.jobId, cmd.itemId);
      logger.info({ jobId: cmd.jobId, itemId: cmd.itemId, orgId }, "job_verify.cleared");
      return loadOrThrow(this.repo, cmd.jobId);
    }
    const answer = JobVerifyAnswer.create({
      jobId: cmd.jobId,
      itemId: cmd.itemId,
      state: cmd.state,
      via: cmd.via,
      reason: cmd.reason,
    });
    if (!answer.ok) return answer;
    await this.repo.upsertVerifyAnswer(answer.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, itemId: cmd.itemId, state: cmd.state, orgId }, "job_verify.set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface AddJobPhotoCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly storagePath: string;
  readonly caption: string | null;
  readonly verifyPass: boolean;
  readonly position?: number;
}

export class AddJobPhotoUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobPhotoCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const photo = JobPhoto.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      storagePath: cmd.storagePath,
      caption: cmd.caption,
      verifyPass: cmd.verifyPass,
      position: cmd.position ?? 0,
    });
    if (!photo.ok) return photo;
    await this.repo.addPhoto(photo.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_photo.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface RemoveJobPhotoCommand {
  readonly jobId: JobId;
  readonly photoId: string;
}

export class RemoveJobPhotoUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveJobPhotoCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.removePhoto(cmd.jobId, cmd.photoId, this.clock.now());
    if (affected === 0) return err(notFound("job photo not found"));
    logger.info({ jobId: cmd.jobId, photoId: cmd.photoId, orgId }, "job_photo.removed");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}
```

- Step: export the use-cases + type. Edit `modules/jobs/index.ts` — add after the `export { ListJobsUseCase } ...` line:

```typescript
export {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "./app/job-execution-use-cases";
export type { JobWithExecution } from "./app/job-execution-use-cases";
```

- Step: run it, expected PASS. Run `npx vitest run modules/jobs/app/job-execution-use-cases.test.ts`. Expected: all 13 cases green.

- Step: commit.

```bash
git add modules/jobs/app/job-execution-use-cases.ts modules/jobs/app/job-execution-use-cases.test.ts modules/jobs/index.ts
git commit -m "feat(jobs): job execution use-cases (lines/addons/verify/photos)"
```

---

### Task 5: Drizzle repository implementation + execution mapper

**Files:**
- Create `modules/jobs/infra/job-execution-mapper.ts`
- Modify `modules/jobs/infra/drizzle-job-repository.ts` (implement the Task-3 methods)

**Interfaces:**
- Consumes: `jobLines`/`jobAddons`/`jobVerifyAnswers`/`jobPhotos` tables (Task 1); the value objects (Task 3); the extended `JobRepository` interface (Task 3); `TenantTx`.
- Produces: mapper functions `lineToDomain`/`addonToDomain`/`verifyToDomain`/`photoToDomain` and the concrete repo methods. Verified end-to-end by the Task 8 int test (mapper correctness is covered there against the live DB — no separate unit test, mirroring how `job-mapper` is covered by `drizzle-job-repository-visits.int.test.ts`).

**Steps:**

- Step: write the execution mapper. Write `modules/jobs/infra/job-execution-mapper.ts`:

```typescript
import { asJobId } from "@mallet/shared/types";
import { jobLines, jobAddons, jobVerifyAnswers, jobPhotos } from "@mallet/shared/db/schema";
import { JobLine, JobAddon, JobVerifyAnswer, JobPhoto } from "../domain/job-execution";

export type JobLineRow = typeof jobLines.$inferSelect;
export type JobAddonRow = typeof jobAddons.$inferSelect;
export type JobVerifyAnswerRow = typeof jobVerifyAnswers.$inferSelect;
export type JobPhotoRow = typeof jobPhotos.$inferSelect;

export const lineToDomain = (row: JobLineRow): JobLine => {
  const r = JobLine.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    description: row.description,
    quantity: row.quantity,
    rateCents: row.rateCents,
    costCents: row.costCents,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_line ${row.id}: ${r.error.message}`);
  return r.value;
};

export const addonToDomain = (row: JobAddonRow): JobAddon => {
  const r = JobAddon.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    description: row.description,
    quantity: row.quantity,
    rateCents: row.rateCents,
    costCents: row.costCents,
    isOptional: row.isOptional,
    invoiceSkip: row.invoiceSkip,
    status: row.status,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_addon ${row.id}: ${r.error.message}`);
  return r.value;
};

export const verifyToDomain = (row: JobVerifyAnswerRow): JobVerifyAnswer => {
  const r = JobVerifyAnswer.create({
    jobId: asJobId(row.jobId),
    itemId: row.itemId,
    state: row.state,
    via: row.via ?? null,
    reason: row.reason ?? null,
  });
  if (!r.ok) throw new Error(`corrupt job_verify_answer ${row.id}: ${r.error.message}`);
  return r.value;
};

export const photoToDomain = (row: JobPhotoRow): JobPhoto => {
  const r = JobPhoto.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    storagePath: row.storagePath,
    caption: row.caption ?? null,
    verifyPass: row.verifyPass,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_photo ${row.id}: ${r.error.message}`);
  return r.value;
};
```

- Step: implement the repository methods. Edit `modules/jobs/infra/drizzle-job-repository.ts`. Add to the schema import (line 2):

```typescript
import { jobs, jobVisits, jobLines, jobAddons, jobVerifyAnswers, jobPhotos } from "@mallet/shared/db/schema";
```

Add to the value-object/mapper imports (after line 17):

```typescript
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "../domain/job-execution";
import { lineToDomain, addonToDomain, verifyToDomain, photoToDomain, type JobLineRow, type JobAddonRow, type JobVerifyAnswerRow, type JobPhotoRow } from "./job-execution-mapper";
```

Then append these methods inside the `DrizzleJobRepository` class (before the closing `}`):

```typescript
  // ── job execution data (Phase 5) ─────────────────────────────────────────

  async listExecution(jobId: JobId): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }> {
    const [lineRows, addonRows, answerRows, photoRows] = await Promise.all([
      this.tx
        .select()
        .from(jobLines)
        .where(and(eq(jobLines.jobId, jobId), isNull(jobLines.deletedAt)))
        .orderBy(jobLines.position, jobLines.createdAt),
      this.tx
        .select()
        .from(jobAddons)
        .where(and(eq(jobAddons.jobId, jobId), isNull(jobAddons.deletedAt)))
        .orderBy(jobAddons.position, jobAddons.createdAt),
      this.tx
        .select()
        .from(jobVerifyAnswers)
        .where(eq(jobVerifyAnswers.jobId, jobId)),
      this.tx
        .select()
        .from(jobPhotos)
        .where(and(eq(jobPhotos.jobId, jobId), isNull(jobPhotos.deletedAt)))
        .orderBy(jobPhotos.position, jobPhotos.createdAt),
    ]);
    return {
      lines: (lineRows as JobLineRow[]).map(lineToDomain),
      addons: (addonRows as JobAddonRow[]).map(addonToDomain),
      verifyAnswers: (answerRows as JobVerifyAnswerRow[]).map(verifyToDomain),
      photos: (photoRows as JobPhotoRow[]).map(photoToDomain),
    };
  }

  async addLine(line: JobLine, now: Date): Promise<void> {
    const p = line.props;
    await this.tx.insert(jobLines).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      description: p.description,
      quantity: p.quantity,
      rateCents: p.rate,
      costCents: p.cost,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateLine(line: JobLine, now: Date): Promise<number> {
    const p = line.props;
    const rows = await this.tx
      .update(jobLines)
      .set({
        description: p.description,
        quantity: p.quantity,
        rateCents: p.rate,
        costCents: p.cost,
        position: p.position,
        updatedAt: now,
      })
      .where(and(eq(jobLines.id, p.id), eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt)))
      .returning({ id: jobLines.id });
    return rows.length;
  }

  async removeLine(jobId: JobId, lineId: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobLines)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobLines.id, lineId),
          eq(jobLines.jobId, jobId),
          eq(jobLines.orgId, this.orgId),
          isNull(jobLines.deletedAt),
        ),
      )
      .returning({ id: jobLines.id });
    return rows.length;
  }

  async addAddon(addon: JobAddon, now: Date): Promise<void> {
    const p = addon.props;
    await this.tx.insert(jobAddons).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      description: p.description,
      quantity: p.quantity,
      rateCents: p.rate,
      costCents: p.cost,
      isOptional: p.isOptional,
      invoiceSkip: p.invoiceSkip,
      status: p.status,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
  }

  async setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobAddons)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(jobAddons.id, addonId),
          eq(jobAddons.jobId, jobId),
          eq(jobAddons.orgId, this.orgId),
          isNull(jobAddons.deletedAt),
        ),
      )
      .returning({ id: jobAddons.id });
    return rows.length;
  }

  async setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobAddons)
      .set({ invoiceSkip, updatedAt: now })
      .where(
        and(
          eq(jobAddons.id, addonId),
          eq(jobAddons.jobId, jobId),
          eq(jobAddons.orgId, this.orgId),
          isNull(jobAddons.deletedAt),
        ),
      )
      .returning({ id: jobAddons.id });
    return rows.length;
  }

  async upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void> {
    const p = answer.props;
    await this.tx
      .insert(jobVerifyAnswers)
      .values({
        orgId: this.orgId,
        jobId: p.jobId,
        itemId: p.itemId,
        state: p.state,
        via: p.via,
        reason: p.reason,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [jobVerifyAnswers.orgId, jobVerifyAnswers.jobId, jobVerifyAnswers.itemId],
        set: { state: p.state, via: p.via, reason: p.reason, updatedAt: now },
      });
  }

  async removeVerifyAnswer(jobId: JobId, itemId: number): Promise<number> {
    const rows = await this.tx
      .delete(jobVerifyAnswers)
      .where(
        and(
          eq(jobVerifyAnswers.jobId, jobId),
          eq(jobVerifyAnswers.itemId, itemId),
          eq(jobVerifyAnswers.orgId, this.orgId),
        ),
      )
      .returning({ id: jobVerifyAnswers.id });
    return rows.length;
  }

  async addPhoto(photo: JobPhoto, now: Date): Promise<void> {
    const p = photo.props;
    await this.tx.insert(jobPhotos).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      storagePath: p.storagePath,
      caption: p.caption,
      verifyPass: p.verifyPass,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
  }

  async removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobPhotos)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobPhotos.id, photoId),
          eq(jobPhotos.jobId, jobId),
          eq(jobPhotos.orgId, this.orgId),
          isNull(jobPhotos.deletedAt),
        ),
      )
      .returning({ id: jobPhotos.id });
    return rows.length;
  }
```

Also add `JobId` to the existing type import from `@mallet/shared/types` if not already present (it is — line 8 has `JobId`).

- Step: typecheck the repo now satisfies the extended interface. Run `npx tsc --noEmit`. Expected: `0` errors (the class now implements every `JobRepository` method; a missing one would be a type error here).

- Step: commit.

```bash
git add modules/jobs/infra/job-execution-mapper.ts modules/jobs/infra/drizzle-job-repository.ts
git commit -m "feat(jobs): drizzle persistence for job execution data"
```

---

### Task 6: Photo storage gateway port + Supabase adapter + DI wiring

**Files:**
- Create `modules/jobs/domain/photo-storage-gateway.ts`
- Create `modules/jobs/infra/supabase-photo-storage-gateway.ts`
- Create `modules/jobs/infra/supabase-photo-storage-gateway.test.ts`
- Modify `modules/jobs/index.ts` (export the port + adapter)
- Modify `trpc/deps.ts` (add `photoStorageGateway` to `AppDeps`)
- Modify `trpc/di.ts` (build the gateway)

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase/admin` (service-role client, bypasses RLS — server-only, which is why the org-prefixed path + Task 7's `assertMineIfTech`-style guard enforce isolation), `OrgId`, `JobId`, `Result`, `ExternalServiceError`, `externalService`.
- Produces: `PhotoStorageGateway` interface (`createUploadUrl`), `SupabasePhotoStorageGateway`, `JOB_PHOTOS_BUCKET` constant, and `AppDeps.photoStorageGateway`.

**Steps:**

- Step: write the failing adapter test (the port is exercised via a fake Supabase storage client; no live network). Write `modules/jobs/infra/supabase-photo-storage-gateway.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk, isErr } from "@mallet/shared/types";
import { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET } from "./supabase-photo-storage-gateway";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB = asJobId("11111111-1111-1111-1111-111111111111");

// A minimal fake of the Supabase storage surface the adapter uses.
function fakeStorage(result: {
  data: { signedUrl: string; token: string; path: string } | null;
  error: { message: string } | null;
}) {
  const calls: { bucket: string; path: string }[] = [];
  return {
    calls,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async createSignedUploadUrl(path: string) {
              calls.push({ bucket, path });
              return result;
            },
          };
        },
      },
    },
  };
}

describe("SupabasePhotoStorageGateway", () => {
  it("builds an org/job-prefixed path and returns the signed url + token + path", async () => {
    const fake = fakeStorage({
      data: { signedUrl: "https://x/upload", token: "tok", path: "p" },
      error: null,
    });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "jpg", objectId: "abc" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.signedUrl).toBe("https://x/upload");
      expect(r.value.token).toBe("tok");
      expect(r.value.storagePath).toBe(`${ORG}/${JOB}/abc.jpg`);
    }
    expect(fake.calls[0]?.bucket).toBe(JOB_PHOTOS_BUCKET);
    expect(fake.calls[0]?.path).toBe(`${ORG}/${JOB}/abc.jpg`);
  });

  it("rejects an ext with a path separator (path traversal guard)", async () => {
    const fake = fakeStorage({ data: { signedUrl: "u", token: "t", path: "p" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "../secret", objectId: "abc" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("external_service");
  });

  it("maps a storage error to an external_service Result", async () => {
    const fake = fakeStorage({ data: null, error: { message: "bucket missing" } });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "png", objectId: "abc" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.service).toBe("supabase-storage");
    }
  });
});
```

- Step: run it, expected FAIL. Run `npx vitest run modules/jobs/infra/supabase-photo-storage-gateway.test.ts`. Expected: FAIL with `Cannot find module './supabase-photo-storage-gateway'`.

- Step: write the port. Write `modules/jobs/domain/photo-storage-gateway.ts`:

```typescript
import type { OrgId, JobId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface CreateUploadUrlCmd {
  readonly orgId: OrgId;
  readonly jobId: JobId;
  readonly ext: string; // file extension without dot, e.g. "jpg"
  readonly objectId: string; // the caller-minted uuid used as the object filename
}

export interface SignedUpload {
  readonly signedUrl: string; // the URL the browser PUTs the file to
  readonly token: string; // token the browser passes to uploadToSignedUrl
  readonly storagePath: string; // <org_id>/<job_id>/<objectId>.<ext> — recorded on the row
}

// Produces a signed, direct-to-storage upload URL for a job photo. The org-prefixed path is the
// isolation seam: the metadata row (job_photos) is RLS-scoped, and the bucket policy scopes reads
// to the caller's org (see 0046 storage policy). Injected; the pilot binding is
// SupabasePhotoStorageGateway (null when Supabase Storage env is unavailable — photo upload
// self-disables and the router returns PRECONDITION_FAILED).
export interface PhotoStorageGateway {
  createUploadUrl(cmd: CreateUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>>;
}
```

- Step: write the adapter. Write `modules/jobs/infra/supabase-photo-storage-gateway.ts`:

```typescript
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import type {
  PhotoStorageGateway,
  CreateUploadUrlCmd,
  SignedUpload,
} from "../domain/photo-storage-gateway";

// The private bucket for job photos. Org-prefixed key layout <org_id>/<job_id>/<uuid>.<ext>.
export const JOB_PHOTOS_BUCKET = "job-photos";

// The minimal slice of the Supabase client this adapter needs — kept narrow so the unit test can
// substitute a fake without depending on @supabase/supabase-js types.
interface StorageClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{
        data: { signedUrl: string; token: string; path: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

// Reject anything that could escape the org/job prefix or embed a separator.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export class SupabasePhotoStorageGateway implements PhotoStorageGateway {
  constructor(private readonly getClient: () => StorageClient) {}

  async createUploadUrl(cmd: CreateUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>> {
    const ext = cmd.ext.toLowerCase();
    if (!SAFE_SEGMENT.test(ext) || !SAFE_SEGMENT.test(cmd.objectId)) {
      return err(externalService("supabase-storage", "invalid photo path segment", false));
    }
    const storagePath = `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${ext}`;
    try {
      const { data, error } = await this.getClient()
        .storage.from(JOB_PHOTOS_BUCKET)
        .createSignedUploadUrl(storagePath);
      if (error || !data) {
        return err(externalService("supabase-storage", error?.message ?? "no signed url returned", true));
      }
      const signed: SignedUpload = {
        signedUrl: data.signedUrl,
        token: data.token,
        storagePath,
      };
      return ok(signed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "unknown storage error";
      return err(externalService("supabase-storage", message, true));
    }
  }
}
```

- Step: export the port + adapter. Edit `modules/jobs/index.ts` — add:

```typescript
export type { PhotoStorageGateway, SignedUpload, CreateUploadUrlCmd } from "./domain/photo-storage-gateway";
export { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET } from "./infra/supabase-photo-storage-gateway";
```

- Step: run it, expected PASS. Run `npx vitest run modules/jobs/infra/supabase-photo-storage-gateway.test.ts`. Expected: all 3 cases green.

- Step: wire the gateway into `AppDeps`. Edit `trpc/deps.ts` — add the import at the top:

```typescript
import type { PhotoStorageGateway } from "@mallet/jobs";
```

and add the field inside `interface AppDeps` (after `paymentLinkGateway`):

```typescript
  // Direct-to-storage upload URLs for job photos (Supabase Storage). null when the service-role
  // env is unavailable — photo upload self-disables (photoUploadUrl returns PRECONDITION_FAILED).
  readonly photoStorageGateway: PhotoStorageGateway | null;
```

- Step: build the gateway in the composition root. Edit `trpc/di.ts` — add the imports:

```typescript
import { SupabasePhotoStorageGateway } from "@mallet/jobs";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PhotoStorageGateway } from "@mallet/jobs";
```

Add before the `cached = { ... }` assignment:

```typescript
  // Photo storage self-disables unless the service-role Supabase env is present (getSupabaseAdmin
  // throws otherwise). Bind lazily — the client is built on first upload, not at boot.
  let photoStorageGateway: PhotoStorageGateway | null = null;
  if (config.SUPABASE_SERVICE_ROLE_KEY && config.NEXT_PUBLIC_SUPABASE_URL) {
    photoStorageGateway = new SupabasePhotoStorageGateway(
      () => getSupabaseAdmin() as unknown as Parameters<typeof SupabasePhotoStorageGateway>[0] extends never ? never : never,
    );
  }
```

> Correction for the DI cast: the constructor takes `() => StorageClient`. `getSupabaseAdmin()` returns a full `SupabaseClient` whose `.storage.from(...).createSignedUploadUrl` matches structurally. Use a direct narrowing cast instead of the convoluted conditional above:

```typescript
  let photoStorageGateway: PhotoStorageGateway | null = null;
  if (config.SUPABASE_SERVICE_ROLE_KEY && config.NEXT_PUBLIC_SUPABASE_URL) {
    photoStorageGateway = new SupabasePhotoStorageGateway(() => getSupabaseAdmin() as never);
  }
```

Then add `photoStorageGateway,` to the `cached = { ... }` object literal (after `paymentLinkGateway,`).

- Step: typecheck the DI compiles. Run `npx tsc --noEmit`. Expected: `0` errors.

- Step: commit.

```bash
git add modules/jobs/domain/photo-storage-gateway.ts modules/jobs/infra/supabase-photo-storage-gateway.ts modules/jobs/infra/supabase-photo-storage-gateway.test.ts modules/jobs/index.ts trpc/deps.ts trpc/di.ts
git commit -m "feat(jobs): photo storage gateway port + supabase adapter + DI"
```

---

### Task 7: DTO extension + router procedures + int-test deps

**Files:**
- Modify `modules/jobs/api/job-dto.ts` (extend `jobDTO`/`jobSummaryDTO`, add execution DTOs)
- Modify `modules/jobs/api/job-router.ts` (add the 9 procedures)
- Modify `modules/jobs/api/job-router.int.test.ts`, `field-router.int.test.ts`, `visit-router.int.test.ts` (add `photoStorageGateway: null` to `ctxFor` deps — required so the Context type-checks)

**Interfaces:**
- Consumes: the use-cases + `JobWithExecution` (Task 4), `PhotoStorageGateway` from `ctx.deps.photoStorageGateway` (Task 6), `DrizzleJobRepository` (Task 5).
- Produces: extended `jobDTO`/`jobSummaryDTO` with `lines`/`addons`/`verifyAnswers`/`photos`; `toJobExecutionDTO(job, execution)` builder; router procedures `addLine`/`updateLine`/`removeLine`/`addAddon`/`setAddonStatus`/`setAddonInvSkip`/`setVerifyAnswer`/`photoUploadUrl`/`addPhoto`/`removePhoto`. `RouterOutputs["v1"]["jobs"]["addLine"]` etc. become the reconcile DTO the store (Task 8) uses.

**Steps:**

- Step: extend the DTOs. Edit `modules/jobs/api/job-dto.ts`. Add after the `visitDTO` definition:

```typescript
export const jobLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  position: z.number().int(),
});

export const jobAddonDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  isOptional: z.boolean(),
  invoiceSkip: z.boolean(),
  status: z.enum(["proposed", "approved", "declined"]),
  position: z.number().int(),
});

export const jobVerifyAnswerDTO = z.object({
  itemId: z.number().int(),
  state: z.enum(["pass", "override"]),
  via: z.string().nullable(),
  reason: z.string().nullable(),
});

export const jobPhotoDTO = z.object({
  id: z.string().uuid(),
  storagePath: z.string(),
  caption: z.string().nullable(),
  verifyPass: z.boolean(),
  position: z.number().int(),
});
```

Add the four arrays to BOTH `jobDTO` and `jobSummaryDTO` object shapes (before the closing `})`):

```typescript
  lines: z.array(jobLineDTO),
  addons: z.array(jobAddonDTO),
  verifyAnswers: z.array(jobVerifyAnswerDTO),
  photos: z.array(jobPhotoDTO),
```

Now add an execution-DTO builder and thread execution into `toJobDTO`/`toJobSummaryDTO`. Because most callers (`v1.visits.*`, `v1.jobs.scheduleDirect`, etc.) do not load execution data, default the four arrays to empty when not supplied. Replace the existing `toJobDTO` and `toJobSummaryDTO` signatures to accept an optional `execution` param:

```typescript
import type {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
} from "../domain/job-execution";

interface Execution {
  lines: readonly JobLine[];
  addons: readonly JobAddon[];
  verifyAnswers: readonly JobVerifyAnswer[];
  photos: readonly JobPhoto[];
}

const emptyExecution: Execution = { lines: [], addons: [], verifyAnswers: [], photos: [] };

const toLineDTO = (l: JobLine) => {
  const p = l.props;
  return { id: p.id, description: p.description, quantity: p.quantity, rate: money(p.rate), cost: money(p.cost), position: p.position };
};
const toAddonDTO = (a: JobAddon) => {
  const p = a.props;
  return {
    id: p.id,
    description: p.description,
    quantity: p.quantity,
    rate: money(p.rate),
    cost: money(p.cost),
    isOptional: p.isOptional,
    invoiceSkip: p.invoiceSkip,
    status: p.status,
    position: p.position,
  };
};
const toVerifyDTO = (v: JobVerifyAnswer) => {
  const p = v.props;
  return { itemId: p.itemId, state: p.state, via: p.via, reason: p.reason };
};
const toPhotoDTO = (ph: JobPhoto) => {
  const p = ph.props;
  return { id: p.id, storagePath: p.storagePath, caption: p.caption, verifyPass: p.verifyPass, position: p.position };
};

const executionFields = (execution: Execution) => ({
  lines: execution.lines.map(toLineDTO),
  addons: execution.addons.map(toAddonDTO),
  verifyAnswers: execution.verifyAnswers.map(toVerifyDTO),
  photos: execution.photos.map(toPhotoDTO),
});
```

Update the existing `toJobDTO`:

```typescript
export const toJobDTO = (job: Job, execution: Execution = emptyExecution) => {
  const p = job.props;
  return {
    // ...existing fields unchanged...
    createdAt: p.createdAt.toISOString(),
    ...executionFields(execution),
  };
};
```

and `toJobSummaryDTO` the same way (append `...executionFields(execution)`, default param `emptyExecution`). `money(cents)` is the existing local helper in this file. Note: `p.rate`/`p.cost` are `Money` (branded number of cents), so `money(p.rate)` produces `{ cents, currency }`.

- Step: add the router procedures. Edit `modules/jobs/api/job-router.ts`. Add imports:

```typescript
import { TRPCError } from "@trpc/server"; // already imported
import {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "../app/job-execution-use-cases";
```

Add input schemas near the other inputs:

```typescript
const lineFields = {
  description: z.string().min(1).max(2000),
  quantity: z.number().min(0),
  rateCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
};
const addLineInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), ...lineFields, position: z.number().int().min(0).optional() });
const updateLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid(), ...lineFields, position: z.number().int().min(0) });
const removeLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid() });
const addAddonInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), description: z.string().min(1).max(2000), quantity: z.number().min(0).default(1), rateCents: z.number().int().min(0), costCents: z.number().int().min(0).default(0), isOptional: z.boolean().optional() });
const setAddonStatusInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), status: z.enum(["proposed", "approved", "declined"]) });
const setAddonInvSkipInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), invoiceSkip: z.boolean() });
const setVerifyAnswerInput = z.object({ jobId: z.string().uuid(), itemId: z.number().int(), state: z.enum(["pass", "override", "clear"]), via: z.string().max(50).nullable().optional(), reason: z.string().max(2000).nullable().optional() });
const photoUploadUrlInput = z.object({ jobId: z.string().uuid(), objectId: z.string().uuid(), ext: z.string().min(1).max(10) });
const addPhotoInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), storagePath: z.string().min(1).max(1024), caption: z.string().max(2000).nullable().optional(), verifyPass: z.boolean().optional() });
const removePhotoInput = z.object({ jobId: z.string().uuid(), photoId: z.string().uuid() });

const photoUploadUrlDTO = z.object({ signedUrl: z.string(), token: z.string(), storagePath: z.string() });
```

Add these procedures inside the `router({ ... })` returned by `createJobRouter` (after `cancel`). Each maps `JobWithExecution` → full DTO via `toJobDTO(r.job, r.execution)`:

```typescript
    addLine: ownerOrOffice
      .input(addLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobLineUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    updateLine: ownerOrOffice
      .input(updateLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), lineId: input.lineId, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removeLine: ownerOrOffice
      .input(removeLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), lineId: input.lineId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    addAddon: ownerOrOffice
      .input(addAddonInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobAddonUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, isOptional: input.isOptional },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    setAddonStatus: ownerOrOffice
      .input(setAddonStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonStatusUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, status: input.status }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setAddonInvSkip: ownerOrOffice
      .input(setAddonInvSkipInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonInvoiceSkipUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, invoiceSkip: input.invoiceSkip }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setVerifyAnswer: ownerOrOffice
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    photoUploadUrl: ownerOrOffice
      .input(photoUploadUrlInput)
      .output(photoUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "photo storage is not configured" });
        }
        // Confirm the job exists in this org before minting an upload URL (fail-closed).
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const job = await repo.findById(asJobId(input.jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        const result = await ctx.deps.photoStorageGateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          jobId: asJobId(input.jobId),
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "could not create upload url" });
        return result.value;
      }),

    addPhoto: ownerOrOffice
      .input(addPhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobPhotoUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, storagePath: input.storagePath, caption: input.caption ?? null, verifyPass: input.verifyPass ?? false },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removePhoto: ownerOrOffice
      .input(removePhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobPhotoUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), photoId: input.photoId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),
```

- Step: add `photoStorageGateway: null` to every int-test `ctxFor` deps block. Edit `modules/jobs/api/job-router.int.test.ts`, `modules/jobs/api/field-router.int.test.ts`, `modules/jobs/api/visit-router.int.test.ts` — in each, add `photoStorageGateway: null,` right after `paymentLinkGateway: null,` inside the `deps: { ... }` object. (Same edit in `modules/companies/api/company-router.int.test.ts` and any other int test whose `ctxFor` builds a full `Context` — grep and patch all: `grep -rl "paymentLinkGateway: null" modules --include="*.int.test.ts"`.)

- Step: typecheck + regression. Run `npx tsc --noEmit`. Expected: `0` errors (DTOs, router, and all `Context` literals now include `photoStorageGateway`).

- Step: commit.

```bash
git add modules/jobs/api/job-dto.ts modules/jobs/api/job-router.ts modules/jobs/api/job-router.int.test.ts modules/jobs/api/field-router.int.test.ts modules/jobs/api/visit-router.int.test.ts modules/companies/api/company-router.int.test.ts
git commit -m "feat(jobs): v1.jobs execution procedures + DTO extension"
```

---

### Task 8: Router integration test (live DB + RLS) + storage bucket migration

**Files:**
- Create `shared/db/migrations/0046_job_photos_bucket.sql`
- Create `modules/jobs/api/job-execution-router.int.test.ts`
- Modify `shared/db/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: the full router (Task 7), live RLS (Task 2), `createCaller` pattern (from the existing `job-router.int.test.ts`).
- Produces: the `job-photos` bucket + storage RLS policies; a capstone int test proving create→line→addon→verify→photo persist, reload, and cross-org isolation.

**Steps:**

- Step: write the storage-bucket migration (hand-written; drizzle-kit does not manage Storage). Write `shared/db/migrations/0046_job_photos_bucket.sql`:

```sql
-- Private Supabase Storage bucket for job photos + tenant-isolation policies. The object key
-- layout is <org_id>/<job_id>/<uuid>.<ext>, so the first path segment IS the org id. Reads/writes
-- are allowed only when that first segment equals the caller's org, derived from the JWT app_metadata
-- org_id claim the app sets at signup. The service-role client (getSupabaseAdmin) bypasses these
-- policies and is what mints signed upload URLs server-side; end-user browser reads go through
-- these policies. Idempotent: safe to re-run.

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;
--> statement-breakpoint

-- Helper mirrors public.current_org_id() but reads the org from the Storage request's JWT claim
-- (storage runs as the authenticated user, not inside a withTenant tx). Falls back to NULL (deny).
create or replace function storage.job_photo_org()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id',
      ''
    ),
    ''
  )::uuid
$$;
--> statement-breakpoint

drop policy if exists job_photos_read ON storage.objects;
--> statement-breakpoint
create policy job_photos_read on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );
--> statement-breakpoint

drop policy if exists job_photos_insert ON storage.objects;
--> statement-breakpoint
create policy job_photos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );
```

- Step: register 0046 in the journal (hand-written entry, same shape as the 0045 entry, next `idx`, `tag: "0046_job_photos_bucket"`).

- Step: apply it. Run `npm run db:migrate`. Expected: creates the bucket + policies with no error (idempotent on re-run).

- Step: write the failing int test. Write `modules/jobs/api/job-execution-router.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, userId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("v1.jobs execution data (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let jobId = "";
  const ownerA = randomUUID();

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('ExecApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('ExecApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
    // Create a job to attach execution data to (scheduleDirect exists pre-Phase-5).
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const job = await caller.v1.jobs.scheduleDirect({ leadId: leadAId, title: "Exec Test Job" });
    jobId = job.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("adds a line and it comes back on the job DTO", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const dto = await caller.v1.jobs.addLine({ jobId, description: "Panel swap", quantity: 2, rateCents: 5000, costCents: 1000 });
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0]?.description).toBe("Panel swap");
    expect(dto.lines[0]?.rate.cents).toBe(5000);
  });

  it("updates then removes a line", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const added = await caller.v1.jobs.addLine({ jobId, description: "Temp", quantity: 1, rateCents: 100, costCents: 0 });
    const lineId = added.lines.find((l) => l.description === "Temp")!.id;
    const updated = await caller.v1.jobs.updateLine({ jobId, lineId, description: "Renamed", quantity: 3, rateCents: 200, costCents: 0, position: 1 });
    expect(updated.lines.find((l) => l.id === lineId)?.description).toBe("Renamed");
    const removed = await caller.v1.jobs.removeLine({ jobId, lineId });
    expect(removed.lines.some((l) => l.id === lineId)).toBe(false);
  });

  it("adds an addon, approves it, and toggles invoice skip", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const added = await caller.v1.jobs.addAddon({ jobId, description: "Extra outlet", rateCents: 9000, costCents: 0 });
    const addonId = added.addons.find((a) => a.description === "Extra outlet")!.id;
    expect(added.addons.find((a) => a.id === addonId)?.status).toBe("proposed");
    const approved = await caller.v1.jobs.setAddonStatus({ jobId, addonId, status: "approved" });
    expect(approved.addons.find((a) => a.id === addonId)?.status).toBe("approved");
    const skipped = await caller.v1.jobs.setAddonInvSkip({ jobId, addonId, invoiceSkip: true });
    expect(skipped.addons.find((a) => a.id === addonId)?.invoiceSkip).toBe(true);
  });

  it("sets a verify answer, overrides it, then clears it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const passed = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: 5, state: "pass", via: "manual" });
    expect(passed.verifyAnswers.find((v) => v.itemId === 5)?.state).toBe("pass");
    const overridden = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: 5, state: "override", reason: "N/A on this unit" });
    expect(overridden.verifyAnswers.find((v) => v.itemId === 5)?.state).toBe("override");
    expect(overridden.verifyAnswers).toHaveLength(1); // upsert, not a second row
    const cleared = await caller.v1.jobs.setVerifyAnswer({ jobId, itemId: 5, state: "clear" });
    expect(cleared.verifyAnswers.some((v) => v.itemId === 5)).toBe(false);
  });

  it("override without a reason is BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    await expect(
      caller.v1.jobs.setVerifyAnswer({ jobId, itemId: 9, state: "override" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("records a photo metadata row and removes it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    const path = `${orgAId}/${jobId}/${randomUUID()}.jpg`;
    const added = await caller.v1.jobs.addPhoto({ jobId, storagePath: path, verifyPass: true });
    const photoId = added.photos.find((p) => p.storagePath === path)!.id;
    expect(added.photos.find((p) => p.id === photoId)?.verifyPass).toBe(true);
    const removed = await caller.v1.jobs.removePhoto({ jobId, photoId });
    expect(removed.photos.some((p) => p.id === photoId)).toBe(false);
  });

  it("photoUploadUrl returns PRECONDITION_FAILED when storage is unconfigured", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerA, "owner"));
    await expect(
      caller.v1.jobs.photoUploadUrl({ jobId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("org B cannot add a line to org A's job (NOT_FOUND via RLS)", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, randomUUID(), "owner"));
    await expect(
      callerB.v1.jobs.addLine({ jobId, description: "sneaky", quantity: 1, rateCents: 1, costCents: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from office execution mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, randomUUID(), "tech"));
    await expect(
      callerTech.v1.jobs.addLine({ jobId, description: "nope", quantity: 1, rateCents: 1, costCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- Step: run it, expected PASS (with DB env) / SKIP (without). Run `npx vitest run modules/jobs/api/job-execution-router.int.test.ts`. Expected: `9 passed` when `APP_DATABASE_URL`+`DATABASE_URL` are set (CI has them); otherwise the suite is skipped via `describe.skip` (same guard as `company-router.int.test.ts`).

- Step: commit.

```bash
git add shared/db/migrations/0046_job_photos_bucket.sql shared/db/migrations/meta modules/jobs/api/job-execution-router.int.test.ts
git commit -m "feat(jobs): job-photos storage bucket + execution router int test"
```

---

### Task 9: Store slice — persist the seven execution actions + hydrator load

**Files:**
- Modify `lib/store/slices/jobs-slice.ts` (switch `addAddon`, `setAddonStatus`, `setAddonInvSkip`, `checkVerifyItem`, `overrideVerifyItem`, `uncheckVerifyItem`, `addJobPhoto` to optimistic→persist→reconcile/rollback)
- Modify `lib/store/dto-mapper.ts` (extend `dtoJobToStoreJob` to carry lines/addons/verify/photos; add a client-side upload helper)
- Modify `features/jobs/jobs-hydrator.tsx` (map lines/addons/verify/photos from the list DTO)
- Create `lib/store/slices/jobs-execution-slice.test.ts`

**Interfaces:**
- Consumes: `trpcVanilla.v1.jobs.{addLine,updateLine,removeLine,addAddon,setAddonStatus,setAddonInvSkip,setVerifyAnswer,photoUploadUrl,addPhoto,removePhoto}` (Task 7), the extended `jobDTO` (Task 7), `createSupabaseBrowser` (for `uploadToSignedUrl`), `dtoJobToStoreJob` (extended here).
- Produces: persisted store actions; the extended `dtoJobToStoreJob`; an `uploadJobPhoto(jobId, file)` async helper on the slice that performs `photoUploadUrl → uploadToSignedUrl → addPhoto`.

**Steps:**

- Step: extend `dtoJobToStoreJob` to map the new arrays. Edit `lib/store/dto-mapper.ts`. In `dtoJobToStoreJob`, replace the hard-coded `lines: []`, `addons: []`, `photos: []` with real mappings and add `verify`:

```typescript
  const lines = dto.lines.map((l) => ({
    d: l.description,
    q: l.quantity,
    r: l.rate.cents / 100,
    c: l.cost.cents > 0 ? l.cost.cents / 100 : undefined,
  }));
  const addons = dto.addons.map((a) => ({
    // store Addon.id is numeric; the DB uses a uuid. Keep the uuid on a parallel key the slice
    // uses for persistence, and derive a stable numeric id from position for the legacy UI.
    id: a.position,
    dbId: a.id,
    d: a.description,
    q: a.quantity,
    r: a.rate.cents / 100,
    c: a.cost.cents > 0 ? a.cost.cents / 100 : undefined,
    status: a.status,
    invSkip: a.invoiceSkip || undefined,
  }));
  const verifyAns: Record<number, { st: "pass" | "override"; via?: string; reason?: string }> = {};
  for (const v of dto.verifyAnswers) {
    verifyAns[v.itemId] = { st: v.state, ...(v.via ? { via: v.via } : {}), ...(v.reason ? { reason: v.reason } : {}) };
  }
  const photos = dto.photos.map((p) => p.storagePath);
```

and use them in the returned object (`lines`, `addons`, `photos`, `verify: { ans: verifyAns }`). Because `Addon`/`JobLine` store types do not yet have `dbId`, add `dbId?: string` to the `Addon` interface in `lib/store/types.ts` and the same optional `dbId?: string` note to the reconcile. (Store `Addon.id` stays `number` for the existing UI; `dbId` is the persistence key.)

> Simpler, safer mapping for the pilot: since the store `Addon`/`JobLine`/photo shapes are prototype-driven and the reconcile REPLACES the whole job, carry the DB uuid directly. Add `dbId?: string` to `Addon` in `lib/store/types.ts`:

```typescript
export interface Addon {
  id: number;
  dbId?: string; // DB uuid for persistence; id stays numeric for the prototype UI
  // ...unchanged...
}
```

- Step: write the failing slice test. Write `lib/store/slices/jobs-execution-slice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the vanilla client BEFORE importing the slice.
const mutate = {
  addAddon: vi.fn(),
  setAddonStatus: vi.fn(),
  setAddonInvSkip: vi.fn(),
  setVerifyAnswer: vi.fn(),
  photoUploadUrl: vi.fn(),
  addPhoto: vi.fn(),
};
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        addAddon: { mutate: (...a: unknown[]) => mutate.addAddon(...a) },
        setAddonStatus: { mutate: (...a: unknown[]) => mutate.setAddonStatus(...a) },
        setAddonInvSkip: { mutate: (...a: unknown[]) => mutate.setAddonInvSkip(...a) },
        setVerifyAnswer: { mutate: (...a: unknown[]) => mutate.setVerifyAnswer(...a) },
        photoUploadUrl: { mutate: (...a: unknown[]) => mutate.photoUploadUrl(...a) },
        addPhoto: { mutate: (...a: unknown[]) => mutate.addPhoto(...a) },
      },
    },
  },
}));

import { createStore } from "zustand/vanilla";
import { createJobsSlice, type JobsSlice } from "./jobs-slice";
import { JOB_ORIGIN } from "@/lib/store/hydrator-config";
import type { Job } from "@/lib/store/types";

const flush = () => new Promise((r) => setTimeout(r, 0));

function seedJob(store: ReturnType<typeof createStore<JobsSlice>>) {
  const job: Job = {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: JOB_ORIGIN.DB,
    title: "T",
    addr: "",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
  };
  store.setState({ jobs: [job] });
}

describe("jobs-slice execution actions persist", () => {
  let store: ReturnType<typeof createStore<JobsSlice>>;

  beforeEach(() => {
    Object.values(mutate).forEach((m) => m.mockReset());
    store = createStore<JobsSlice>((set, get, api) => createJobsSlice(set, get, api));
    seedJob(store);
  });

  it("addAddon optimistically inserts and fires v1.jobs.addAddon", async () => {
    mutate.addAddon.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [{ id: "srv-1", description: "Extra", quantity: 1, rate: { cents: 9000, currency: "USD" }, cost: { cents: 0, currency: "USD" }, isOptional: false, invoiceSkip: false, status: "proposed", position: 0 }], verifyAnswers: [], photos: [] });
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // optimistic
    await flush();
    expect(mutate.addAddon).toHaveBeenCalledTimes(1);
    const arg = mutate.addAddon.mock.calls[0]![0] as { jobId: string; description: string; rateCents: number };
    expect(arg).toMatchObject({ jobId: "job-1", description: "Extra", rateCents: 9000 });
  });

  it("addAddon rolls back on mutation failure", async () => {
    mutate.addAddon.mockRejectedValue(new Error("boom"));
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // optimistic
    await flush();
    expect(store.getState().jobs[0]!.addons).toHaveLength(0); // rolled back
  });

  it("checkVerifyItem fires setVerifyAnswer(state=pass)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [{ itemId: 3, state: "pass", via: "manual", reason: null }], photos: [] });
    store.getState().checkVerifyItem("job-1", 3);
    expect(store.getState().jobs[0]!.verify?.ans[3]?.st).toBe("pass"); // optimistic
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "pass" });
  });

  it("overrideVerifyItem fires setVerifyAnswer(state=override, reason)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [{ itemId: 3, state: "override", via: null, reason: "N/A" }], photos: [] });
    store.getState().overrideVerifyItem("job-1", 3, "N/A");
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "override", reason: "N/A" });
  });

  it("uncheckVerifyItem fires setVerifyAnswer(state=clear)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [], photos: [] });
    store.setState({ jobs: [{ ...store.getState().jobs[0]!, verify: { ans: { 3: { st: "pass", via: "manual" } } } }] });
    store.getState().uncheckVerifyItem("job-1", 3);
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "clear" });
  });

  it("manual-origin jobs do NOT fire network mutations", async () => {
    store.setState({ jobs: [{ ...store.getState().jobs[0]!, origin: JOB_ORIGIN.MANUAL }] });
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    await flush();
    expect(mutate.addAddon).not.toHaveBeenCalled();
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // still optimistic-only
  });
});
```

- Step: run it, expected FAIL. Run `npx vitest run lib/store/slices/jobs-execution-slice.test.ts`. Expected: FAIL — the actions are still store-only (no `trpcVanilla` call), so `mutate.addAddon` is never called and the rollback assertion fails.

- Step: implement the persistence. Edit `lib/store/slices/jobs-slice.ts`. Replace the seven store-only actions (`addAddon` L426, `setAddonStatus` L444, `setAddonInvSkip` L452, `checkVerifyItem` L460, `overrideVerifyItem` L465, `uncheckVerifyItem` L470, `addJobPhoto` L479) with optimistic→persist→reconcile/rollback versions. Each follows the exact `setVisitStatus` shape (snapshot, optimistic set, `origin !== DB` early-return, mutate→reconcile via `dtoJobToStoreJob`, catch→rollback). Example for `addAddon` (the rest mirror it):

```typescript
  addAddon: (jobId, draft) => {
    const d = draft.d.trim();
    if (!d) return null;
    const addon: Addon = {
      id: ++_nextAuxId,
      d,
      q: 1,
      r: Math.max(0, draft.r || 0),
      ...(draft.c != null ? { c: Math.max(0, draft.c) } : {}),
      status: "proposed",
      when: "Just now",
    };
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({ jobs: patchJob(s.jobs, jobId, (j) => ({ ...j, addons: [...j.addons, addon] })) }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return addon;

    trpcVanilla.v1.jobs.addAddon
      .mutate({
        jobId,
        description: d,
        quantity: 1,
        rateCents: Math.round((draft.r || 0) * 100),
        costCents: draft.c != null ? Math.round(draft.c * 100) : 0,
      })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") console.error("[jobs-slice] addAddon failed — rolled back", { jobId, err });
      });
    return addon;
  },
```

`setAddonStatus`/`setAddonInvSkip` mutate `v1.jobs.setAddonStatus`/`setAddonInvSkip` using the addon's `dbId` (fall back to no-op persist when `dbId` is absent — a locally-added addon not yet reconciled). `checkVerifyItem`→`setVerifyAnswer({ state: "pass", via: "manual" })`; `overrideVerifyItem`→`setVerifyAnswer({ state: "override", reason })`; `uncheckVerifyItem`→`setVerifyAnswer({ state: "clear" })`. `addJobPhoto` keeps its local auto-pass behaviour but calls the new `uploadJobPhoto` when a `File` is supplied (see next step); with no file it remains optimistic-only (prototype demo path).

- Step: add the direct-upload helper to `lib/store/dto-mapper.ts` (pure-ish, browser-only) OR a small `lib/store/upload-job-photo.ts`. Write `lib/store/upload-job-photo.ts`:

```typescript
/**
 * lib/store/upload-job-photo.ts
 * Browser-only: mint a signed upload URL, PUT the file directly to Supabase Storage, then record
 * the metadata row. Returns the storage path on success. Errors bubble to the caller for rollback.
 */
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { JOB_PHOTOS_BUCKET } from "@mallet/jobs";

export async function uploadJobPhoto(jobId: string, file: File, verifyPass: boolean): Promise<string> {
  const objectId = crypto.randomUUID();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const { signedUrl: _signedUrl, token, storagePath } = await trpcVanilla.v1.jobs.photoUploadUrl.mutate({
    jobId,
    objectId,
    ext,
  });
  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage.from(JOB_PHOTOS_BUCKET).uploadToSignedUrl(storagePath, token, file);
  if (error) throw new Error(`photo upload failed: ${error.message}`);
  await trpcVanilla.v1.jobs.addPhoto.mutate({ jobId, storagePath, verifyPass });
  return storagePath;
}
```

- Step: extend the hydrator to carry execution data from the list DTO. Edit `features/jobs/jobs-hydrator.tsx` `toStoreJob` to map `dto.lines`/`dto.addons`/`dto.verifyAnswers`/`dto.photos` (the summary DTO now carries them — Task 7 added the arrays to `jobSummaryDTO`). Mirror the `dtoJobToStoreJob` mapping exactly (extract a shared `mapExecution(dto)` in `dto-mapper.ts` and call it from both `toStoreJob` and `dtoJobToStoreJob` so there is a single conversion site — per the coding-style DRY rule).

- Step: run the slice test, expected PASS. Run `npx vitest run lib/store/slices/jobs-execution-slice.test.ts`. Expected: all 6 cases green.

- Step: run the existing jobs-hydrator + jobs-slice regression tests. Run `npx vitest run features/jobs/jobs-hydrator.test.ts lib/store/slices`. Expected: green (the extended mapping defaults keep visit behaviour intact).

- Step: commit.

```bash
git add lib/store/slices/jobs-slice.ts lib/store/dto-mapper.ts lib/store/upload-job-photo.ts lib/store/types.ts features/jobs/jobs-hydrator.tsx lib/store/slices/jobs-execution-slice.test.ts
git commit -m "feat(store): persist job execution actions + photo upload + hydrate"
```

---

### Task 10: Verify the full gate + open the PR

**Files:** none (verification + PR).

**Interfaces:** Consumes everything from Tasks 1–9. Produces the Phase 5 PR.

**Steps:**

- Step: branch (if on the default branch). Run:

```bash
git rev-parse --abbrev-ref HEAD
git checkout -b phase-5-job-execution-data
```

(Skip the checkout if already on a phase branch.)

- Step: typecheck. Run `npx tsc --noEmit`. Expected: `0` errors.

- Step: lint. Run `npm run lint`. Expected: `0` errors (warnings tolerated only if the repo baseline already has them; new files add none — no `console.log` outside the dev-guarded slice logs, no `any`).

- Step: unit + integration. Run `npx vitest run`. Expected: all suites green; the new `job-execution-use-cases`, `job-execution.test`, `supabase-photo-storage-gateway`, and `jobs-execution-slice` suites pass; the int suites pass with DB env or skip without it (same as existing capstones).

- Step: coverage gate. Run `npm run coverage`. Expected: overall lines ≥ 80% / branches ≥ 75% (the repo thresholds); the new modules are well-covered by Tasks 3/4/6/8/9. If a specific new file dips below, add the missing branch case to its existing test file (do not lower the threshold).

- Step: build. Run `npm run build`. Expected: Next.js build completes with no type or bundling error (the browser-only `upload-job-photo.ts` imports only browser-safe modules; `getSupabaseAdmin` stays server-side in `di.ts`).

- Step: verify migrations are consistent (journal + snapshot + files line up). Run:

```bash
npm run db:migrate
```

Expected: `No migrations to apply` (0044–0046 already applied in Tasks 2/8), proving the journal matches the files.

- Step: open the PR. Run:

```bash
git push -u origin phase-5-job-execution-data
gh pr create --title "Phase 5: job execution data (lines/addons/verify/photos + Supabase Storage)" --body "$(cat <<'EOF'
## Summary
Makes job execution data fully DB-backed and refresh-durable: found-work add-ons, job line items, before-you-leave verify-checklist answers, and job photos (via Supabase Storage direct upload). Closes audit gap #5.

- New tables `job_lines`, `job_addons`, `job_verify_answers`, `job_photos` (org-scoped, RLS via current_org_id(), soft-delete except verify-answers which upsert-per-item).
- Private `job-photos` Storage bucket with org-prefixed keys + tenant read/write policies; `PhotoStorageGateway` port + Supabase adapter + DI wiring (self-disables when unconfigured).
- `v1.jobs` gains addLine/updateLine/removeLine, addAddon/setAddonStatus/setAddonInvSkip, setVerifyAnswer, photoUploadUrl, addPhoto/removePhoto — all return the full refreshed jobDTO (extended with lines/addons/verifyAnswers/photos).
- Store: addAddon/setAddonStatus/setAddonInvSkip/checkVerifyItem/overrideVerifyItem/uncheckVerifyItem/addJobPhoto switch to optimistic → persist → reconcile/rollback; JobsHydrator + dtoJobToStoreJob load execution data; browser direct-upload helper.

## Test plan
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm run lint` — 0 errors
- [x] `npx vitest run` — unit + int green (int live-RLS capstone: create→line→addon→verify→photo persist + reload, cross-org NOT_FOUND, tech FORBIDDEN)
- [x] `npm run coverage` — ≥ 80/75
- [x] `npm run build` — clean
- [x] `npm run db:rls-proof` — new tables ENABLED + FORCED with a tenant policy
- [ ] Manual: on the tech job modal, add a line + add-on, check/override verify items, upload a photo; refresh → all persist. Confirm a second org cannot read the first org's photos.
EOF
)"
```

Expected: PR created against the base branch; CI (typecheck/lint/unit/int/coverage/build) runs and passes.

- Step: (adversarial review) request a code review before merge, per the repo's code-review rule — focus reviewers on: (1) RLS + Storage-policy tenant isolation (a tenant must not read another org's photos), (2) the service-role admin client staying server-only (never imported into a client component), (3) money-unit correctness (cents at the boundary, dollars in the store), and (4) that the hydrator's extended mapping does not clobber optimistic writes.

**Produces at phase end:** a green PR delivering the four execution tables + storage bucket/policies + `PhotoStorageGateway` + the ten `v1.jobs` execution procedures + the persisted, hydrated store actions.


## Phase 6: Checklist templates

Persist the org's checklist templates (job "before you leave" + estimate "visit"
checklists) that today live only in the in-memory store, seeded from
`SEED_CHECKLISTS` with module-level id counters (`_nextChkId` / `_nextItemId`).
This phase adds a new hexagonal `modules/checklists/` module mirroring
`modules/companies/`, two org-scoped tables (`checklist_templates` +
`checklist_items`) with hand-written RLS, a `v1.checklists` router, a
`ChecklistsHydrator`, and switches `checklists-slice` to the optimistic →
persist → reconcile/rollback pattern. Because the server assigns UUID ids,
`Checklist.id` / `ChecklistItem.id` change from `number` to `string`; every
consumer (standards-modal, job-modal attach flow, settings Pipeline section)
uses those ids only as React keys / match keys, so the per-job attach flow
(`updateJob(job.id, { checklist: { name, items } })`) now references **stable
server template item ids** and survives refresh.

**CONSUMES (from earlier phases / existing code):**
- `ownerOrOffice` procedure builder — `trpc/init.ts:73`.
- Hydrator pattern — `useStoreHydrator` (`lib/store/use-store-hydrator.ts:39`),
  `HYDRATOR_STALE_MS` / `HYDRATOR_PAGE_LIMIT` (`lib/store/hydrator-config.ts:8,11`),
  `api` + `RouterOutputs` (`lib/trpc/client.ts:5,7`), `trpcVanilla`
  (`lib/trpc/vanilla.ts`).
- Shared kit: `Result`/`AppError`/`ok`/`err`/`validation`/`notFound`,
  `Clock`/`FixedClock`/`systemClock` (`shared/types/clock.ts`), `IdGenerator`
  (`shared/ports/id-generator.ts:5`), `buildPage`/`decodeCursor`/`toPage`/`isOk`
  (`shared/types`), `TenantTx` (`shared/db/tx`), `orThrow` (`trpc/errors.ts:17`),
  `logger` (`@mallet/shared/observability`).
- `orgs` table + `public.current_org_id()` (migration `0038` RLS syntax).

**PRODUCES (later phases / consumers rely on):**
- Tables `checklist_templates` + `checklist_items` (migration `0044`).
- Branded ids `ChecklistId` / `ChecklistItemId` + `asChecklistId` /
  `asChecklistItemId` (`shared/types/ids.ts`).
- `v1.checklists` router: `list`, `create`, `remove`, `addItem`, `removeItem`,
  `setItemRequired` — exported via `createChecklistRouter` (`@mallet/checklists`).
- `ChecklistsHydrator` (`features/checklists/checklists-hydrator.tsx`), mounted
  in the office layout.
- Persisting `checklists-slice` (string ids, no `SEED_CHECKLISTS`, no counters).

> **Migration numbering note.** Phases 1–5 consume `0043`+. If this phase lands
> before an earlier phase, use the next free number under
> `shared/db/migrations/` at generate time and update the RLS filename to match;
> the plan text assumes `0044`.

---

### Task 1: Branded ids + store type migration to string ids

**Files:**
- Modify `shared/db/../../shared/types/ids.ts` (add `ChecklistId`,
  `ChecklistItemId` after L21 `MessageId`; add `asChecklistId`,
  `asChecklistItemId` after L37 `asMessageId`).
- Modify `lib/store/types.ts` (L172-186 — `ChecklistItem.id: number` →
  `string`, add `position: number`; `Checklist.id: number` → `string`).
- Test `shared/types/helpers.test.ts` (extend existing id round-trip test).

**Interfaces:**
- Consumes: `Brand<string, ...>` (`shared/types/ids.ts:9`).
- Produces: `ChecklistId`, `ChecklistItemId`, `asChecklistId`,
  `asChecklistItemId`; store `Checklist.id: string`,
  `ChecklistItem.id: string`, `ChecklistItem.position: number`.

- Step: write the failing test — append to `shared/types/helpers.test.ts` inside
  the existing `describe("id brands", ...)` block:
  ```typescript
  it("asChecklistId / asChecklistItemId round-trip", () => {
    expect(asChecklistId("chk")).toBe("chk");
    expect(asChecklistItemId("itm")).toBe("itm");
  });
  ```
  and add `asChecklistId, asChecklistItemId` to the import from `./ids` at the
  top of the file.
- Step: run it, expected FAIL (imports don't exist yet):
  `npx vitest run shared/types/helpers.test.ts`
  → `error TS2305: Module '"./ids"' has no exported member 'asChecklistId'`.
- Step: minimal implementation — in `shared/types/ids.ts` add after
  `export type MessageId = Brand<string, "MessageId">;` (L21):
  ```typescript
  export type ChecklistId = Brand<string, "ChecklistId">;
  export type ChecklistItemId = Brand<string, "ChecklistItemId">;
  ```
  and after `export const asMessageId = (v: string): MessageId => v as MessageId;`
  (L37):
  ```typescript
  export const asChecklistId = (v: string): ChecklistId => v as ChecklistId;
  export const asChecklistItemId = (v: string): ChecklistItemId => v as ChecklistItemId;
  ```
- Step: change the store types — in `lib/store/types.ts` replace the two
  interfaces (L172-186):
  ```typescript
  export interface ChecklistItem {
    id: string;
    text: string;
    type: "check" | "photo";
    required: boolean;
    position: number;
  }

  export interface Checklist {
    id: string;
    name: string;
    trade: string;
    stage: "job" | "scope";
    match: string[];
    items: ChecklistItem[];
  }
  ```
- Step: run it, expected PASS: `npx vitest run shared/types/helpers.test.ts`
  → `Test Files  1 passed`. (The store-type change compiles here; the slice that
  still mints `number` ids is fixed in Task 7 — `npx tsc --noEmit` is NOT run at
  this task boundary, only the targeted unit test.)
- Step: commit:
  `git commit -am "feat(checklists): add ChecklistId/ChecklistItemId brands and string store ids"`

---

### Task 2: Schema — checklist_templates + checklist_items

**Files:**
- Create `shared/db/schema/checklists.ts`.
- Modify `shared/db/schema/index.ts` (add `export * from "./checklists";` after
  L`export * from "./messages";`).
- Test `shared/db/schema/checklists.schema.test.ts`.

**Interfaces:**
- Consumes: `orgs` (`shared/db/schema/orgs.ts`), the `estimates`/`estimate_lines`
  composite-FK pattern (`shared/db/schema/estimates.ts:47-100`).
- Produces: `checklistTemplates`, `checklistItems` Drizzle tables (row types
  `typeof checklistTemplates.$inferSelect`, `typeof checklistItems.$inferSelect`).

- Step: write the failing test — `shared/db/schema/checklists.schema.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { getTableConfig } from "drizzle-orm/pg-core";
  import { checklistTemplates, checklistItems } from "./checklists";

  describe("checklist_templates schema", () => {
    const cfg = getTableConfig(checklistTemplates);

    it("is named checklist_templates", () => {
      expect(cfg.name).toBe("checklist_templates");
    });

    it("has org_id, name, trade, stage, match, soft-delete, timestamps", () => {
      const cols = new Set(cfg.columns.map((c) => c.name));
      for (const c of ["id", "org_id", "name", "trade", "stage", "match", "created_at", "updated_at", "deleted_at"]) {
        expect(cols.has(c)).toBe(true);
      }
    });

    it("stage defaults to job and match is an array", () => {
      const stage = cfg.columns.find((c) => c.name === "stage");
      expect(stage?.default).toBe("job");
      const match = cfg.columns.find((c) => c.name === "match");
      expect(match?.notNull).toBe(true);
    });

    it("exposes composite unique (org_id, id) for child FK", () => {
      expect(cfg.uniqueConstraints.some((u) => u.name === "checklist_templates_org_id_uq")).toBe(true);
    });
  });

  describe("checklist_items schema", () => {
    const cfg = getTableConfig(checklistItems);

    it("is named checklist_items", () => {
      expect(cfg.name).toBe("checklist_items");
    });

    it("has template_id, text, type, required, position, soft-delete", () => {
      const cols = new Set(cfg.columns.map((c) => c.name));
      for (const c of ["id", "org_id", "template_id", "text", "type", "required", "position", "deleted_at"]) {
        expect(cols.has(c)).toBe(true);
      }
    });

    it("required defaults false, position defaults 0", () => {
      expect(cfg.columns.find((c) => c.name === "required")?.default).toBe(false);
      expect(cfg.columns.find((c) => c.name === "position")?.default).toBe(0);
    });

    it("has a composite FK to (org_id, template_id)", () => {
      expect(cfg.foreignKeys.some((fk) => fk.getName() === "checklist_items_template_fk")).toBe(true);
    });
  });
  ```
- Step: run it, expected FAIL: `npx vitest run shared/db/schema/checklists.schema.test.ts`
  → `Cannot find module './checklists'`.
- Step: minimal implementation — `shared/db/schema/checklists.ts`:
  ```typescript
  import { sql } from "drizzle-orm";
  import {
    pgTable,
    uuid,
    text,
    boolean,
    integer,
    timestamp,
    index,
    unique,
    foreignKey,
    check,
  } from "drizzle-orm/pg-core";
  import { orgs } from "./orgs";

  // A reusable checklist template the office attaches per job ("before you leave")
  // or per estimate visit ("scope"). Header + ordered items (see checklist_items).
  // RLS isolates by org_id (hand-written migration). Soft-delete via deletedAt.
  export const checklistTemplates = pgTable(
    "checklist_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      orgId: uuid("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      trade: text("trade").notNull().default("Custom"),
      stage: text("stage").notNull().default("job"),
      // Fuzzy job-type match keywords (["water heater", "tankless"]); jsonb array of text.
      match: text("match").array().notNull().default(sql`ARRAY[]::text[]`),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      // Composite-unique target so checklist_items can FK on (org_id, id) and never
      // link across tenants — same pattern as estimates_org_id_uq.
      unique("checklist_templates_org_id_uq").on(t.orgId, t.id),
      // Primary query: all non-deleted templates for an org, newest-first.
      index("checklist_templates_org_deleted_idx").on(t.orgId, t.deletedAt),
      check("checklist_templates_stage_check", sql`${t.stage} in ('job', 'scope')`),
    ],
  );

  // An ordered item on a checklist template. Composite FK (org_id, template_id)
  // enforces intra-org containment (RI checks run owner-side, bypassing RLS — the
  // composite key is what actually closes the cross-tenant hole).
  export const checklistItems = pgTable(
    "checklist_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      orgId: uuid("org_id").notNull(),
      templateId: uuid("template_id").notNull(),
      text: text("text").notNull(),
      type: text("type").notNull().default("check"),
      required: boolean("required").notNull().default(false),
      position: integer("position").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      foreignKey({
        name: "checklist_items_template_fk",
        columns: [t.orgId, t.templateId],
        foreignColumns: [checklistTemplates.orgId, checklistTemplates.id],
      }).onDelete("cascade"),
      index("checklist_items_org_template_idx").on(t.orgId, t.templateId),
      check("checklist_items_type_check", sql`${t.type} in ('check', 'photo')`),
    ],
  );
  ```
  Then add `export * from "./checklists";` to `shared/db/schema/index.ts` after
  the messages export.
- Step: run it, expected PASS: `npx vitest run shared/db/schema/checklists.schema.test.ts`
  → `Test Files  1 passed` (9 tests).
- Step: commit:
  `git commit -am "feat(checklists): add checklist_templates + checklist_items schema"`

---

### Task 3: Migration 0044 — tables + RLS + backfill defaults

**Files:**
- Create `shared/db/migrations/0044_<drizzle_slug>.sql` (drizzle-generated table
  DDL).
- Create `shared/db/migrations/0045_checklists_rls.sql` (hand-written RLS).
- Modify `shared/db/migrations/meta/_journal.json` + a new
  `meta/0044_snapshot.json` (both drizzle-kit-generated).

> RLS lives in its own numbered migration file (like `0038_companies_rls.sql`),
> generated by hand after drizzle emits the table DDL — drizzle-kit does not emit
> policies. Use the next free numbers if earlier phases consumed 0044/0045.

**Interfaces:**
- Consumes: `checklistTemplates` / `checklistItems` (Task 2),
  `public.current_org_id()` (existing fn — do NOT redefine).
- Produces: live `checklist_templates` + `checklist_items` tables with RLS on the
  test/dev DB so Task 6's integration test can run.

- Step: generate the table DDL migration:
  `npm run db:generate`
  → drizzle writes `shared/db/migrations/0044_<slug>.sql` containing
  `CREATE TABLE "checklist_templates" (...)` and `CREATE TABLE "checklist_items" (...)`
  plus the FK/unique/index/check statements, and appends the entry to
  `_journal.json`. Confirm no other table diffs leaked in:
  `git status --short shared/db/migrations`
  → only the new `0044_*.sql`, `meta/0044_snapshot.json`, and `meta/_journal.json`
  changed.
- Step: hand-write the RLS migration `shared/db/migrations/0045_checklists_rls.sql`
  (copy the exact syntax from `0038_companies_rls.sql`):
  ```sql
  -- Tenant isolation for checklist templates + items. Same model as companies (0038),
  -- tasks (0028), and job_visits (0026): reuse public.current_org_id() (do NOT redefine),
  -- ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both tables
  -- carry their own org_id (stamped on insert / copied from the parent template), so the
  -- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.

  ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
  --> statement-breakpoint
  ALTER TABLE public.checklist_templates FORCE ROW LEVEL SECURITY;
  --> statement-breakpoint

  CREATE POLICY checklist_templates_tenant_isolation ON public.checklist_templates
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
  --> statement-breakpoint

  ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
  --> statement-breakpoint
  ALTER TABLE public.checklist_items FORCE ROW LEVEL SECURITY;
  --> statement-breakpoint

  CREATE POLICY checklist_items_tenant_isolation ON public.checklist_items
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
  ```
- Step: register the RLS migration in the journal — add the `0045_checklists_rls`
  entry to `shared/db/migrations/meta/_journal.json` `entries` array immediately
  after the `0044` entry, matching the shape of the existing hand-written RLS
  entries (e.g. the `0038_companies_rls` entry): same `version`, incremented
  `idx`, a `when` timestamp, `tag: "0045_checklists_rls"`, `breakpoints: true`.
- Step: apply the migrations to the test DB:
  `npm run db:migrate`
  → `[✓] migrations applied` with `0044_<slug>` and `0045_checklists_rls` in the
  applied list.
- Step: verify RLS is live (fail-closed with no org set):
  ```bash
  psql "$DATABASE_URL" -c "set role mallet_app; select count(*) from public.checklist_templates;"
  ```
  → `ERROR: current_org_id() returned null` (or `0` rows depending on the fn's
  fail-closed mode — matches the companies table's behavior). Reset:
  `psql "$DATABASE_URL" -c "reset role;"`.
- Step: commit:
  `git commit -am "feat(checklists): migration 0044 tables + 0045 RLS policies"`

---

### Task 4: Domain — Checklist aggregate + ChecklistItem + repository interface

**Files:**
- Create `modules/checklists/domain/checklist.ts`.
- Create `modules/checklists/domain/checklist-repository.ts`.
- Test `modules/checklists/domain/checklist.test.ts`.

**Interfaces:**
- Consumes: `Result`/`ValidationError`/`ok`/`err`/`validation`,
  `ChecklistId`/`ChecklistItemId`/`OrgId` (Task 1); models on
  `modules/quoting/domain/estimate.ts` (`EstimateLine` value object + `Estimate`
  aggregate).
- Produces: `Checklist`, `ChecklistProps`, `ChecklistItem` (domain),
  `ChecklistStage`, `ChecklistItemType`, `CHECKLIST_STAGES`,
  `CHECKLIST_ITEM_TYPES`, `isChecklistStage`, `isChecklistItemType`;
  `ChecklistRepository` interface.

- Step: write the failing test — `modules/checklists/domain/checklist.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { asChecklistId, asChecklistItemId, asOrgId, isOk } from "@mallet/shared/types";
  import { Checklist, ChecklistItem, type ChecklistProps } from "./checklist";

  const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
  const CHK = asChecklistId("11111111-1111-1111-1111-111111111111");

  const baseItem = () =>
    ChecklistItem.create({
      id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      text: "Photo of the finished install",
      type: "photo",
      required: true,
      position: 0,
    });

  const baseProps = (over: Partial<ChecklistProps> = {}): ChecklistProps => ({
    id: CHK,
    orgId: ORG,
    name: "Water heater — before you leave",
    trade: "Plumbing",
    stage: "job",
    match: ["water heater"],
    items: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  });

  describe("ChecklistItem", () => {
    it("creates a valid item", () => {
      const r = baseItem();
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.props.text).toBe("Photo of the finished install");
    });

    it("rejects an empty text", () => {
      const r = ChecklistItem.create({
        id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        text: "   ",
        type: "check",
        required: false,
        position: 0,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("text");
    });

    it("rejects an unknown type", () => {
      const r = ChecklistItem.create({
        id: asChecklistItemId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        text: "x",
        // @ts-expect-error deliberately invalid
        type: "video",
        required: false,
        position: 0,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("type");
    });
  });

  describe("Checklist", () => {
    it("creates a valid template and trims the name", () => {
      const r = Checklist.create(baseProps({ name: "  Repipe  " }));
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.props.name).toBe("Repipe");
    });

    it("rejects an empty name", () => {
      const r = Checklist.create(baseProps({ name: "" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("name");
    });

    it("rejects an unknown stage", () => {
      // @ts-expect-error deliberately invalid
      const r = Checklist.create(baseProps({ stage: "invoice" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("stage");
    });

    it("withItems returns a new aggregate ordered by position", () => {
      const i0 = baseItem();
      const i1 = ChecklistItem.create({
        id: asChecklistItemId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        text: "Test T&P valve",
        type: "check",
        required: true,
        position: 1,
      });
      if (!isOk(i0) || !isOk(i1)) throw new Error("item create failed");
      const base = Checklist.create(baseProps());
      if (!isOk(base)) throw new Error("checklist create failed");
      const next = base.value.withItems([i1.value, i0.value], new Date("2026-07-02T00:00:00Z"));
      expect(next.props.items.map((i) => i.props.text)).toEqual([
        "Photo of the finished install",
        "Test T&P valve",
      ]);
      expect(next.props.updatedAt.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    });
  });
  ```
- Step: run it, expected FAIL: `npx vitest run modules/checklists/domain/checklist.test.ts`
  → `Cannot find module './checklist'`.
- Step: minimal implementation — `modules/checklists/domain/checklist.ts`:
  ```typescript
  import type {
    ChecklistId,
    ChecklistItemId,
    OrgId,
    Result,
    ValidationError,
  } from "@mallet/shared/types";
  import { validation, ok, err } from "@mallet/shared/types";

  export const CHECKLIST_STAGES = ["job", "scope"] as const;
  export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];
  export const isChecklistStage = (v: string): v is ChecklistStage =>
    (CHECKLIST_STAGES as readonly string[]).includes(v);

  export const CHECKLIST_ITEM_TYPES = ["check", "photo"] as const;
  export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];
  export const isChecklistItemType = (v: string): v is ChecklistItemType =>
    (CHECKLIST_ITEM_TYPES as readonly string[]).includes(v);

  export interface ChecklistItemProps {
    readonly id: ChecklistItemId;
    readonly text: string;
    readonly type: ChecklistItemType;
    readonly required: boolean;
    readonly position: number;
  }

  // An ordered item on a checklist template. Value object — mutations return a new instance.
  export class ChecklistItem {
    private constructor(private readonly p: ChecklistItemProps) {}

    static create(props: ChecklistItemProps): Result<ChecklistItem, ValidationError> {
      const text = props.text.trim();
      if (text.length === 0) return err(validation("item text is required", "text"));
      if (!isChecklistItemType(props.type)) {
        return err(validation(`unknown item type: ${props.type}`, "type"));
      }
      if (props.position < 0) return err(validation("position cannot be negative", "position"));
      return ok(new ChecklistItem({ ...props, text }));
    }

    withRequired(required: boolean): ChecklistItem {
      return new ChecklistItem({ ...this.p, required });
    }

    get props(): ChecklistItemProps {
      return this.p;
    }
  }

  export interface ChecklistProps {
    readonly id: ChecklistId;
    readonly orgId: OrgId;
    readonly name: string;
    readonly trade: string;
    readonly stage: ChecklistStage;
    readonly match: readonly string[];
    readonly items: readonly ChecklistItem[];
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }

  // A reusable checklist template. Header + ordered items. All mutations return a new Checklist
  // (immutability); the factory enforces invariants so an invalid Checklist cannot exist.
  export class Checklist {
    private constructor(private readonly p: ChecklistProps) {}

    static create(props: ChecklistProps): Result<Checklist, ValidationError> {
      const name = props.name.trim();
      if (name.length === 0) return err(validation("checklist name is required", "name"));
      if (!isChecklistStage(props.stage)) {
        return err(validation(`unknown checklist stage: ${props.stage}`, "stage"));
      }
      // Keep items ordered by position; ties broken by insertion order (stable sort).
      const items = [...props.items].sort((a, b) => a.props.position - b.props.position);
      return ok(new Checklist({ ...props, name, items }));
    }

    // Replace the item collection (re-validated + re-ordered through create).
    withItems(items: readonly ChecklistItem[], now: Date): Checklist {
      const built = Checklist.create({ ...this.p, items, updatedAt: now });
      if (!built.ok) throw new Error(`withItems produced an invalid checklist: ${built.error.message}`);
      return built.value;
    }

    get props(): ChecklistProps {
      return this.p;
    }
  }
  ```
- Step: run it, expected PASS: `npx vitest run modules/checklists/domain/checklist.test.ts`
  → `Test Files  1 passed`.
- Step: create the repository interface — `modules/checklists/domain/checklist-repository.ts`:
  ```typescript
  import type { ChecklistId, ChecklistItemId, CursorPage, Paginated } from "@mallet/shared/types";
  import type { Checklist } from "./checklist";

  // The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
  // is constructed with, so a caller physically cannot address another tenant's checklists.
  export interface ChecklistRepository {
    create(input: {
      id: string;
      orgId: string;
      name: string;
      trade: string;
      stage: string;
      match: readonly string[];
    }): Promise<Checklist>;

    findById(id: ChecklistId): Promise<Checklist | null>;

    list(page: CursorPage): Promise<Paginated<Checklist>>;

    // Soft-delete the template (and cascade-soft-delete its items). Returns rows affected (0 = not found).
    archive(id: ChecklistId, now: Date): Promise<number>;

    // Append one ordered item to a template; returns the reloaded aggregate.
    addItem(input: {
      id: string;
      templateId: ChecklistId;
      text: string;
      type: string;
      position: number;
    }): Promise<Checklist>;

    // Soft-delete one item. Returns the reloaded aggregate (null if the template is gone).
    removeItem(templateId: ChecklistId, itemId: ChecklistItemId, now: Date): Promise<Checklist | null>;

    // Set an item's required flag. Returns the reloaded aggregate (null if not found).
    setItemRequired(
      templateId: ChecklistId,
      itemId: ChecklistItemId,
      required: boolean,
      now: Date,
    ): Promise<Checklist | null>;
  }
  ```
- Step: run typecheck on the module domain:
  `npx tsc --noEmit` → no errors (the interface references only Task-1 ids + the
  Task-4 aggregate).
- Step: commit:
  `git commit -am "feat(checklists): Checklist aggregate + ChecklistItem + repository interface"`

---

### Task 5: App use-cases — create / list / archive / addItem / removeItem / setItemRequired

**Files:**
- Create `modules/checklists/app/create-checklist.ts`.
- Create `modules/checklists/app/list-checklists.ts`.
- Create `modules/checklists/app/archive-checklist.ts`.
- Create `modules/checklists/app/add-item.ts`.
- Create `modules/checklists/app/remove-item.ts`.
- Create `modules/checklists/app/set-item-required.ts`.
- Test `modules/checklists/app/create-checklist.test.ts`,
  `modules/checklists/app/archive-checklist.test.ts`,
  `modules/checklists/app/add-item.test.ts`,
  `modules/checklists/app/set-item-required.test.ts`,
  `modules/checklists/app/remove-item.test.ts`.

**Interfaces:**
- Consumes: `ChecklistRepository` (Task 4), `Clock`/`FixedClock`,
  `IdGenerator`, `Result`/`AppError`/`ok`/`err`/`validation`/`notFound`,
  `logger`. Models on `modules/companies/app/*` and the shared
  `FakeCompanyRepository` test pattern (`create-company.test.ts:44`).
- Produces: `CreateChecklistUseCase` (+ `CreateChecklistCommand`),
  `ListChecklistsUseCase` (+ `ListChecklistsQuery`), `ArchiveChecklistUseCase`,
  `AddItemUseCase` (+ `AddItemCommand`), `RemoveItemUseCase`,
  `SetItemRequiredUseCase`.

- Step: write the failing tests — start with `create-checklist.test.ts` (mirrors
  `create-company.test.ts`), using a shared in-file `FakeChecklistRepository`:
  ```typescript
  import { describe, it, expect, beforeEach } from "vitest";
  import { asChecklistId, asOrgId, FixedClock, isOk, type ChecklistId, type OrgId } from "@mallet/shared/types";
  import { Checklist, type ChecklistProps } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";
  import { CreateChecklistUseCase, type CreateChecklistCommand } from "./create-checklist";

  const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
  const MINTED = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  const baseProps = (over: Partial<ChecklistProps> = {}): ChecklistProps => ({
    id: asChecklistId(MINTED),
    orgId: ORG,
    name: "Water heater",
    trade: "Custom",
    stage: "job",
    match: [],
    items: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  });

  export class FakeChecklistRepository implements ChecklistRepository {
    readonly store = new Map<ChecklistId, Checklist>();
    lastCreatedInput: Parameters<ChecklistRepository["create"]>[0] | undefined;

    async create(input: Parameters<ChecklistRepository["create"]>[0]): Promise<Checklist> {
      this.lastCreatedInput = input;
      const r = Checklist.create(baseProps({
        id: asChecklistId(input.id),
        orgId: asOrgId(input.orgId),
        name: input.name,
        trade: input.trade,
        stage: input.stage as ChecklistProps["stage"],
        match: input.match,
      }));
      if (!isOk(r)) throw new Error("fake create failed");
      this.store.set(r.value.props.id, r.value);
      return r.value;
    }
    async findById(id: ChecklistId) { return this.store.get(id) ?? null; }
    async list() { return { items: [...this.store.values()], nextCursor: null }; }
    async archive(id: ChecklistId) { return this.store.delete(id) ? 1 : 0; }
    async addItem(): Promise<Checklist> { throw new Error("unused"); }
    async removeItem(): Promise<Checklist | null> { throw new Error("unused"); }
    async setItemRequired(): Promise<Checklist | null> { throw new Error("unused"); }
  }

  describe("CreateChecklistUseCase", () => {
    let clock: FixedClock;
    let repo: FakeChecklistRepository;
    let useCase: CreateChecklistUseCase;

    beforeEach(() => {
      clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
      repo = new FakeChecklistRepository();
      useCase = new CreateChecklistUseCase(repo, clock, { newId: () => MINTED });
    });

    it("rejects an empty name without calling the repo", async () => {
      const cmd: CreateChecklistCommand = { name: "  ", trade: "Custom", stage: "job", match: [] };
      const r = await useCase.exec(cmd, ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("validation");
      expect(repo.lastCreatedInput).toBeUndefined();
    });

    it("rejects an unknown stage", async () => {
      const cmd = { name: "x", trade: "Custom", stage: "invoice", match: [] } as unknown as CreateChecklistCommand;
      const r = await useCase.exec(cmd, ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("validation");
    });

    it("mints an id when none provided and passes trimmed name + org", async () => {
      const cmd: CreateChecklistCommand = { name: "  Repipe  ", trade: "Plumbing", stage: "scope", match: ["repipe"] };
      const r = await useCase.exec(cmd, ORG);
      expect(isOk(r)).toBe(true);
      expect(repo.lastCreatedInput?.id).toBe(MINTED);
      expect(repo.lastCreatedInput?.name).toBe("Repipe");
      expect(repo.lastCreatedInput?.orgId).toBe(ORG);
      expect(repo.lastCreatedInput?.stage).toBe("scope");
    });

    it("uses a caller-provided id", async () => {
      const cmd: CreateChecklistCommand = { id: "11111111-1111-1111-1111-111111111111", name: "x", trade: "Custom", stage: "job", match: [] };
      await useCase.exec(cmd, ORG);
      expect(repo.lastCreatedInput?.id).toBe("11111111-1111-1111-1111-111111111111");
    });
  });
  ```
- Step: run it, expected FAIL: `npx vitest run modules/checklists/app/create-checklist.test.ts`
  → `Cannot find module './create-checklist'`.
- Step: minimal implementation — `modules/checklists/app/create-checklist.ts`:
  ```typescript
  import type { Result, AppError, Clock } from "@mallet/shared/types";
  import { validation, ok, err } from "@mallet/shared/types";
  import type { IdGenerator } from "@mallet/shared/ports";
  import { logger } from "@mallet/shared/observability";
  import type { Checklist } from "../domain/checklist";
  import { isChecklistStage } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface CreateChecklistCommand {
    readonly id?: string;
    readonly name: string;
    readonly trade: string;
    readonly stage: string;
    readonly match: readonly string[];
  }

  export class CreateChecklistUseCase {
    constructor(
      private readonly checklists: ChecklistRepository,
      private readonly clock: Clock,
      private readonly ids: IdGenerator,
    ) {}

    async exec(cmd: CreateChecklistCommand, orgId: string): Promise<Result<Checklist, AppError>> {
      const name = cmd.name.trim();
      if (name.length === 0) return err(validation("checklist name is required", "name"));
      if (!isChecklistStage(cmd.stage)) return err(validation(`unknown checklist stage: ${cmd.stage}`, "stage"));

      const checklist = await this.checklists.create({
        id: cmd.id ?? this.ids.newId(),
        orgId,
        name,
        trade: cmd.trade,
        stage: cmd.stage,
        match: cmd.match,
      });

      logger.info({ checklistId: checklist.props.id, orgId }, "checklist.created");
      return ok(checklist);
    }
  }
  ```
- Step: run it, expected PASS: `npx vitest run modules/checklists/app/create-checklist.test.ts`
  → `Test Files  1 passed`.
- Step: write `list-checklists.ts` (mirrors `list-companies.ts` — no dedicated
  test beyond the integration test; it is a thin pass-through):
  ```typescript
  import type { CursorPage, Paginated } from "@mallet/shared/types";
  import type { Checklist } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface ListChecklistsQuery {
    readonly page: CursorPage;
  }

  // Thin read use-case: keyset-paginate the org's active checklist templates (with items).
  // Tenant scoping is enforced by the org-scoped transaction the repository runs in.
  export class ListChecklistsUseCase {
    constructor(private readonly checklists: ChecklistRepository) {}

    exec(query: ListChecklistsQuery): Promise<Paginated<Checklist>> {
      return this.checklists.list(query.page);
    }
  }
  ```
- Step: write the failing `archive-checklist.test.ts` (mirrors
  `archive-company.test.ts` — happy path returns ok, not-found returns
  `not_found`), then implement `archive-checklist.ts`:
  ```typescript
  import type { ChecklistId, Result, AppError, Clock } from "@mallet/shared/types";
  import { notFound, ok, err } from "@mallet/shared/types";
  import { logger } from "@mallet/shared/observability";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface ArchiveChecklistCommand {
    readonly checklistId: ChecklistId;
  }

  export class ArchiveChecklistUseCase {
    constructor(
      private readonly checklists: ChecklistRepository,
      private readonly clock: Clock,
    ) {}

    async exec(cmd: ArchiveChecklistCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
      const count = await this.checklists.archive(cmd.checklistId, this.clock.now());
      if (count === 0) return err(notFound("checklist not found or already archived"));
      logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.archived");
      return ok({ ok: true });
    }
  }
  ```
  The `archive-checklist.test.ts` uses the exported `FakeChecklistRepository`
  from `create-checklist.test.ts` (import it) and asserts:
  ```typescript
  it("returns not_found for an unknown id", async () => {
    const r = await useCase.exec({ checklistId: asChecklistId("00000000-0000-0000-0000-000000000000") }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
  it("returns ok when a template is archived", async () => {
    const created = await createUseCase.exec({ name: "x", trade: "Custom", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");
    const r = await useCase.exec({ checklistId: created.value.props.id }, ORG);
    expect(r.ok).toBe(true);
  });
  ```
- Step: write the failing `add-item.test.ts` — the fake's `addItem` now records
  the input and returns a reloaded aggregate; assert the use-case validates text
  and item type, computes the next `position` from the current item count, and
  passes a minted id. Then implement `add-item.ts`:
  ```typescript
  import type { ChecklistId, Result, AppError, Clock } from "@mallet/shared/types";
  import { validation, notFound, ok, err } from "@mallet/shared/types";
  import type { IdGenerator } from "@mallet/shared/ports";
  import { logger } from "@mallet/shared/observability";
  import type { Checklist } from "../domain/checklist";
  import { isChecklistItemType } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface AddItemCommand {
    readonly checklistId: ChecklistId;
    readonly id?: string;
    readonly text: string;
    readonly type: string;
  }

  export class AddItemUseCase {
    constructor(
      private readonly checklists: ChecklistRepository,
      private readonly clock: Clock,
      private readonly ids: IdGenerator,
    ) {}

    async exec(cmd: AddItemCommand, orgId: string): Promise<Result<Checklist, AppError>> {
      const text = cmd.text.trim();
      if (text.length === 0) return err(validation("item text is required", "text"));
      if (!isChecklistItemType(cmd.type)) return err(validation(`unknown item type: ${cmd.type}`, "type"));

      const template = await this.checklists.findById(cmd.checklistId);
      if (!template) return err(notFound("checklist not found"));

      // Append: position = current item count (0-based), preserving order.
      const position = template.props.items.length;
      const updated = await this.checklists.addItem({
        id: cmd.id ?? this.ids.newId(),
        templateId: cmd.checklistId,
        text,
        type: cmd.type,
        position,
      });

      logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_added");
      return ok(updated);
    }
  }
  ```
- Step: write the failing `remove-item.test.ts` (returns `not_found` when the
  repo returns null) then implement `remove-item.ts`:
  ```typescript
  import type { ChecklistId, ChecklistItemId, Result, AppError, Clock } from "@mallet/shared/types";
  import { notFound, ok, err } from "@mallet/shared/types";
  import { logger } from "@mallet/shared/observability";
  import type { Checklist } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface RemoveItemCommand {
    readonly checklistId: ChecklistId;
    readonly itemId: ChecklistItemId;
  }

  export class RemoveItemUseCase {
    constructor(
      private readonly checklists: ChecklistRepository,
      private readonly clock: Clock,
    ) {}

    async exec(cmd: RemoveItemCommand, orgId: string): Promise<Result<Checklist, AppError>> {
      const updated = await this.checklists.removeItem(cmd.checklistId, cmd.itemId, this.clock.now());
      if (!updated) return err(notFound("checklist or item not found"));
      logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_removed");
      return ok(updated);
    }
  }
  ```
- Step: write the failing `set-item-required.test.ts` (asserts `not_found` on
  null return; ok + reloaded aggregate on hit) then implement
  `set-item-required.ts`:
  ```typescript
  import type { ChecklistId, ChecklistItemId, Result, AppError, Clock } from "@mallet/shared/types";
  import { notFound, ok, err } from "@mallet/shared/types";
  import { logger } from "@mallet/shared/observability";
  import type { Checklist } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";

  export interface SetItemRequiredCommand {
    readonly checklistId: ChecklistId;
    readonly itemId: ChecklistItemId;
    readonly required: boolean;
  }

  export class SetItemRequiredUseCase {
    constructor(
      private readonly checklists: ChecklistRepository,
      private readonly clock: Clock,
    ) {}

    async exec(cmd: SetItemRequiredCommand, orgId: string): Promise<Result<Checklist, AppError>> {
      const updated = await this.checklists.setItemRequired(
        cmd.checklistId,
        cmd.itemId,
        cmd.required,
        this.clock.now(),
      );
      if (!updated) return err(notFound("checklist or item not found"));
      logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_required_set");
      return ok(updated);
    }
  }
  ```
- Step: run all app tests, expected PASS:
  `npx vitest run modules/checklists/app/`
  → `Test Files  5 passed`.
- Step: commit:
  `git commit -am "feat(checklists): create/list/archive + addItem/removeItem/setItemRequired use-cases"`

---

### Task 6: Infra — mapper + DrizzleChecklistRepository

**Files:**
- Create `modules/checklists/infra/checklist-mapper.ts`.
- Create `modules/checklists/infra/drizzle-checklist-repository.ts`.
- (No standalone unit test — infra is exercised by the Task 7 integration test
  against the live DB, matching `drizzle-company-repository.ts` which has no unit
  test either.)

**Interfaces:**
- Consumes: `checklistTemplates` / `checklistItems` (Task 2 schema),
  `TenantTx` (`shared/db/tx`), `buildPage`/`decodeCursor`/`isOk` +
  `asChecklistId`/`asChecklistItemId`/`asOrgId` (Task 1). Models on
  `modules/companies/infra/*` and `modules/quoting/infra/*` (batch child-load).
- Produces: `ChecklistRow` / `ChecklistItemRow` types, `toDomain` mapper,
  `DrizzleChecklistRepository` (implements `ChecklistRepository`).

- Step: create the mapper — `modules/checklists/infra/checklist-mapper.ts`
  (mirrors `estimate-mapper.ts` header+children reconstruction):
  ```typescript
  import { asChecklistId, asChecklistItemId, asOrgId } from "@mallet/shared/types";
  import { checklistTemplates, checklistItems } from "@mallet/shared/db/schema";
  import { Checklist, ChecklistItem, isChecklistStage } from "../domain/checklist";

  export type ChecklistRow = typeof checklistTemplates.$inferSelect;
  export type ChecklistItemRow = typeof checklistItems.$inferSelect;

  const toItem = (row: ChecklistItemRow): ChecklistItem => {
    const result = ChecklistItem.create({
      id: asChecklistItemId(row.id),
      text: row.text,
      type: row.type === "photo" ? "photo" : "check",
      required: row.required,
      position: row.position,
    });
    if (!result.ok) throw new Error(`corrupt checklist_item ${row.id}: ${result.error.message}`);
    return result.value;
  };

  // Reconstruct the aggregate from a header row + its (deleted-filtered) item rows. Corrupt data
  // fails loud rather than silently coercing.
  export const toDomain = (row: ChecklistRow, itemRows: readonly ChecklistItemRow[]): Checklist => {
    if (!isChecklistStage(row.stage)) {
      throw new Error(`corrupt checklist ${row.id}: unknown stage "${row.stage}"`);
    }
    const items = [...itemRows].sort((a, b) => a.position - b.position).map(toItem);
    const result = Checklist.create({
      id: asChecklistId(row.id),
      orgId: asOrgId(row.orgId),
      name: row.name,
      trade: row.trade,
      stage: row.stage,
      match: row.match,
      items,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    if (!result.ok) throw new Error(`corrupt checklist ${row.id}: ${result.error.message}`);
    return result.value;
  };
  ```
- Step: create the repository — `modules/checklists/infra/drizzle-checklist-repository.ts`
  (mirrors `DrizzleCompanyRepository` + the estimate repo's batch child-load in
  `list`):
  ```typescript
  import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
  import { checklistTemplates, checklistItems } from "@mallet/shared/db/schema";
  import type { TenantTx } from "@mallet/shared/db/tx";
  import {
    buildPage,
    decodeCursor,
    isOk,
    type OrgId,
    type ChecklistId,
    type ChecklistItemId,
    type CursorPage,
    type Paginated,
  } from "@mallet/shared/types";
  import type { Checklist } from "../domain/checklist";
  import type { ChecklistRepository } from "../domain/checklist-repository";
  import { toDomain, type ChecklistItemRow } from "./checklist-mapper";

  // Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
  // app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
  export class DrizzleChecklistRepository implements ChecklistRepository {
    constructor(
      private readonly tx: TenantTx,
      private readonly orgId: OrgId,
    ) {}

    async create(input: {
      id: string;
      orgId: string;
      name: string;
      trade: string;
      stage: string;
      match: readonly string[];
    }): Promise<Checklist> {
      const rows = await this.tx
        .insert(checklistTemplates)
        .values({
          id: input.id,
          orgId: this.orgId,
          name: input.name,
          trade: input.trade,
          stage: input.stage,
          match: [...input.match],
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("checklist insert returned no row");
      return toDomain(row, []);
    }

    async findById(id: ChecklistId): Promise<Checklist | null> {
      const rows = await this.tx
        .select()
        .from(checklistTemplates)
        .where(and(eq(checklistTemplates.id, id), isNull(checklistTemplates.deletedAt)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const itemRows = await this.loadItems([id]);
      return toDomain(row, itemRows);
    }

    async list(page: CursorPage): Promise<Paginated<Checklist>> {
      const conds = [eq(checklistTemplates.orgId, this.orgId), isNull(checklistTemplates.deletedAt)];
      if (page.cursor) {
        const cursor = decodeCursor(page.cursor);
        if (isOk(cursor)) {
          conds.push(
            sql`(${checklistTemplates.createdAt}, ${checklistTemplates.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
          );
        }
      }
      const rows = await this.tx
        .select()
        .from(checklistTemplates)
        .where(and(...conds))
        .orderBy(desc(checklistTemplates.createdAt), desc(checklistTemplates.id))
        .limit(page.limit + 1);

      // Batch-load items for the page in ONE query (no N+1).
      const ids = rows.map((r) => r.id);
      const itemRows = ids.length ? await this.loadItems(ids) : [];
      const byTemplate = new Map<string, ChecklistItemRow[]>();
      for (const it of itemRows) {
        const arr = byTemplate.get(it.templateId) ?? [];
        arr.push(it);
        byTemplate.set(it.templateId, arr);
      }

      const domain = rows.map((r) => toDomain(r, byTemplate.get(r.id) ?? []));
      return buildPage(domain, page, (chk) => ({
        createdAt: chk.props.createdAt,
        id: chk.props.id,
      }));
    }

    async archive(id: ChecklistId, now: Date): Promise<number> {
      const rows = await this.tx
        .update(checklistTemplates)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.orgId, this.orgId), isNull(checklistTemplates.deletedAt)))
        .returning();
      if (rows.length === 0) return 0;
      // Cascade soft-delete the items so a restored template does not resurrect stale items.
      await this.tx
        .update(checklistItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(checklistItems.templateId, id), isNull(checklistItems.deletedAt)));
      return rows.length;
    }

    async addItem(input: {
      id: string;
      templateId: ChecklistId;
      text: string;
      type: string;
      position: number;
    }): Promise<Checklist> {
      await this.tx.insert(checklistItems).values({
        id: input.id,
        orgId: this.orgId,
        templateId: input.templateId,
        text: input.text,
        type: input.type,
        position: input.position,
      });
      const reloaded = await this.findById(input.templateId);
      if (!reloaded) throw new Error("checklist disappeared after addItem");
      return reloaded;
    }

    async removeItem(templateId: ChecklistId, itemId: ChecklistItemId, now: Date): Promise<Checklist | null> {
      await this.tx
        .update(checklistItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(checklistItems.id, itemId), eq(checklistItems.templateId, templateId), isNull(checklistItems.deletedAt)));
      return this.findById(templateId);
    }

    async setItemRequired(
      templateId: ChecklistId,
      itemId: ChecklistItemId,
      required: boolean,
      now: Date,
    ): Promise<Checklist | null> {
      await this.tx
        .update(checklistItems)
        .set({ required, updatedAt: now })
        .where(and(eq(checklistItems.id, itemId), eq(checklistItems.templateId, templateId), isNull(checklistItems.deletedAt)));
      return this.findById(templateId);
    }

    private async loadItems(templateIds: readonly string[]): Promise<ChecklistItemRow[]> {
      return this.tx
        .select()
        .from(checklistItems)
        .where(and(inArray(checklistItems.templateId, [...templateIds]), isNull(checklistItems.deletedAt)));
    }
  }
  ```
- Step: run typecheck (no unit test at this layer, per company-repo precedent):
  `npx tsc --noEmit` → no errors.
- Step: commit:
  `git commit -am "feat(checklists): drizzle repository + mapper"`

---

### Task 7: API — DTO + router + module index + registration

**Files:**
- Create `modules/checklists/api/checklist-dto.ts`.
- Create `modules/checklists/api/checklist-router.ts`.
- Create `modules/checklists/index.ts`.
- Modify `trpc/root.ts` (add the import L`12` region + `checklists:` entry
  L`30` region).
- Test `modules/checklists/api/checklist-router.int.test.ts`.

**Interfaces:**
- Consumes: `ownerOrOffice` + `router` (`trpc/init.ts`), `orThrow`
  (`trpc/errors.ts:17`), `toPage`/`asChecklistId`/`asChecklistItemId`,
  all Task-5 use-cases + Task-6 repo. Models on `company-router.ts` +
  `company-router.int.test.ts`.
- Produces: `checklistDTO` (`{ id, name, trade, stage, match[], items[] }`),
  `createChecklistRouter` exported from `@mallet/checklists`, registered as
  `v1.checklists`.

- Step: create the DTO — `modules/checklists/api/checklist-dto.ts`:
  ```typescript
  import { z } from "zod";
  import type { Checklist } from "../domain/checklist";

  export const checklistItemDTO = z.object({
    id: z.string().uuid(),
    text: z.string(),
    type: z.enum(["check", "photo"]),
    required: z.boolean(),
    position: z.number().int(),
  });

  export const checklistDTO = z.object({
    id: z.string().uuid(),
    name: z.string(),
    trade: z.string(),
    stage: z.enum(["job", "scope"]),
    match: z.array(z.string()),
    items: z.array(checklistItemDTO),
    createdAt: z.string(),
  });

  export type ChecklistDTO = z.infer<typeof checklistDTO>;

  export const toChecklistDTO = (checklist: Checklist): ChecklistDTO => {
    const p = checklist.props;
    return {
      id: p.id,
      name: p.name,
      trade: p.trade,
      stage: p.stage,
      match: [...p.match],
      items: p.items.map((it) => ({
        id: it.props.id,
        text: it.props.text,
        type: it.props.type,
        required: it.props.required,
        position: it.props.position,
      })),
      createdAt: p.createdAt.toISOString(),
    };
  };
  ```
- Step: create the router — `modules/checklists/api/checklist-router.ts`
  (mirrors `company-router.ts`; every procedure `ownerOrOffice`):
  ```typescript
  import { z } from "zod";
  import { router, ownerOrOffice } from "@/trpc/init";
  import { orThrow } from "@/trpc/errors";
  import { asChecklistId, asChecklistItemId, toPage } from "@mallet/shared/types";
  import { DrizzleChecklistRepository } from "../infra/drizzle-checklist-repository";
  import { CreateChecklistUseCase } from "../app/create-checklist";
  import { ListChecklistsUseCase } from "../app/list-checklists";
  import { ArchiveChecklistUseCase } from "../app/archive-checklist";
  import { AddItemUseCase } from "../app/add-item";
  import { RemoveItemUseCase } from "../app/remove-item";
  import { SetItemRequiredUseCase } from "../app/set-item-required";
  import { checklistDTO, toChecklistDTO } from "./checklist-dto";

  const paginatedChecklistDTO = z.object({
    items: z.array(checklistDTO),
    nextCursor: z.string().nullable(),
  });

  const listInput = z.object({
    limit: z.number().int().positive().max(500).optional(),
    cursor: z.string().nullish(),
  });

  const createInput = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    trade: z.string().max(80).optional(),
    stage: z.enum(["job", "scope"]),
    match: z.array(z.string().max(120)).max(50).optional(),
  });

  const removeInput = z.object({ checklistId: z.string().uuid() });

  const addItemInput = z.object({
    checklistId: z.string().uuid(),
    id: z.string().uuid().optional(),
    text: z.string().min(1).max(500),
    type: z.enum(["check", "photo"]),
  });

  const removeItemInput = z.object({
    checklistId: z.string().uuid(),
    itemId: z.string().uuid(),
  });

  const setItemRequiredInput = z.object({
    checklistId: z.string().uuid(),
    itemId: z.string().uuid(),
    required: z.boolean(),
  });

  // Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
  // request's tx + ports, delegate, map the result. No business logic lives here.
  export const createChecklistRouter = () =>
    router({
      list: ownerOrOffice
        .input(listInput)
        .output(paginatedChecklistDTO)
        .query(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ListChecklistsUseCase(repo);
          const page = await useCase.exec({ page: toPage({ limit: input.limit, cursor: input.cursor ?? null }) });
          return { items: page.items.map(toChecklistDTO), nextCursor: page.nextCursor };
        }),

      create: ownerOrOffice
        .input(createInput)
        .output(checklistDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new CreateChecklistUseCase(repo, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            { id: input.id, name: input.name, trade: input.trade ?? "Custom", stage: input.stage, match: input.match ?? [] },
            ctx.principal.orgId,
          );
          return toChecklistDTO(orThrow(result));
        }),

      remove: ownerOrOffice
        .input(removeInput)
        .output(z.object({ ok: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ArchiveChecklistUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec({ checklistId: asChecklistId(input.checklistId) }, ctx.principal.orgId);
          return orThrow(result);
        }),

      addItem: ownerOrOffice
        .input(addItemInput)
        .output(checklistDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new AddItemUseCase(repo, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            { checklistId: asChecklistId(input.checklistId), id: input.id, text: input.text, type: input.type },
            ctx.principal.orgId,
          );
          return toChecklistDTO(orThrow(result));
        }),

      removeItem: ownerOrOffice
        .input(removeItemInput)
        .output(checklistDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new RemoveItemUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            { checklistId: asChecklistId(input.checklistId), itemId: asChecklistItemId(input.itemId) },
            ctx.principal.orgId,
          );
          return toChecklistDTO(orThrow(result));
        }),

      setItemRequired: ownerOrOffice
        .input(setItemRequiredInput)
        .output(checklistDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new SetItemRequiredUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            { checklistId: asChecklistId(input.checklistId), itemId: asChecklistItemId(input.itemId), required: input.required },
            ctx.principal.orgId,
          );
          return toChecklistDTO(orThrow(result));
        }),
    });
  ```
- Step: create the module barrel — `modules/checklists/index.ts`:
  ```typescript
  // Public surface for the checklists module — the only sanctioned import seam.
  export { createChecklistRouter } from "./api/checklist-router";
  export type { Checklist, ChecklistProps, ChecklistItem } from "./domain/checklist";
  export type { ChecklistRepository } from "./domain/checklist-repository";
  export { CreateChecklistUseCase } from "./app/create-checklist";
  export { ListChecklistsUseCase } from "./app/list-checklists";
  export { ArchiveChecklistUseCase } from "./app/archive-checklist";
  export { AddItemUseCase } from "./app/add-item";
  export { RemoveItemUseCase } from "./app/remove-item";
  export { SetItemRequiredUseCase } from "./app/set-item-required";
  export { DrizzleChecklistRepository } from "./infra/drizzle-checklist-repository";
  ```
- Step: register in `trpc/root.ts` — add the import after L12
  (`import { createMessagingRouter } from "@mallet/messaging";`):
  ```typescript
  import { createChecklistRouter } from "@mallet/checklists";
  ```
  and add the entry after `messaging: createMessagingRouter(),` (L30):
  ```typescript
      checklists: createChecklistRouter(),
  ```
- Step: write the failing integration test —
  `modules/checklists/api/checklist-router.int.test.ts` (mirrors
  `company-router.int.test.ts` exactly: `ctxFor` helper, org A/B, `createCaller`):
  ```typescript
  import { describe, it, expect, beforeAll, afterAll } from "vitest";
  import postgres from "postgres";
  import type { Sql } from "postgres";
  import { randomUUID } from "node:crypto";
  import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
  import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
  import { closeDb } from "@mallet/shared/db/client";
  import type { AuthProvider, Principal, Role } from "@mallet/identity";
  import { appRouter } from "@/trpc/root";
  import type { Context } from "@/trpc/init";

  const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
  const suite = hasDb ? describe : describe.skip;

  const stubAuth: AuthProvider = {
    authenticate: async () => { throw new Error("authProvider should not be called in createCaller tests"); },
  };

  const ctxFor = (orgId: string, role: Role): Context => ({
    principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
    unmapped: null,
    tx: null,
    deps: {
      authProvider: stubAuth,
      bus: new InMemoryEventBus(),
      clock: systemClock,
      ids: uuidGenerator,
      paymentLinkGateway: null,
      llmClient: null,
      apiKeyAuthenticator: { authenticate: async () => null },
      tokenVerifier: { verify: async () => null },
      signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },
    },
  });

  suite("checklists tRPC router (full stack, live RLS)", () => {
    let admin: Sql;
    let orgAId = "";
    let orgBId = "";

    beforeAll(async () => {
      admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
      const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('ChkApi A ' || gen_random_uuid()) returning id`;
      const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('ChkApi B ' || gen_random_uuid()) returning id`;
      orgAId = a!.id;
      orgBId = b!.id;
    });

    afterAll(async () => {
      if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
      await admin.end({ timeout: 5 });
      await closeDb();
    });

    it("owner creates a template, adds items, toggles required, lists it back with ordered items", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const chk = await caller.v1.checklists.create({ name: "Water heater", trade: "Plumbing", stage: "job", match: ["water heater"] });
      expect(chk.name).toBe("Water heater");
      expect(chk.items).toHaveLength(0);

      const withPhoto = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Photo of the finished install", type: "photo" });
      const withCheck = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Test T&P valve", type: "check" });
      expect(withCheck.items.map((i) => i.position)).toEqual([0, 1]);
      expect(withPhoto.items[0]!.type).toBe("photo");

      const toggled = await caller.v1.checklists.setItemRequired({ checklistId: chk.id, itemId: withCheck.items[1]!.id, required: true });
      expect(toggled.items[1]!.required).toBe(true);

      const listed = await caller.v1.checklists.list({ limit: 50 });
      const found = listed.items.find((c) => c.id === chk.id);
      expect(found?.items).toHaveLength(2);
    });

    it("removeItem soft-deletes one item; remove archives the whole template", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const chk = await caller.v1.checklists.create({ name: "Repipe", stage: "scope" });
      const withItem = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Access notes", type: "check" });
      const afterRemove = await caller.v1.checklists.removeItem({ checklistId: chk.id, itemId: withItem.items[0]!.id });
      expect(afterRemove.items).toHaveLength(0);

      const gone = await caller.v1.checklists.remove({ checklistId: chk.id });
      expect(gone.ok).toBe(true);
      const listed = await caller.v1.checklists.list({ limit: 500 });
      expect(listed.items.some((c) => c.id === chk.id)).toBe(false);
    });

    it("a different org sees none of org A's templates", async () => {
      const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
      const listed = await callerB.v1.checklists.list({ limit: 500 });
      expect(listed.items).toHaveLength(0);
    });

    it("org B cannot addItem/remove org A's template (NOT_FOUND via RLS)", async () => {
      const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
      const chk = await callerA.v1.checklists.create({ name: "RLS Boundary", stage: "job" });
      const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
      await expect(callerB.v1.checklists.addItem({ checklistId: chk.id, text: "x", type: "check" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(callerB.v1.checklists.remove({ checklistId: chk.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create rejects an empty name with BAD_REQUEST", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await expect(caller.v1.checklists.create({ name: "   ", stage: "job" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("a tech is forbidden from checklist mutations", async () => {
      const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
      await expect(callerTech.v1.checklists.create({ name: "Nope", stage: "job" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
  ```
- Step: run it, expected PASS (DB env present):
  `npx vitest run --config vitest.integration.config.ts modules/checklists/api/checklist-router.int.test.ts`
  → `Test Files  1 passed` (6 tests). (Without DB env the suite skips — same as
  the companies int test.)
- Step: commit:
  `git commit -am "feat(checklists): v1.checklists router + DTO + module registration"`

---

### Task 8: ChecklistsHydrator

**Files:**
- Create `features/checklists/checklists-hydrator.tsx`.
- Modify `app/(office)/layout.tsx` (import after L17 `CompaniesHydrator`; mount
  after L47 `<CompaniesHydrator />`).
- Test `features/checklists/checklists-hydrator.test.tsx` (transform mapping —
  mirrors the pure `toStore*` unit style; the hook itself is covered by the
  shared `use-store-hydrator` tests).

**Interfaces:**
- Consumes: `api` + `RouterOutputs` (`lib/trpc/client.ts`), `useStoreHydrator`
  (`lib/store/use-store-hydrator.ts:39`), `HYDRATOR_STALE_MS`/`HYDRATOR_PAGE_LIMIT`,
  `useAppStore` + `setChecklists` (Task 9), store `Checklist`/`ChecklistItem`
  (Task 1). Models on `companies-hydrator.tsx` + `estimates-hydrator.tsx`.
- Produces: `ChecklistsHydrator` component; `toStoreChecklist` transform.

- Step: write the failing test — `features/checklists/checklists-hydrator.test.tsx`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { toStoreChecklist } from "./checklists-hydrator";

  describe("toStoreChecklist", () => {
    it("maps a checklist DTO to the store shape, preserving item order + ids", () => {
      const store = toStoreChecklist({
        id: "11111111-1111-1111-1111-111111111111",
        name: "Water heater",
        trade: "Plumbing",
        stage: "job",
        match: ["water heater"],
        createdAt: "2026-07-01T00:00:00.000Z",
        items: [
          { id: "aaaa", text: "Photo", type: "photo", required: true, position: 0 },
          { id: "bbbb", text: "Test valve", type: "check", required: false, position: 1 },
        ],
      });
      expect(store.id).toBe("11111111-1111-1111-1111-111111111111");
      expect(store.stage).toBe("job");
      expect(store.items.map((i) => i.id)).toEqual(["aaaa", "bbbb"]);
      expect(store.items[0].type).toBe("photo");
      expect(store.items[0].required).toBe(true);
    });
  });
  ```
- Step: run it, expected FAIL: `npx vitest run features/checklists/checklists-hydrator.test.tsx`
  → `Cannot find module './checklists-hydrator'`.
- Step: minimal implementation — `features/checklists/checklists-hydrator.tsx`:
  ```typescript
  "use client";

  /**
   * features/checklists/checklists-hydrator.tsx
   * Mounts in the office layout. Subscribes to trpc.v1.checklists.list and writes
   * the result into the Zustand store so StandardsModalContent, the settings
   * Pipeline section, and the job-modal attach picker all read real DB templates.
   *
   * refetchOnWindowFocus: false — checklists have optimistic mutations
   * (addChecklist / addChecklistItem / etc.) that a focus-triggered refetch could
   * overwrite mid-flight. Matches CompaniesHydrator / LeadsHydrator.
   */

  import { api, type RouterOutputs } from "@/lib/trpc/client";
  import { useAppStore } from "@/lib/store/app-store";
  import type { Checklist } from "@/lib/store/types";
  import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
  import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

  type ChecklistDTO = RouterOutputs["v1"]["checklists"]["list"]["items"][number];

  export function toStoreChecklist(dto: ChecklistDTO): Checklist {
    return {
      id: dto.id,
      name: dto.name,
      trade: dto.trade,
      stage: dto.stage,
      match: [...dto.match],
      items: dto.items.map((it) => ({
        id: it.id,
        text: it.text,
        type: it.type,
        required: it.required,
        position: it.position,
      })),
    };
  }

  export function ChecklistsHydrator() {
    const setChecklists = useAppStore((s) => s.setChecklists);
    const { data, isError, error } = api.v1.checklists.list.useQuery(
      { limit: HYDRATOR_PAGE_LIMIT },
      { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
    );

    useStoreHydrator({
      data,
      isError,
      error,
      transform: toStoreChecklist,
      setSlice: setChecklists,
      label: "checklists",
    });

    return null;
  }
  ```
- Step: run it, expected PASS: `npx vitest run features/checklists/checklists-hydrator.test.tsx`
  → `Test Files  1 passed`. (`setChecklists` is added in Task 9; the transform
  test does not exercise the hook, so it passes now. The `useAppStore` selector
  line typechecks only after Task 9 — do NOT run `tsc` at this boundary.)
- Step: mount in the office layout — add to `app/(office)/layout.tsx` the import
  after the `CompaniesHydrator` import (L17):
  ```typescript
  import { ChecklistsHydrator } from "@/features/checklists/checklists-hydrator";
  ```
  and the element after `<CompaniesHydrator />` (L47):
  ```typescript
      <ChecklistsHydrator />
  ```
- Step: commit:
  `git commit -am "feat(checklists): ChecklistsHydrator mounted in office layout"`

---

### Task 9: Persisting checklists-slice (optimistic → persist → reconcile/rollback)

**Files:**
- Rewrite `lib/store/slices/checklists-slice.ts` (remove `SEED_CHECKLISTS`
  L18-44 + `_nextChkId`/`_nextItemId`/`item()` L11-16; add `setChecklists`;
  switch every action to persist).
- Test `lib/store/slices/checklists-slice.test.ts`.

**Interfaces:**
- Consumes: `trpcVanilla` (`lib/trpc/vanilla.ts`), store `Checklist`/`ChecklistItem`
  (Task 1), `v1.checklists.*` (Task 7). Models on `data-slice.ts` `addCompany`
  (server-assigned-id reconcile, `persisted` promise) + `leads-slice.ts`
  `updateLead` (field rollback).
- Produces: `ChecklistsSlice` with `setChecklists`, and the six actions
  (`addChecklist`, `deleteChecklist`, `addChecklistItem`, `deleteChecklistItem`,
  `toggleItemRequired`) all persisting. `addChecklist` now returns
  `{ checklist: Checklist; persisted: Promise<void> }`.

> **Return-shape change.** `addChecklist` today returns `Checklist`
> synchronously; callers (`standards-modal.tsx:97`, `settings/page.tsx:637`)
> ignore the return. Switching to the `addCompany` shape
> (`{ checklist, persisted }`) is safe: both call sites are fire-and-forget. Do
> NOT change those call sites' behavior; just confirm they still typecheck (they
> discard the return).

- Step: write the failing test — `lib/store/slices/checklists-slice.test.ts`
  (mock `trpcVanilla`, mirroring the leads-slice test setup):
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { createStore } from "zustand";
  import { createChecklistsSlice, type ChecklistsSlice } from "./checklists-slice";

  const mutate = {
    create: vi.fn(),
    remove: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    setItemRequired: vi.fn(),
  };

  vi.mock("@/lib/trpc/vanilla", () => ({
    trpcVanilla: {
      v1: {
        checklists: {
          create: { mutate: (...a: unknown[]) => mutate.create(...a) },
          remove: { mutate: (...a: unknown[]) => mutate.remove(...a) },
          addItem: { mutate: (...a: unknown[]) => mutate.addItem(...a) },
          removeItem: { mutate: (...a: unknown[]) => mutate.removeItem(...a) },
          setItemRequired: { mutate: (...a: unknown[]) => mutate.setItemRequired(...a) },
        },
      },
    },
  }));

  const flush = () => new Promise((r) => setTimeout(r, 0));

  describe("checklistsSlice", () => {
    let store: ReturnType<typeof createStore<ChecklistsSlice>>;

    beforeEach(() => {
      vi.clearAllMocks();
      store = createStore<ChecklistsSlice>()((...a) => createChecklistsSlice(...a));
    });

    it("starts empty (no SEED_CHECKLISTS)", () => {
      expect(store.getState().checklists).toEqual([]);
    });

    it("setChecklists replaces the slice", () => {
      store.getState().setChecklists([
        { id: "x", name: "Y", trade: "Custom", stage: "job", match: [], items: [] },
      ]);
      expect(store.getState().checklists).toHaveLength(1);
    });

    it("addChecklist optimistically appends and calls v1.checklists.create with the client id", () => {
      mutate.create.mockResolvedValue({ id: "will-be-ignored", name: "Repipe", trade: "Custom", stage: "job", match: [], items: [], createdAt: "" });
      const { checklist } = store.getState().addChecklist("Repipe", "job");
      expect(store.getState().checklists).toHaveLength(1);
      expect(mutate.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: checklist.id, name: "Repipe", stage: "job" }),
      );
    });

    it("addChecklist rolls back on persist failure", async () => {
      mutate.create.mockRejectedValue(new Error("boom"));
      const { checklist } = store.getState().addChecklist("Repipe", "job");
      await flush();
      expect(store.getState().checklists.some((c) => c.id === checklist.id)).toBe(false);
    });

    it("deleteChecklist optimistically removes and calls remove; rolls back on failure", async () => {
      store.getState().setChecklists([{ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], items: [] }]);
      mutate.remove.mockRejectedValue(new Error("boom"));
      store.getState().deleteChecklist("c1");
      expect(store.getState().checklists).toHaveLength(0);
      await flush();
      expect(store.getState().checklists.some((c) => c.id === "c1")).toBe(true);
    });

    it("addChecklistItem appends optimistically, reconciles server ids from the returned DTO", async () => {
      store.getState().setChecklists([{ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], items: [] }]);
      mutate.addItem.mockResolvedValue({
        id: "c1", name: "A", trade: "Custom", stage: "job", match: [], createdAt: "",
        items: [{ id: "server-item-1", text: "Photo", type: "photo", required: false, position: 0 }],
      });
      store.getState().addChecklistItem("c1", "Photo of X", "photo");
      expect(store.getState().checklists[0].items).toHaveLength(1);
      await flush();
      expect(store.getState().checklists[0].items[0].id).toBe("server-item-1");
    });

    it("toggleItemRequired flips optimistically and calls setItemRequired with the new value", () => {
      store.getState().setChecklists([{
        id: "c1", name: "A", trade: "Custom", stage: "job", match: [],
        items: [{ id: "i1", text: "x", type: "check", required: false, position: 0 }],
      }]);
      mutate.setItemRequired.mockResolvedValue({ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], createdAt: "", items: [{ id: "i1", text: "x", type: "check", required: true, position: 0 }] });
      store.getState().toggleItemRequired("c1", "i1");
      expect(store.getState().checklists[0].items[0].required).toBe(true);
      expect(mutate.setItemRequired).toHaveBeenCalledWith({ checklistId: "c1", itemId: "i1", required: true });
    });
  });
  ```
- Step: run it, expected FAIL:
  `npx vitest run lib/store/slices/checklists-slice.test.ts`
  → fails on `checklists` starting non-empty (SEED) + `setChecklists` undefined +
  no mutate calls.
- Step: rewrite the slice — `lib/store/slices/checklists-slice.ts`:
  ```typescript
  /**
   * lib/store/slices/checklists-slice.ts
   * Checklist templates (job "before you leave" + scope "visit" checklist).
   * DB-backed: ChecklistsHydrator seeds the slice from v1.checklists.list; every
   * mutating action is optimistic → persist via trpcVanilla → reconcile/rollback,
   * mirroring addCompany (data-slice) and updateLead (leads-slice). Immutable updates only.
   */

  import type { StateCreator } from "zustand";
  import type { Checklist, ChecklistItem } from "../types";
  import { trpcVanilla } from "@/lib/trpc/vanilla";

  export interface ChecklistsSlice {
    checklists: Checklist[];
    /** Replace the slice — called by ChecklistsHydrator on hydration. */
    setChecklists: (checklists: Checklist[]) => void;
    addChecklist: (name: string, stage: Checklist["stage"]) => { checklist: Checklist; persisted: Promise<void> };
    deleteChecklist: (id: string) => void;
    addChecklistItem: (checklistId: string, text: string, type?: ChecklistItem["type"]) => void;
    deleteChecklistItem: (checklistId: string, itemId: string) => void;
    toggleItemRequired: (checklistId: string, itemId: string) => void;
  }

  export const createChecklistsSlice: StateCreator<ChecklistsSlice, [], [], ChecklistsSlice> = (set, get) => ({
    checklists: [],

    setChecklists: (checklists) => set({ checklists }),

    addChecklist: (name, stage) => {
      const id = crypto.randomUUID();
      const checklist: Checklist = {
        id,
        name: name.trim() || "New checklist",
        trade: "Custom",
        stage,
        match: [],
        items: [],
      };
      set((s) => ({ checklists: [...s.checklists, checklist] }));

      const persisted = trpcVanilla.v1.checklists.create
        .mutate({ id, name: checklist.name, trade: checklist.trade, stage, match: [] })
        .then((dto) => {
          // Reconcile server-canonical name/trade (id is client-authored, preserved).
          set((s) => ({
            checklists: s.checklists.map((c) => (c.id === dto.id ? { ...c, name: dto.name, trade: dto.trade } : c)),
          }));
        })
        .catch(() => {
          set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));
        }) as Promise<void>;

      return { checklist, persisted };
    },

    deleteChecklist: (id) => {
      const snapshot = get().checklists;
      set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));
      void trpcVanilla.v1.checklists.remove
        .mutate({ checklistId: id })
        .catch(() => set({ checklists: snapshot }));
    },

    addChecklistItem: (checklistId, text, type = "check") => {
      const snapshot = get().checklists;
      const optimisticId = crypto.randomUUID();
      const target = snapshot.find((c) => c.id === checklistId);
      const position = target ? target.items.length : 0;
      const optimistic: ChecklistItem = { id: optimisticId, text, type, required: false, position };
      set((s) => ({
        checklists: s.checklists.map((c) =>
          c.id === checklistId ? { ...c, items: [...c.items, optimistic] } : c,
        ),
      }));
      void trpcVanilla.v1.checklists.addItem
        .mutate({ checklistId, id: optimisticId, text, type })
        .then((dto) => {
          // Reconcile the whole item collection from the server (adopts server ids/positions).
          set((s) => ({
            checklists: s.checklists.map((c) => (c.id === dto.id ? { ...c, items: dto.items } : c)),
          }));
        })
        .catch(() => set({ checklists: snapshot }));
    },

    deleteChecklistItem: (checklistId, itemId) => {
      const snapshot = get().checklists;
      set((s) => ({
        checklists: s.checklists.map((c) =>
          c.id === checklistId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c,
        ),
      }));
      void trpcVanilla.v1.checklists.removeItem
        .mutate({ checklistId, itemId })
        .catch(() => set({ checklists: snapshot }));
    },

    toggleItemRequired: (checklistId, itemId) => {
      const snapshot = get().checklists;
      const current = snapshot.find((c) => c.id === checklistId)?.items.find((i) => i.id === itemId);
      const nextRequired = !(current?.required ?? false);
      set((s) => ({
        checklists: s.checklists.map((c) =>
          c.id === checklistId
            ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, required: nextRequired } : i)) }
            : c,
        ),
      }));
      void trpcVanilla.v1.checklists.setItemRequired
        .mutate({ checklistId, itemId, required: nextRequired })
        .catch(() => set({ checklists: snapshot }));
    },
  });
  ```
- Step: run it, expected PASS:
  `npx vitest run lib/store/slices/checklists-slice.test.ts`
  → `Test Files  1 passed` (8 tests).
- Step: commit:
  `git commit -am "feat(checklists): persist checklists-slice; drop SEED_CHECKLISTS + id counters"`

---

### Task 10: Verify the full gate + open the PR

**Files:** none created; run the repo gate + open the PR.

**Interfaces:**
- Consumes: everything above. This task confirms the store type change
  (`number`→`string` ids) compiles across every consumer (standards-modal,
  job-modal `JobChecklistBlock`, settings `SecPipeline`) — those files use the
  ids only as React keys / match keys and `chk.items` copies, so no code change
  is expected; if `tsc` flags one, fix it minimally here.
- Produces: a green PR for Phase 6.

- Step: typecheck the whole repo:
  `npx tsc --noEmit`
  → exits 0. (This is the first full-repo typecheck since Task 1 changed the store
  id types; confirm `standards-modal.tsx`, `job-modal.tsx`, and
  `settings/page.tsx` still compile — they consume `chk.id`/`it.id` only as keys.)
- Step: lint (0 errors):
  `npm run lint`
  → `✔ No ESLint errors`. (Confirm no `console.log`, no unused
  `SEED_CHECKLISTS`/`_nextChkId` symbols remain — they were deleted in Task 9.)
- Step: run the unit suite:
  `npx vitest run`
  → all files pass, including
  `shared/types/helpers.test.ts`, `shared/db/schema/checklists.schema.test.ts`,
  `modules/checklists/domain/*`, `modules/checklists/app/*`,
  `features/checklists/checklists-hydrator.test.tsx`,
  `lib/store/slices/checklists-slice.test.ts`.
- Step: run the integration suite against the live test DB:
  `npm run test:int`
  → `checklist-router.int.test.ts` passes (6 tests) alongside the existing int
  suites; the cross-tenant RLS assertions confirm isolation.
- Step: coverage gate (80/75):
  `npm run coverage`
  → statements/lines ≥ 80, branches ≥ 75; the new module + slice are covered by
  their unit + int tests.
- Step: build:
  `npm run build`
  → `✓ Compiled successfully` (Next 16 production build, no type errors).
- Step: branch + push + open the PR:
  ```bash
  git push -u origin phase-6-checklist-templates
  gh pr create --title "Phase 6: Checklist templates (DB-backed)" \
    --body "$(cat <<'EOF'
  ## Summary
  Persists checklist templates (job "before you leave" + estimate "visit"
  checklists) to Supabase, closing audit gap #6. New hexagonal
  `modules/checklists/` module mirroring `modules/companies/`, two org-scoped
  tables with hand-written RLS, a `v1.checklists` router, a `ChecklistsHydrator`,
  and a persisting `checklists-slice`. `SEED_CHECKLISTS` + module id counters are
  removed; `Checklist`/`ChecklistItem` ids move from `number` to server UUID
  `string`s, so the per-job attach flow now references stable server template item
  ids and survives refresh.

  ## Changes
  - Schema: `checklist_templates` + `checklist_items` (ordered `position`,
    `required` flag, soft-delete, composite FK for intra-org containment).
  - Migration 0044 (tables) + 0045 (RLS, fail-closed via `current_org_id()`).
  - `v1.checklists`: `list`, `create`, `remove`, `addItem`, `removeItem`,
    `setItemRequired` (all `ownerOrOffice`).
  - `ChecklistsHydrator` mounted in the office layout.
  - `checklists-slice` switched to optimistic → persist → reconcile/rollback.

  ## Test plan
  - [x] Unit: domain invariants, all six use-cases, slice actions
    (optimistic/persist/reconcile/rollback), hydrator transform.
  - [x] Integration: full-stack router against live RLS, incl. cross-tenant
    isolation + tech-forbidden.
  - [x] Gate: typecheck · lint (0) · unit · int · coverage (80/75) · build.
  - [ ] Manual: add a template in Settings → Checklist templates, attach it to a
    job, refresh — template + attachment persist.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
- Step: confirm CI is green on the PR:
  `gh pr checks --watch`
  → all checks pass.


## Phase 7: Invoice edits

Persist invoice edits immediately. Today `updateInvoice` and `setInvoiceLines`
in `lib/store/slices/invoices-slice.ts` are store-only no-ops
(`TODO(persist)`) — a metadata or line edit only reaches the DB *if and when*
the invoice is later `sent` (draft path snapshots at send). This phase adds two
new invoicing mutations — `v1.invoicing.updateMetadata` and
`v1.invoicing.patchLines` — that persist edits to **draft and sent** invoices,
then repoints the two slice actions at them following the standard optimistic →
mutate → reconcile/rollback pattern.

**No migration.** The existing `invoices` + `invoice_lines` tables
(`shared/db/schema/invoices.ts`) already hold every field this phase writes:
`lead_id`, `title`, `terms_days`, `deposit_paid_cents`, `total_cents`, and the
`invoice_lines` collection. `cust`/`phone`/`email` are client-local (not DB
columns) and are preserved across reconcile by `dtoInvoiceToStore(dto, priorInv)`.
The repository already exposes `save()` (header upsert + `diffLines`), so the
work is domain methods + use-cases + router procedures + slice wiring.

**Money:** cents end-to-end at the boundary; the store keeps dollars and the
mapper (`lib/store/dto-mapper.ts`) owns the `× 100` / `/ 100` conversions.

CONSUMES: existing `invoices`/`invoice_lines` tables + the invoicing module
(`Invoice` aggregate, `InvoiceRepository.save`/`findById`,
`DrizzleInvoiceRepository`, `toInvoiceDTO`/`invoiceDTO`, `dtoInvoiceToStore`).
PRODUCES: `Invoice.editMetadata`/`Invoice.editLines` domain methods,
`UpdateInvoiceMetadataUseCase`/`PatchInvoiceLinesUseCase`,
`v1.invoicing.updateMetadata` + `v1.invoicing.patchLines`, and persisting
`updateInvoice`/`setInvoiceLines` store actions.

---

### Task 1: Domain — `Invoice.editMetadata` (draft + sent)

**Files:**
- Modify `modules/invoicing/domain/invoice.ts` (add `editMetadata` after
  `withLines`, L123–128)
- Test `modules/invoicing/domain/invoice.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `InvoiceProps`, `Invoice.create` (existing);
  `Money`, `Result`, `ValidationError`, `money`, `validation`, `ok`, `err`
  from `@mallet/shared/types`.
- Produces:
  ```ts
  interface InvoiceMetadataPatch {
    readonly leadId?: LeadId;
    readonly title?: string | null;
    readonly termsDays?: number;
    readonly depositPaid?: Money;
  }
  editMetadata(patch: InvoiceMetadataPatch, now: Date): Result<Invoice, ValidationError>
  ```
  Editable while `status` is `draft`, `sent`, or `partial`; rejected for
  `paid`/`void`. `undefined` fields keep the current value; `depositPaid` is
  clamped-validated against `total` (reuses the existing invariant in `create`).

- Step: write the failing test. Append to `modules/invoicing/domain/invoice.test.ts`:
  ```ts
  describe("Invoice.editMetadata", () => {
    const build = (status: InvoiceStatus, overrides: Partial<InvoiceProps> = {}) => {
      const r = Invoice.create({
        id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
        orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
        num: "INV-900",
        sourceJobId: null,
        leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
        title: "Old title",
        status,
        total: money(100_000),
        depositPaid: money(0),
        amountPaid: money(0),
        payments: [],
        lines: [],
        termsDays: 7,
        sentAt: status === "draft" ? null : new Date("2026-07-01T00:00:00Z"),
        dueAt: null,
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        ...overrides,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const now = new Date("2026-07-10T12:00:00Z");

    it("patches leadId/title/termsDays/depositPaid on a draft", () => {
      const res = build("draft").editMetadata(
        {
          leadId: asLeadId("44444444-4444-4444-4444-444444444444"),
          title: "New title",
          termsDays: 30,
          depositPaid: money(25_000),
        },
        now,
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.props.leadId).toBe("44444444-4444-4444-4444-444444444444");
        expect(res.value.props.title).toBe("New title");
        expect(res.value.props.termsDays).toBe(30);
        expect(res.value.props.depositPaid).toBe(25_000);
        expect(res.value.props.updatedAt.toISOString()).toBe(now.toISOString());
      }
    });

    it("allows editing a SENT invoice's metadata", () => {
      const res = build("sent").editMetadata({ termsDays: 14 }, now);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.props.termsDays).toBe(14);
    });

    it("keeps fields that are undefined in the patch", () => {
      const res = build("draft", { title: "Keep me" }).editMetadata({ termsDays: 21 }, now);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.props.title).toBe("Keep me");
        expect(res.value.props.leadId).toBe("33333333-3333-3333-3333-333333333333");
      }
    });

    it("clears title to null", () => {
      const res = build("draft").editMetadata({ title: null }, now);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.props.title).toBeNull();
    });

    it("rejects editing a PAID invoice", () => {
      const res = build("paid").editMetadata({ termsDays: 30 }, now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("status");
    });

    it("rejects editing a VOID invoice", () => {
      const res = build("void").editMetadata({ termsDays: 30 }, now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("status");
    });

    it("rejects a negative termsDays", () => {
      const res = build("draft").editMetadata({ termsDays: -1 }, now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("termsDays");
    });

    it("rejects a depositPaid greater than total (create invariant)", () => {
      const res = build("draft").editMetadata({ depositPaid: money(200_000) }, now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("depositPaid");
    });
  });
  ```
  Ensure the file's imports include `asInvoiceId, asOrgId, asLeadId, money` and
  the `InvoiceStatus`, `InvoiceProps` types (they are already imported at the
  top of `invoice.test.ts`; add any missing name to the existing import list).

- Step: run it, expected FAIL.
  `npx vitest run modules/invoicing/domain/invoice.test.ts`
  Expected: `Invoice.editMetadata is not a function` / the new describe block
  fails (method does not exist yet).

- Step: minimal implementation. In `modules/invoicing/domain/invoice.ts`, add
  the `LeadId` import is already present. Add the patch interface above the
  `Invoice` class and the method immediately after `withLines` (L128):
  ```ts
  export interface InvoiceMetadataPatch {
    readonly leadId?: LeadId;
    readonly title?: string | null;
    readonly termsDays?: number;
    readonly depositPaid?: Money;
  }
  ```
  ```ts
    // Edit header metadata on an open invoice (draft | sent | partial). Frozen once paid/void.
    // Undefined fields keep their current value; re-runs create() so every invariant
    // (deposit ≤ total, termsDays ≥ 0) is re-checked.
    editMetadata(patch: InvoiceMetadataPatch, now: Date): Result<Invoice, ValidationError> {
      if (this.p.status === "paid" || this.p.status === "void") {
        return err(validation("a paid or void invoice cannot be edited", "status"));
      }
      return Invoice.create({
        ...this.p,
        leadId: patch.leadId ?? this.p.leadId,
        title: patch.title === undefined ? this.p.title : patch.title,
        termsDays: patch.termsDays ?? this.p.termsDays,
        depositPaid: patch.depositPaid ?? this.p.depositPaid,
        updatedAt: now,
      });
    }
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/domain/invoice.test.ts`
  Expected: all tests pass, including the new `Invoice.editMetadata` block.

- Step: commit.
  `git add modules/invoicing/domain/invoice.ts modules/invoicing/domain/invoice.test.ts && git commit -m "feat: add Invoice.editMetadata for draft and sent invoices"`

---

### Task 2: Domain — `Invoice.editLines` (recompute total, draft + sent)

**Files:**
- Modify `modules/invoicing/domain/invoice.ts` (add `editLines` after
  `editMetadata`)
- Test `modules/invoicing/domain/invoice.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `InvoiceLine` (`.amount()`), `Money`, `addMoney`, `zeroMoney` from
  `@mallet/shared/types` (add `addMoney`, `zeroMoney` to the domain file's
  existing import — `addMoney` is already imported; add `zeroMoney`).
- Produces:
  ```ts
  editLines(lines: readonly InvoiceLine[], now: Date): Result<Invoice, ValidationError>
  ```
  Replaces the display lines AND recomputes `total = Σ line.amount()` — unlike
  the existing `withLines` (draft-only, total unchanged). Editable while
  `draft`/`sent`/`partial`; rejected for `paid`/`void`. `withLines` is left
  untouched (still used by the create/draft snapshot path).

- Step: write the failing test. Append to `modules/invoicing/domain/invoice.test.ts`:
  ```ts
  describe("Invoice.editLines", () => {
    const line = (rateCents: number, qty: number, pos: number): InvoiceLine => {
      const r = InvoiceLine.create({
        id: `00000000-0000-0000-0000-${String(pos + 1).padStart(12, "0")}`,
        sourceJobLineId: null,
        description: "Work",
        quantity: qty,
        rate: money(rateCents),
        cost: money(0),
        position: pos,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const build = (status: InvoiceStatus) => {
      const r = Invoice.create({
        id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
        orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
        num: "INV-901",
        sourceJobId: null,
        leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
        title: "T",
        status,
        total: money(100_000),
        depositPaid: money(0),
        amountPaid: money(0),
        payments: [],
        lines: [],
        termsDays: 7,
        sentAt: status === "draft" ? null : new Date("2026-07-01T00:00:00Z"),
        dueAt: null,
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const now = new Date("2026-07-10T12:00:00Z");

    it("replaces lines and recomputes the total on a draft", () => {
      const res = build("draft").editLines([line(20_000, 2, 0), line(5_000, 1, 1)], now);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.props.lines).toHaveLength(2);
        expect(res.value.props.total).toBe(45_000); // 2*20000 + 1*5000
        expect(res.value.props.updatedAt.toISOString()).toBe(now.toISOString());
      }
    });

    it("recomputes the total when editing a SENT invoice", () => {
      const res = build("sent").editLines([line(30_000, 1, 0)], now);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.props.total).toBe(30_000);
    });

    it("allows clearing to zero lines (total = 0)", () => {
      const res = build("draft").editLines([], now);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.props.lines).toHaveLength(0);
        expect(res.value.props.total).toBe(0);
      }
    });

    it("rejects editing lines on a PAID invoice", () => {
      const res = build("paid").editLines([line(1_000, 1, 0)], now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("status");
    });

    it("rejects editing lines on a VOID invoice", () => {
      const res = build("void").editLines([line(1_000, 1, 0)], now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe("status");
    });
  });
  ```
  Add `InvoiceLine` to the test's imports (`import { InvoiceLine } from "../domain/invoice-line";`
  — the domain test imports `Invoice`; add the line import if absent).

- Step: run it, expected FAIL.
  `npx vitest run modules/invoicing/domain/invoice.test.ts`
  Expected: the new `Invoice.editLines` block fails — method undefined.

- Step: minimal implementation. Add `zeroMoney` to the `@mallet/shared/types`
  import in `modules/invoicing/domain/invoice.ts`, then add after
  `editMetadata`:
  ```ts
    // Replace display lines AND recompute the total from their amounts. For open invoices
    // (draft | sent | partial). This DIFFERS from withLines, which keeps the snapshot total
    // and is draft-only — that path stays for the create/draft flow.
    editLines(lines: readonly InvoiceLine[], now: Date): Result<Invoice, ValidationError> {
      if (this.p.status === "paid" || this.p.status === "void") {
        return err(validation("a paid or void invoice cannot be edited", "status"));
      }
      const total = lines.reduce((sum, l) => addMoney(sum, l.amount()), zeroMoney);
      return Invoice.create({ ...this.p, lines, total, updatedAt: now });
    }
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/domain/invoice.test.ts`
  Expected: all domain tests pass.

- Step: commit.
  `git add modules/invoicing/domain/invoice.ts modules/invoicing/domain/invoice.test.ts && git commit -m "feat: add Invoice.editLines recomputing total for open invoices"`

---

### Task 3: App — `UpdateInvoiceMetadataUseCase`

**Files:**
- Create `modules/invoicing/app/update-invoice-metadata.ts`
- Test `modules/invoicing/app/update-invoice-metadata.test.ts`

**Interfaces:**
- Consumes: `InvoiceRepository.findById`/`save` (existing);
  `Invoice.editMetadata` (Task 1); `EventBus` (`ctx.deps.bus`), `Clock`,
  `IdGenerator`-free; `InvoiceId`, `LeadId`, `Money`, `Result`, `AppError`,
  `notFound`, `ok`, `err`, `isOk` from `@mallet/shared/types`.
- Produces:
  ```ts
  interface UpdateInvoiceMetadataCommand {
    readonly invoiceId: InvoiceId;
    readonly leadId?: LeadId;
    readonly title?: string | null;
    readonly termsDays?: number;
    readonly depositPaidCents?: number;
  }
  class UpdateInvoiceMetadataUseCase {
    constructor(repo: InvoiceRepository, bus: EventBus, clock: Clock)
    exec(cmd): Promise<Result<Invoice, AppError>>
  }
  ```

- Step: write the failing test. Create
  `modules/invoicing/app/update-invoice-metadata.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import {
    asOrgId, asLeadId, asInvoiceId, money, FixedClock, isOk,
    type OrgId, type LeadId, type InvoiceId, type CursorPage, type Paginated,
    buildPage,
  } from "@mallet/shared/types";
  import { InMemoryEventBus } from "@mallet/shared/ports";
  import { Invoice } from "../domain/invoice";
  import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
  import type { Payment } from "../domain/payment";
  import type { JobId } from "@mallet/shared/types";
  import { UpdateInvoiceMetadataUseCase, type UpdateInvoiceMetadataCommand } from "./update-invoice-metadata";

  const ORG: OrgId = asOrgId("11111111-1111-1111-1111-111111111111");
  const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");
  const INV: InvoiceId = asInvoiceId("33333333-3333-3333-3333-333333333333");
  const MISSING: InvoiceId = asInvoiceId("99999999-9999-9999-9999-999999999999");

  class FakeInvoiceRepository implements InvoiceRepository {
    store = new Map<InvoiceId, Invoice>();
    saveCallCount = 0;
    async nextNumber() { return "INV-1"; }
    async save(i: Invoice) { this.saveCallCount += 1; this.store.set(i.props.id, i); }
    async insertForJob(i: Invoice) { this.store.set(i.props.id, i); return true; }
    async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment) { return true; }
    async applyPayment(_i: InvoiceId, _a: number): Promise<ApplyResult> { return { applied: false, invoice: null }; }
    async findById(id: InvoiceId) { return this.store.get(id) ?? null; }
    async findBySourceJob(_j: JobId) { return null; }
    async list(p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
      return buildPage([...this.store.values()], p, (i) => ({ createdAt: i.props.createdAt, id: i.props.id }));
    }
    async listByLead(_l: LeadId, p: CursorPage) { return this.list(p); }
    async findOverdue(_n: Date, p: CursorPage) { return this.list(p); }
  }

  const seed = (repo: FakeInvoiceRepository, status = "draft" as const) => {
    const r = Invoice.create({
      id: INV, orgId: ORG, num: "INV-800", sourceJobId: null, leadId: LEAD,
      title: "Old", status, total: money(100_000), depositPaid: money(0),
      amountPaid: money(0), payments: [], lines: [], termsDays: 7,
      sentAt: null, dueAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"), updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error(r.error.message);
    repo.store.set(INV, r.value);
  };

  describe("UpdateInvoiceMetadataUseCase", () => {
    let clock: FixedClock;
    let repo: FakeInvoiceRepository;
    let bus: InMemoryEventBus;
    let useCase: UpdateInvoiceMetadataUseCase;

    beforeEach(() => {
      clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
      repo = new FakeInvoiceRepository();
      bus = new InMemoryEventBus();
      useCase = new UpdateInvoiceMetadataUseCase(repo, bus, clock);
    });

    it("returns not_found when the invoice does not exist", async () => {
      const cmd: UpdateInvoiceMetadataCommand = { invoiceId: MISSING, termsDays: 30 };
      const res = await useCase.exec(cmd);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("not_found");
      expect(repo.saveCallCount).toBe(0);
    });

    it("persists leadId/title/termsDays/depositPaid on success", async () => {
      seed(repo);
      const cmd: UpdateInvoiceMetadataCommand = {
        invoiceId: INV,
        leadId: asLeadId("44444444-4444-4444-4444-444444444444"),
        title: "New",
        termsDays: 30,
        depositPaidCents: 25_000,
      };
      const res = await useCase.exec(cmd);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.props.title).toBe("New");
        expect(res.value.props.termsDays).toBe(30);
        expect(res.value.props.depositPaid).toBe(25_000);
        expect(res.value.props.leadId).toBe("44444444-4444-4444-4444-444444444444");
        expect(res.value.props.updatedAt.toISOString()).toBe(clock.now().toISOString());
      }
      expect(repo.saveCallCount).toBe(1);
    });

    it("returns a validation error and does not save when editing a paid invoice", async () => {
      seed(repo, "paid");
      const res = await useCase.exec({ invoiceId: INV, termsDays: 30 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("validation");
      expect(repo.saveCallCount).toBe(0);
    });

    it("rejects a negative termsDays", async () => {
      seed(repo);
      const res = await useCase.exec({ invoiceId: INV, termsDays: -5 });
      expect(res.ok).toBe(false);
      if (!res.ok && res.error.kind === "validation") expect(res.error.field).toBe("termsDays");
    });
  });
  ```

- Step: run it, expected FAIL.
  `npx vitest run modules/invoicing/app/update-invoice-metadata.test.ts`
  Expected: `Cannot find module './update-invoice-metadata'`.

- Step: minimal implementation. Create
  `modules/invoicing/app/update-invoice-metadata.ts`:
  ```ts
  import type { InvoiceId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
  import { money, notFound, ok, err, isOk } from "@mallet/shared/types";
  import type { EventBus } from "@mallet/shared/ports";
  import type { Invoice } from "../domain/invoice";
  import type { InvoiceRepository } from "../domain/invoice-repository";

  export interface UpdateInvoiceMetadataCommand {
    readonly invoiceId: InvoiceId;
    readonly leadId?: LeadId;
    readonly title?: string | null;
    readonly termsDays?: number;
    readonly depositPaidCents?: number;
  }

  // Edit header metadata on an open (draft|sent|partial) invoice. Frozen once paid/void
  // (enforced by Invoice.editMetadata). Emits invoice.updated for audit/relay.
  export class UpdateInvoiceMetadataUseCase {
    constructor(
      private readonly repo: InvoiceRepository,
      private readonly bus: EventBus,
      private readonly clock: Clock,
    ) {}

    async exec(cmd: UpdateInvoiceMetadataCommand): Promise<Result<Invoice, AppError>> {
      const invoice = await this.repo.findById(cmd.invoiceId);
      if (!invoice) return err(notFound("invoice"));

      const now = this.clock.now();
      const patched = invoice.editMetadata(
        {
          leadId: cmd.leadId,
          title: cmd.title,
          termsDays: cmd.termsDays,
          depositPaid: cmd.depositPaidCents === undefined ? undefined : money(cmd.depositPaidCents),
        },
        now,
      );
      if (!isOk(patched)) return patched;

      await this.repo.save(patched.value);
      await this.bus.emit({
        name: "invoice.updated",
        orgId: patched.value.props.orgId,
        payload: { invoiceId: patched.value.props.id, leadId: patched.value.props.leadId },
        occurredAt: now,
      });
      return ok(patched.value);
    }
  }
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/app/update-invoice-metadata.test.ts`
  Expected: all 4 tests pass.

- Step: commit.
  `git add modules/invoicing/app/update-invoice-metadata.ts modules/invoicing/app/update-invoice-metadata.test.ts && git commit -m "feat: add UpdateInvoiceMetadataUseCase"`

---

### Task 4: App — `PatchInvoiceLinesUseCase`

**Files:**
- Create `modules/invoicing/app/patch-invoice-lines.ts`
- Test `modules/invoicing/app/patch-invoice-lines.test.ts`

**Interfaces:**
- Consumes: `InvoiceRepository.findById`/`save`; `Invoice.editLines` (Task 2);
  `InvoiceLine.create`; `InvoiceLineInput` shape mirrors
  `app/draft-invoice.ts` (`description`/`quantity`/`rateCents`/`costCents`);
  `EventBus`, `Clock`, `IdGenerator` (`ctx.deps.ids`, to assign line ids).
- Produces:
  ```ts
  interface PatchInvoiceLinesCommand {
    readonly invoiceId: InvoiceId;
    readonly lines: readonly InvoiceLineInput[]; // reuse draft-invoice's InvoiceLineInput
  }
  class PatchInvoiceLinesUseCase {
    constructor(repo: InvoiceRepository, bus: EventBus, clock: Clock, ids: IdGenerator)
    exec(cmd): Promise<Result<Invoice, AppError>>
  }
  ```
  Client sends the full desired line set (no partial diff); the use-case rebuilds
  `InvoiceLine`s (new server ids, sequential `position`) and calls
  `editLines`, which recomputes the total. `save()`'s `diffLines` reconciles the
  DB rows (soft-deletes the dropped ones).

- Step: write the failing test. Create
  `modules/invoicing/app/patch-invoice-lines.test.ts` — reuse the same
  `FakeInvoiceRepository`/`seed` scaffold as Task 3 (copy it into this file;
  the domain fixtures are module-local). Assert:
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import {
    asOrgId, asLeadId, asInvoiceId, money, FixedClock, isOk,
    type OrgId, type LeadId, type InvoiceId, type CursorPage, type Paginated, type JobId,
    buildPage,
  } from "@mallet/shared/types";
  import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
  import { Invoice } from "../domain/invoice";
  import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
  import type { Payment } from "../domain/payment";
  import { PatchInvoiceLinesUseCase, type PatchInvoiceLinesCommand } from "./patch-invoice-lines";

  const ORG: OrgId = asOrgId("11111111-1111-1111-1111-111111111111");
  const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");
  const INV: InvoiceId = asInvoiceId("33333333-3333-3333-3333-333333333333");
  const MISSING: InvoiceId = asInvoiceId("99999999-9999-9999-9999-999999999999");

  const seqIds = (): IdGenerator => {
    let n = 0;
    return { newId: () => { n += 1; return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`; } };
  };

  class FakeInvoiceRepository implements InvoiceRepository {
    store = new Map<InvoiceId, Invoice>();
    saveCallCount = 0;
    async nextNumber() { return "INV-1"; }
    async save(i: Invoice) { this.saveCallCount += 1; this.store.set(i.props.id, i); }
    async insertForJob(i: Invoice) { this.store.set(i.props.id, i); return true; }
    async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment) { return true; }
    async applyPayment(_i: InvoiceId, _a: number): Promise<ApplyResult> { return { applied: false, invoice: null }; }
    async findById(id: InvoiceId) { return this.store.get(id) ?? null; }
    async findBySourceJob(_j: JobId) { return null; }
    async list(p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
      return buildPage([...this.store.values()], p, (i) => ({ createdAt: i.props.createdAt, id: i.props.id }));
    }
    async listByLead(_l: LeadId, p: CursorPage) { return this.list(p); }
    async findOverdue(_n: Date, p: CursorPage) { return this.list(p); }
  }

  const seed = (repo: FakeInvoiceRepository, status = "draft" as const) => {
    const r = Invoice.create({
      id: INV, orgId: ORG, num: "INV-800", sourceJobId: null, leadId: LEAD,
      title: "Old", status, total: money(100_000), depositPaid: money(0),
      amountPaid: money(0), payments: [], lines: [], termsDays: 7,
      sentAt: null, dueAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"), updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error(r.error.message);
    repo.store.set(INV, r.value);
  };

  describe("PatchInvoiceLinesUseCase", () => {
    let clock: FixedClock;
    let repo: FakeInvoiceRepository;
    let bus: InMemoryEventBus;
    let useCase: PatchInvoiceLinesUseCase;

    beforeEach(() => {
      clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
      repo = new FakeInvoiceRepository();
      bus = new InMemoryEventBus();
      useCase = new PatchInvoiceLinesUseCase(repo, bus, clock, seqIds());
    });

    it("returns not_found when the invoice does not exist", async () => {
      const cmd: PatchInvoiceLinesCommand = { invoiceId: MISSING, lines: [] };
      const res = await useCase.exec(cmd);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("not_found");
      expect(repo.saveCallCount).toBe(0);
    });

    it("replaces lines and recomputes the total on a draft", async () => {
      seed(repo);
      const cmd: PatchInvoiceLinesCommand = {
        invoiceId: INV,
        lines: [
          { description: "Labor", quantity: 2, rateCents: 20_000, costCents: 0 },
          { description: "Parts", quantity: 1, rateCents: 5_000, costCents: 0 },
        ],
      };
      const res = await useCase.exec(cmd);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.props.lines).toHaveLength(2);
        expect(res.value.props.total).toBe(45_000);
        expect(res.value.props.lines[0]?.props.position).toBe(0);
        expect(res.value.props.lines[1]?.props.position).toBe(1);
      }
      expect(repo.saveCallCount).toBe(1);
    });

    it("recomputes the total for a SENT invoice", async () => {
      seed(repo, "sent");
      const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "X", quantity: 1, rateCents: 30_000, costCents: 0 }] });
      expect(isOk(res)).toBe(true);
      if (isOk(res)) expect(res.value.props.total).toBe(30_000);
    });

    it("returns the InvoiceLine.create error for an empty description (no save)", async () => {
      seed(repo);
      const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "  ", quantity: 1, rateCents: 500, costCents: 0 }] });
      expect(res.ok).toBe(false);
      if (!res.ok && res.error.kind === "validation") expect(res.error.field).toBe("description");
      expect(repo.saveCallCount).toBe(0);
    });

    it("rejects patching lines on a paid invoice", async () => {
      seed(repo, "paid");
      const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "X", quantity: 1, rateCents: 100, costCents: 0 }] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("validation");
      expect(repo.saveCallCount).toBe(0);
    });
  });
  ```

- Step: run it, expected FAIL.
  `npx vitest run modules/invoicing/app/patch-invoice-lines.test.ts`
  Expected: `Cannot find module './patch-invoice-lines'`.

- Step: minimal implementation. Create
  `modules/invoicing/app/patch-invoice-lines.ts`:
  ```ts
  import type { InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
  import { money, notFound, ok, err, isOk } from "@mallet/shared/types";
  import type { EventBus, IdGenerator } from "@mallet/shared/ports";
  import type { Invoice } from "../domain/invoice";
  import { InvoiceLine } from "../domain/invoice-line";
  import type { InvoiceRepository } from "../domain/invoice-repository";
  import type { InvoiceLineInput } from "./draft-invoice";

  export interface PatchInvoiceLinesCommand {
    readonly invoiceId: InvoiceId;
    readonly lines: readonly InvoiceLineInput[];
  }

  // Replace an open invoice's display lines with the full supplied set and recompute the total.
  // Lines get fresh server ids + sequential positions; save()'s diffLines soft-deletes dropped rows.
  export class PatchInvoiceLinesUseCase {
    constructor(
      private readonly repo: InvoiceRepository,
      private readonly bus: EventBus,
      private readonly clock: Clock,
      private readonly ids: IdGenerator,
    ) {}

    async exec(cmd: PatchInvoiceLinesCommand): Promise<Result<Invoice, AppError>> {
      const invoice = await this.repo.findById(cmd.invoiceId);
      if (!invoice) return err(notFound("invoice"));

      const built: InvoiceLine[] = [];
      for (let i = 0; i < cmd.lines.length; i += 1) {
        const input = cmd.lines[i];
        if (!input) continue;
        const line = InvoiceLine.create({
          id: this.ids.newId(),
          sourceJobLineId: null,
          description: input.description,
          quantity: input.quantity,
          rate: money(input.rateCents),
          cost: money(input.costCents),
          position: i,
        });
        if (!isOk(line)) return line;
        built.push(line.value);
      }

      const now = this.clock.now();
      const patched = invoice.editLines(built, now);
      if (!isOk(patched)) return patched;

      await this.repo.save(patched.value);
      await this.bus.emit({
        name: "invoice.updated",
        orgId: patched.value.props.orgId,
        payload: { invoiceId: patched.value.props.id, leadId: patched.value.props.leadId },
        occurredAt: now,
      });
      return ok(patched.value);
    }
  }
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/app/patch-invoice-lines.test.ts`
  Expected: all 5 tests pass.

- Step: commit.
  `git add modules/invoicing/app/patch-invoice-lines.ts modules/invoicing/app/patch-invoice-lines.test.ts && git commit -m "feat: add PatchInvoiceLinesUseCase recomputing total"`

---

### Task 5: Module export — surface the two use-cases

**Files:**
- Modify `modules/invoicing/index.ts` (add two exports after L22
  `export { ListInvoicesUseCase } ...`)

**Interfaces:**
- Consumes: `UpdateInvoiceMetadataUseCase` (Task 3),
  `PatchInvoiceLinesUseCase` (Task 4).
- Produces: both use-cases re-exported from the module's public seam (the only
  sanctioned import path per the architecture rule), so the router can import
  them and future tests can too.

- Step: write the failing test. Add a compile-guard assertion to the existing
  `modules/invoicing/app/invoicing-use-cases.test.ts` (append at the end):
  ```ts
  import * as invoicing from "..";
  describe("module public surface (Phase 7)", () => {
    it("re-exports the invoice-edit use-cases", () => {
      expect(typeof invoicing.UpdateInvoiceMetadataUseCase).toBe("function");
      expect(typeof invoicing.PatchInvoiceLinesUseCase).toBe("function");
    });
  });
  ```

- Step: run it, expected FAIL.
  `npx vitest run modules/invoicing/app/invoicing-use-cases.test.ts`
  Expected: `invoicing.UpdateInvoiceMetadataUseCase` is `undefined` →
  `expected 'undefined' to be 'function'`.

- Step: minimal implementation. In `modules/invoicing/index.ts`, after the
  `ListInvoicesUseCase` export:
  ```ts
  export { UpdateInvoiceMetadataUseCase } from "./app/update-invoice-metadata";
  export { PatchInvoiceLinesUseCase } from "./app/patch-invoice-lines";
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/app/invoicing-use-cases.test.ts`
  Expected: the new "module public surface (Phase 7)" test passes; all existing
  tests in the file stay green.

- Step: commit.
  `git add modules/invoicing/index.ts modules/invoicing/app/invoicing-use-cases.test.ts && git commit -m "chore: export invoice-edit use-cases from invoicing module"`

---

### Task 6: API — `v1.invoicing.updateMetadata` + `patchLines` (+ integration test)

**Files:**
- Modify `modules/invoicing/api/invoice-router.ts` (add two input schemas near
  L83 `idInput`, and two procedures after `void` at L236, before
  `createPayment`)
- Test `modules/invoicing/api/invoice-router.int.test.ts` (append tests to the
  live-RLS suite)

**Interfaces:**
- Consumes: `ownerOrOffice`, `orThrow`, `asInvoiceId`, `asLeadId`, `money` (all
  already imported at the top of the router); `DrizzleInvoiceRepository`,
  `ctx.deps.bus`/`clock`/`ids`; `UpdateInvoiceMetadataUseCase`,
  `PatchInvoiceLinesUseCase` (Task 5); `invoiceDTO`/`toInvoiceDTO` (existing in
  this file); `lineInput` (existing, L71).
- Produces:
  ```
  v1.invoicing.updateMetadata({ invoiceId, leadId?, title?, termsDays?, depositPaidCents? }) → invoiceDTO
  v1.invoicing.patchLines({ invoiceId, lines: lineInput[] }) → invoiceDTO
  ```
  Both `ownerOrOffice`, both returning the full `invoiceDTO` so the store
  reconcile path can adopt the recomputed total/lines. `patchLines` allows an
  empty array (clear all lines) — it does NOT reuse `draftInput`'s `.min(1)`.

- Step: write the failing test. Append to the `suite(...)` in
  `modules/invoicing/api/invoice-router.int.test.ts`:
  ```ts
  it("updateMetadata persists terms/title/deposit on a draft invoice", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId,
      title: "Editable",
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });

    const updated = await caller.v1.invoicing.updateMetadata({
      invoiceId: draft.id,
      title: "Renamed",
      termsDays: 30,
      depositPaidCents: 25_000,
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.termsDays).toBe(30);
    expect(updated.depositPaid.cents).toBe(25_000);
    // due = total(100000) - deposit(25000) - paid(0)
    expect(updated.due.cents).toBe(75_000);

    // Survives a re-fetch.
    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.termsDays).toBe(30);
    expect(reloaded.depositPaid.cents).toBe(25_000);
  });

  it("updateMetadata edits a SENT invoice too", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "S", lines: [{ description: "L", quantity: 1, rateCents: 50_000 }],
    });
    await caller.v1.invoicing.send({ invoiceId: draft.id });
    const edited = await caller.v1.invoicing.updateMetadata({ invoiceId: draft.id, termsDays: 14 });
    expect(edited.status).toBe("sent");
    expect(edited.termsDays).toBe(14);
  });

  it("patchLines replaces lines and recomputes the total", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "P", lines: [{ description: "Old", quantity: 1, rateCents: 10_000 }],
    });
    const patched = await caller.v1.invoicing.patchLines({
      invoiceId: draft.id,
      lines: [
        { description: "New A", quantity: 2, rateCents: 20_000 },
        { description: "New B", quantity: 1, rateCents: 5_000 },
      ],
    });
    expect(patched.lines).toHaveLength(2);
    expect(patched.total.cents).toBe(45_000);

    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.lines).toHaveLength(2);
    expect(reloaded.total.cents).toBe(45_000);
  });

  it("rejects updateMetadata on a paid invoice (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "Paid", lines: [{ description: "L", quantity: 1, rateCents: 40_000 }],
    });
    await caller.v1.invoicing.send({ invoiceId: draft.id });
    await caller.v1.invoicing.recordPayment({
      invoiceId: draft.id, amountCents: 40_000, method: "cash", idempotencyKey: `edit-${draft.id}`,
    });
    await expect(
      caller.v1.invoicing.updateMetadata({ invoiceId: draft.id, termsDays: 30 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a tech is forbidden from updateMetadata", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      caller.v1.invoicing.updateMetadata({ invoiceId: randomUUID(), termsDays: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a different org cannot edit org A's invoice (not_found under RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await callerA.v1.invoicing.draft({
      leadId: leadAId, title: "Iso", lines: [{ description: "L", quantity: 1, rateCents: 1_000 }],
    });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.invoicing.patchLines({ invoiceId: draft.id, lines: [] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  ```

- Step: run it, expected FAIL (with a live test DB configured;
  `APP_DATABASE_URL` + `DATABASE_URL` set, else the suite is `describe.skip`).
  `npx vitest run modules/invoicing/api/invoice-router.int.test.ts`
  Expected: `caller.v1.invoicing.updateMetadata is not a function` (procedures
  not registered yet).

- Step: minimal implementation. In `modules/invoicing/api/invoice-router.ts`,
  add the imports at the top with the other use-case imports:
  ```ts
  import { UpdateInvoiceMetadataUseCase } from "../app/update-invoice-metadata";
  import { PatchInvoiceLinesUseCase } from "../app/patch-invoice-lines";
  ```
  Add input schemas near `idInput` (after L83):
  ```ts
  const updateMetadataInput = z.object({
    invoiceId: z.string().uuid(),
    leadId: z.string().uuid().optional(),
    title: z.string().max(500).nullable().optional(),
    termsDays: z.number().int().min(0).optional(),
    depositPaidCents: z.number().int().nonnegative().optional(),
  });
  const patchLinesInput = z.object({
    invoiceId: z.string().uuid(),
    // empty array clears all lines — deliberately NOT .min(1) like draftInput.
    lines: z.array(lineInput),
  });
  ```
  Add the two procedures after the `void` procedure (after L236), before
  `createPayment`:
  ```ts
    updateMetadata: ownerOrOffice
      .input(updateMetadataInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateInvoiceMetadataUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTO(
          orThrow(
            await useCase.exec({
              invoiceId: asInvoiceId(input.invoiceId),
              leadId: input.leadId ? asLeadId(input.leadId) : undefined,
              title: input.title,
              termsDays: input.termsDays,
              depositPaidCents: input.depositPaidCents,
            }),
          ),
        );
      }),

    patchLines: ownerOrOffice
      .input(patchLinesInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new PatchInvoiceLinesUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toInvoiceDTO(
          orThrow(
            await useCase.exec({
              invoiceId: asInvoiceId(input.invoiceId),
              lines: input.lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                rateCents: l.rateCents,
                costCents: l.costCents ?? 0,
              })),
            }),
          ),
        );
      }),
  ```

- Step: run it, expected PASS.
  `npx vitest run modules/invoicing/api/invoice-router.int.test.ts`
  Expected: all new tests pass under live RLS (or `describe.skip` when no DB —
  in which case CI's DB-backed job runs them). The existing money-loop tests
  stay green.

- Step: commit.
  `git add modules/invoicing/api/invoice-router.ts modules/invoicing/api/invoice-router.int.test.ts && git commit -m "feat: add v1.invoicing.updateMetadata and patchLines"`

---

### Task 7: Store — persist `updateInvoice` (metadata) + `setInvoiceLines`

**Files:**
- Modify `lib/store/slices/invoices-slice.ts` — the header docblock (L1–29,
  update the DEFERRED section), `updateInvoice` (L126–136), `setInvoiceLines`
  (L138–149), and add a pure payload helper.
- Test `lib/store/slices/invoices-slice.test.ts` (create — no test exists today)

**Interfaces:**
- Consumes: `trpcVanilla.v1.invoicing.updateMetadata`/`patchLines` (Task 6);
  `dtoInvoiceToStore` (`lib/store/dto-mapper.ts`); store `Invoice`/`InvoiceLine`
  types.
- Produces:
  ```ts
  // pure helper (exported for unit test, mirrors buildLeadUpdatePayload)
  export function buildInvoiceMetadataPayload(
    id: string,
    patch: Partial<Invoice>,
  ): { invoiceId: string; leadId?: string; title?: string | null; termsDays?: number; depositPaidCents?: number } | null
  ```
  Returns `null` when the patch touches only client-local fields
  (`cust`/`phone`/`email`/`fu`/`archived`/`pricing`/`age`/`payments`/`status`)
  — those stay store-local exactly as the leads slice skips local-only patches.
  `updateInvoice` persists a metadata patch on `origin === "db"` invoices;
  `setInvoiceLines` persists lines (dollars → cents) on `origin === "db"`.

- Step: write the failing test. Create
  `lib/store/slices/invoices-slice.test.ts` (mirror `leads-slice.test.ts`):
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";

  const updateMetadataMutate = vi.fn();
  const patchLinesMutate = vi.fn();

  vi.mock("@/lib/trpc/vanilla", () => ({
    trpcVanilla: {
      v1: {
        invoicing: {
          updateMetadata: { mutate: (...a: unknown[]) => updateMetadataMutate(...a) },
          patchLines: { mutate: (...a: unknown[]) => patchLinesMutate(...a) },
          createFromJob: { mutate: vi.fn() },
          draft: { mutate: vi.fn() },
          send: { mutate: vi.fn() },
          recordPayment: { mutate: vi.fn() },
          void: { mutate: vi.fn() },
        },
      },
    },
  }));

  import { buildInvoiceMetadataPayload, createInvoicesSlice, type InvoicesSlice } from "./invoices-slice";
  import type { Invoice, InvoiceLine } from "@/lib/store/types";

  function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
    return {
      id: "inv-1", num: "INV-800", jobId: null, leadId: "lead-1",
      cust: "Ada", phone: "+15550001234", title: "Deck", email: "ada@x.com",
      termsDays: 7, lines: [{ d: "Labor", q: 1, r: 1000 }], total: 1000,
      depPaid: 0, payments: [], status: "draft", age: 0, archived: false,
      origin: "db", ...overrides,
    };
  }

  function makeSlice(): { readonly state: InvoicesSlice; seed: (i: Invoice[]) => void } {
    let state: InvoicesSlice = {} as InvoicesSlice;
    const set = (u: ((s: InvoicesSlice) => Partial<InvoicesSlice>) | Partial<InvoicesSlice>) => {
      state = typeof u === "function" ? { ...state, ...u(state) } : { ...state, ...u };
    };
    state = createInvoicesSlice(set, () => state, {} as never);
    return { get state() { return state; }, seed(i) { state = { ...state, invoices: i }; } };
  }

  const dbDto = (over: Record<string, unknown> = {}) => ({
    id: "inv-1", num: "INV-800", sourceJobId: null, leadId: "lead-1", title: "Deck",
    status: "draft", total: { cents: 100_000, currency: "USD" },
    depositPaid: { cents: 0, currency: "USD" }, amountPaid: { cents: 0, currency: "USD" },
    due: { cents: 100_000, currency: "USD" }, termsDays: 7, lines: [], payments: [],
    sentAt: null, dueAt: null, createdAt: new Date().toISOString(), ...over,
  });

  describe("buildInvoiceMetadataPayload", () => {
    it("maps termsDays and title", () => {
      const p = buildInvoiceMetadataPayload("inv-1", { termsDays: 30, title: "Renamed" });
      expect(p).not.toBeNull();
      expect(p?.invoiceId).toBe("inv-1");
      expect(p?.termsDays).toBe(30);
      expect(p?.title).toBe("Renamed");
    });

    it("maps depPaid dollars → depositPaidCents", () => {
      const p = buildInvoiceMetadataPayload("inv-1", { depPaid: 250 });
      expect(p?.depositPaidCents).toBe(25_000);
    });

    it("maps a leadId change", () => {
      const p = buildInvoiceMetadataPayload("inv-1", { leadId: "lead-2" });
      expect(p?.leadId).toBe("lead-2");
    });

    it("returns null for a client-local-only patch (cust/phone/fu/archived)", () => {
      expect(buildInvoiceMetadataPayload("inv-1", { cust: "Bob" })).toBeNull();
      expect(buildInvoiceMetadataPayload("inv-1", { phone: "+199" })).toBeNull();
      expect(buildInvoiceMetadataPayload("inv-1", { fu: { on: true, stage: 1 } })).toBeNull();
      expect(buildInvoiceMetadataPayload("inv-1", { archived: true })).toBeNull();
    });

    it("mixed patch keeps only persistable fields", () => {
      const p = buildInvoiceMetadataPayload("inv-1", { termsDays: 14, cust: "ignored" });
      expect(p).not.toBeNull();
      expect(p?.termsDays).toBe(14);
      expect((p as unknown as Record<string, unknown>).cust).toBeUndefined();
    });
  });

  describe("updateInvoice persistence", () => {
    beforeEach(() => { updateMetadataMutate.mockReset(); updateMetadataMutate.mockResolvedValue(dbDto()); });

    it("calls updateMetadata for a persistable patch on a db invoice", () => {
      const s = makeSlice(); s.seed([makeInvoice()]);
      s.state.updateInvoice("inv-1", { termsDays: 30 });
      expect(updateMetadataMutate).toHaveBeenCalledOnce();
      const call = updateMetadataMutate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.invoiceId).toBe("inv-1");
      expect(call.termsDays).toBe(30);
    });

    it("applies the optimistic patch immediately", () => {
      const s = makeSlice(); s.seed([makeInvoice()]);
      s.state.updateInvoice("inv-1", { termsDays: 30 });
      expect(s.state.invoices[0]?.termsDays).toBe(30);
    });

    it("does NOT call updateMetadata for a local-only patch", () => {
      const s = makeSlice(); s.seed([makeInvoice()]);
      s.state.updateInvoice("inv-1", { cust: "Bob" });
      expect(updateMetadataMutate).not.toHaveBeenCalled();
      expect(s.state.invoices[0]?.cust).toBe("Bob");
    });

    it("does NOT call updateMetadata for a manual invoice", () => {
      const s = makeSlice(); s.seed([makeInvoice({ origin: "manual" })]);
      s.state.updateInvoice("inv-1", { termsDays: 30 });
      expect(updateMetadataMutate).not.toHaveBeenCalled();
    });

    it("rolls back on mutation error", async () => {
      updateMetadataMutate.mockRejectedValue(new Error("boom"));
      const s = makeSlice(); s.seed([makeInvoice({ termsDays: 7 })]);
      s.state.updateInvoice("inv-1", { termsDays: 30 });
      expect(s.state.invoices[0]?.termsDays).toBe(30);
      await Promise.resolve(); await Promise.resolve();
      expect(s.state.invoices[0]?.termsDays).toBe(7);
    });
  });

  describe("setInvoiceLines persistence", () => {
    beforeEach(() => { patchLinesMutate.mockReset(); patchLinesMutate.mockResolvedValue(dbDto({ total: { cents: 45_000, currency: "USD" } })); });

    it("recomputes the total optimistically and calls patchLines (dollars → cents)", () => {
      const s = makeSlice(); s.seed([makeInvoice()]);
      const lines: InvoiceLine[] = [{ d: "A", q: 2, r: 200 }, { d: "B", q: 1, r: 50 }];
      s.state.setInvoiceLines("inv-1", lines);
      expect(s.state.invoices[0]?.total).toBe(450); // 2*200 + 1*50
      expect(patchLinesMutate).toHaveBeenCalledOnce();
      const call = patchLinesMutate.mock.calls[0]?.[0] as { invoiceId: string; lines: Array<Record<string, number>> };
      expect(call.invoiceId).toBe("inv-1");
      expect(call.lines[0]?.rateCents).toBe(20_000); // 200 dollars → cents
      expect(call.lines[0]?.quantity).toBe(2);
    });

    it("does NOT call patchLines for a manual invoice", () => {
      const s = makeSlice(); s.seed([makeInvoice({ origin: "manual" })]);
      s.state.setInvoiceLines("inv-1", [{ d: "A", q: 1, r: 100 }]);
      expect(patchLinesMutate).not.toHaveBeenCalled();
    });

    it("rolls back the lines on error", async () => {
      patchLinesMutate.mockRejectedValue(new Error("boom"));
      const s = makeSlice(); s.seed([makeInvoice()]);
      s.state.setInvoiceLines("inv-1", [{ d: "A", q: 5, r: 100 }]);
      expect(s.state.invoices[0]?.total).toBe(500);
      await Promise.resolve(); await Promise.resolve();
      expect(s.state.invoices[0]?.total).toBe(1000); // reverted to seed total
    });
  });
  ```

- Step: run it, expected FAIL.
  `npx vitest run lib/store/slices/invoices-slice.test.ts`
  Expected: `buildInvoiceMetadataPayload is not a function` and the persistence
  assertions fail (actions are still no-ops that never call the mutation).

- Step: minimal implementation. Edit `lib/store/slices/invoices-slice.ts`.
  First add the pure helper above the slice (after the `linesTotal` helper,
  ~L42). It uses an allowlist of DB-persistable keys, mirroring
  `buildLeadUpdatePayload`:
  ```ts
  // Only these Invoice fields have DB columns on the invoices header. Everything else
  // (cust/phone/email/fu/archived/pricing/age/payments/status) is client-local — a patch
  // touching only those must NOT hit the network (mirrors buildLeadUpdatePayload).
  export interface InvoiceMetadataPayload {
    invoiceId: string;
    leadId?: string;
    title?: string | null;
    termsDays?: number;
    depositPaidCents?: number;
  }

  export function buildInvoiceMetadataPayload(
    id: string,
    patch: Partial<Invoice>,
  ): InvoiceMetadataPayload | null {
    const payload: InvoiceMetadataPayload = { invoiceId: id };
    let persistable = false;
    if ("leadId" in patch && patch.leadId != null && patch.leadId !== "") {
      payload.leadId = patch.leadId;
      persistable = true;
    }
    if ("title" in patch) {
      payload.title = patch.title ?? null;
      persistable = true;
    }
    if ("termsDays" in patch && patch.termsDays != null) {
      payload.termsDays = patch.termsDays;
      persistable = true;
    }
    if ("depPaid" in patch && patch.depPaid != null) {
      payload.depositPaidCents = Math.round(patch.depPaid * 100); // dollars → cents
      persistable = true;
    }
    return persistable ? payload : null;
  }
  ```
  Replace `updateInvoice` (L134–136) with the optimistic-persist form:
  ```ts
  updateInvoice: (id, patch) => {
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic local update (all fields — client-local included).
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

    const inv = get().invoices.find((i) => i.id === id);
    // 2. Persist only DB-origin invoices with a DB-backed field in the patch.
    if (!inv || inv.origin !== "db") return;
    const payload = buildInvoiceMetadataPayload(id, patch);
    if (!payload) return; // client-local-only patch — no network call

    trpcVanilla.v1.invoicing.updateMetadata
      .mutate(payload)
      .then((dto) => {
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[invoices-slice] updateInvoice failed — rolled back", { id, err });
        }
      });
  },
  ```
  Replace `setInvoiceLines` (L143–149) with:
  ```ts
  setInvoiceLines: (id, lines) => {
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic update — recompute the total from lines (prototype invSetLine behaviour).
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, lines, total: linesTotal(lines) } : i,
      ),
    }));

    const inv = get().invoices.find((i) => i.id === id);
    // 2. Persist only DB-origin invoices; manual drafts snapshot at sendInvoice.
    if (!inv || inv.origin !== "db") return;

    trpcVanilla.v1.invoicing.patchLines
      .mutate({
        invoiceId: id,
        lines: lines.map((l) => ({
          description: l.d,
          quantity: l.q ?? 1,
          rateCents: Math.round((l.r ?? 0) * 100), // dollars → cents
          costCents: Math.round((l.c ?? 0) * 100), // dollars → cents; 0 when absent
        })),
      })
      .then((dto) => {
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[invoices-slice] setInvoiceLines failed — rolled back", { id, err });
        }
      });
  },
  ```
  Update the header docblock (L18–29): remove `updateInvoice` and
  `setInvoiceLines` from the DEFERRED list and add them to WIRED:
  ```
   *   updateInvoice   → v1.invoicing.updateMetadata (db invoices; DB-backed fields only)
   *   setInvoiceLines → v1.invoicing.patchLines     (db invoices; recomputes total)
  ```
  and delete the "snapshot only at send" / "no patch-lines endpoint" /
  "no generic update-metadata endpoint" comment lines (L126–135, L138–144).

- Step: run it, expected PASS.
  `npx vitest run lib/store/slices/invoices-slice.test.ts`
  Expected: all `buildInvoiceMetadataPayload`, `updateInvoice persistence`, and
  `setInvoiceLines persistence` tests pass.

- Step: commit.
  `git add lib/store/slices/invoices-slice.ts lib/store/slices/invoices-slice.test.ts && git commit -m "feat: persist invoice metadata + line edits via updateMetadata/patchLines"`

---

### Task 8: Verify the full gate + open the PR

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: a green gate + an open PR for Phase 7.

- Step: typecheck.
  `npx tsc --noEmit`
  Expected: exits 0, no errors. (Watch for: the router imports, the new
  use-case imports, and the store helper's `Partial<Invoice>` key narrowing.)

- Step: lint, 0 errors.
  `npm run lint`
  Expected: `0 errors` (the `eslint-disable-next-line no-console` on each dev-log
  keeps the existing pattern clean).

- Step: full unit + integration run.
  `npx vitest run`
  Expected: all suites pass. The invoicing int test's new cases run under live
  RLS when `APP_DATABASE_URL` + `DATABASE_URL` are set; otherwise that suite is
  `describe.skip` and CI's DB-backed job covers it.

- Step: coverage gate 80/75.
  `npx vitest run --coverage`
  Expected: statements/lines ≥ 80, branches ≥ 75. The new domain methods,
  use-cases (happy + not-found + validation + cross-tenant), and the slice
  helper are all directly tested, so coverage holds.

- Step: build.
  `npm run build`
  Expected: build succeeds (Next.js 16 compile + type check clean).

- Step: open the PR.
  ```
  git push -u origin HEAD
  gh pr create --title "Phase 7: persist invoice metadata + line edits" \
    --body "$(cat <<'EOF'
  ## Summary
  - Add `Invoice.editMetadata` / `Invoice.editLines` domain methods (edit draft AND sent invoices; editLines recomputes the total; both frozen once paid/void).
  - Add `UpdateInvoiceMetadataUseCase` + `PatchInvoiceLinesUseCase` and re-export them from the invoicing module seam.
  - Add tRPC `v1.invoicing.updateMetadata` + `v1.invoicing.patchLines` (`ownerOrOffice`, full `invoiceDTO` output).
  - Switch store `updateInvoice` / `setInvoiceLines` from `TODO(persist)` no-ops to optimistic → mutate → reconcile/rollback; remove the "snapshot only at send" comments.
  - No migration: reuses existing `invoices` + `invoice_lines`. cust/phone/email stay client-local (preserved on reconcile).

  ## Test plan
  - [x] Domain unit: editMetadata/editLines (draft, sent, keep-undefined, clear-to-null, paid/void reject, invariants).
  - [x] App unit: both use-cases (happy, not_found, validation, no-save-on-error).
  - [x] Integration (live RLS): updateMetadata + patchLines persist + survive re-fetch; sent edit; paid reject (BAD_REQUEST); tech FORBIDDEN; cross-org NOT_FOUND.
  - [x] Store unit: payload mapping, optimistic apply, dollars→cents, local-only skip, manual-origin skip, rollback.
  - [x] `tsc --noEmit` · `npm run lint` (0 errors) · `npx vitest run` · coverage 80/75 · `npm run build`.
  EOF
  )"
  ```
  Expected: PR created against the default branch.
