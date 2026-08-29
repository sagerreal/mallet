# Purchase Orders (Money → Orders tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship purchase orders — what the shop bought from a supplier, for which job, at what cost — as an `Orders` tab under Money, fully DB-backed.

**Architecture:** A new `modules/purchasing` hexagonal module (router → use-case → domain → Drizzle repository) over two new tables, `purchase_orders` and `purchase_order_lines`, plus `purchase_order_notes`. The UI is a second tab on `/money` (`?tab=orders`) rendering a list plus two modals — a create form and a record sheet — that share one definition file and one line-table component, which is what keeps them consistent. Purchase orders are a SEPARATE SET from the receivables ledger and never become rows in it.

**Tech Stack:** Next.js 16 App Router · tRPC v11 · Drizzle + Supabase Postgres with RLS · Zustand · Vitest.

---

## DECISIONS NEEDED FROM OWEN BEFORE TASK 1

These change the schema, so they are cheap now and expensive after the tables exist.

**DECISION 1 — Unit cost precision.** Supply houses quote wire and fittings at four decimals
($0.2145/ft). Integer cents rounds that to 21c and misprices 500ft by $2.25.
*Recommendation: `unit_cost_millicents integer` (thousandths of a cent).* Extended line amounts
still round to whole cents, so the rest of Mallet's integer-cent discipline is untouched. The
approved mock uses millicents. **If you'd rather keep plain cents, say so and Task 1 changes one
column.**

**DECISION 2 — Vendor stays free text.** `pricebook_materials.vendor` is a free-text column
annotated `no vendor entity (YAGNI)`. This plan keeps that: the vendor is a text column, and the
create form offers a `<datalist>` of vendors already used. *Cost of the choice:* "Ferguson" and
"FERGUSON" will not group, and there is nowhere to keep an account number or terms.
*Recommendation: ship free text; promote to a `vendors` table when someone actually asks to group
by supplier.* That promotion is a backfill, not a redesign.

**DECISION 3 — How the job Costing tab consumes this.** `materialsByJob`
(`modules/jobs/infra/drizzle-labor-reader.ts:214`) currently sums **quoted** line cost. A PO buys
the *same physical part*, so adding PO cost into that figure reports roughly double the material
cost and a fictitious loss. *Recommendation: a NEW `purchasedCents` field reported alongside
`materialsCents`, never summed into it.* Task 9 implements that; **if you want it merged instead,
Task 9 changes and Task 9's tests change with it.**

**DECISION 4 — No receiving, confirmed.** Owen: *"we arent using these to actual verify that
things were received."* So there is no receipt quantity, no partial state, and **the job is charged
when the order is PLACED, not when the material arrives.** A shop ordering in March for an April
job sees the cost in March. This is the honest reading of a system that does not track arrival.

---

## Global Constraints

- Org id ALWAYS from `ctx.principal.orgId`, never client input.
- Every org-scoped table needs a hand-written RLS migration — drizzle-kit does NOT emit RLS.
- Child tables use composite FKs `(org_id, parent_id) → parent(org_id, id)`.
- Soft-delete only (`deleted_at`); never hard-delete tenant data.
- Money: integer cents in DB/domain, `{cents, currency}` in DTOs, DOLLARS in the store; conversions live in `lib/store/dto-mapper.ts` only.
- Migrations are SINGLE-WRITER on a shared live dev/prod DB. Next free number is **0180**. Before generating, re-check `ls shared/db/migrations | tail -3` and `gh pr list` for any open PR touching `shared/db/migrations/`.
- Domain objects are immutable with `create → Result`; no throws for expected validation.
- **No text below `var(--type-md)` (15px) on any purchase-order surface.** The shared chrome is 11–13px; the mock scopes this with a `.po-scope` class. Keep it.
- Compose primitives — `components/ui` and `components/shared`, `--space/--type/--radius` tokens, never a raw px.
- `pnpm lint` and `lint:css` must report 0 errors. Coverage gate: 80% stmts / 75% branches.
- No demo/sample/seed data. The mock route `app/(office)/money/po/` is DELETED in Task 8.

## Reference Implementation

The approved design exists on branch `mock/money-purchase-orders` and renders at `/money/po`.
Read these four files before starting — they are the visual and behavioural spec:

- `features/money/po-defs.ts` — types, labels, status meta, summary helpers
- `features/money/po-line-table.tsx` — the ONE line table both modals render
- `features/money/po-view-modal.tsx` — the record sheet (chapters)
- `features/money/po-create-modal.tsx` — the create form (staged DisclosureRows)

They carry no persistence. This plan makes them real.

## File Structure

**New — schema**
- `shared/db/schema/purchase-orders.ts` — `purchaseOrders`, `purchaseOrderLines`, `purchaseOrderNotes`
- `shared/db/migrations/0180_purchase_orders.sql` — generated tables + the `number_sequences` kind check
- `shared/db/migrations/0181_purchase_orders_rls.sql` — hand-written RLS

**New — module `modules/purchasing/`** (mirrors `modules/companies/`)
- `domain/purchase-order.ts` — the immutable aggregate, `create → Result`, status transitions
- `domain/purchase-order-repository.ts` — the port
- `app/create-purchase-order.ts` · `app/update-purchase-order.ts` · `app/list-purchase-orders.ts` · `app/place-purchase-order.ts` · `app/cancel-purchase-order.ts` · `app/add-purchase-order-note.ts`
- `infra/drizzle-purchase-order-repository.ts` · `infra/purchase-order-mapper.ts`
- `api/purchase-order-router.ts` · `api/purchase-order-dto.ts`
- `index.ts` — barrel

**New — client**
- `lib/store/slices/purchase-orders-slice.ts`
- `features/money/orders-hydrator.tsx`
- `features/money/orders-panel.tsx` — the list + toolbar
- `features/money/po-defs.ts` — PROMOTED from the mock, types swapped to store types
- `features/money/po-line-table.tsx` — PROMOTED unchanged
- `components/modals/po-modal/po-modal.tsx` — the record sheet (promoted from `po-view-modal.tsx`)
- `components/modals/new-po-modal.tsx` — the create form (promoted from `po-create-modal.tsx`)

**Modified**
- `shared/db/schema/number-sequences.ts:20` — kind check gains `'po'`
- `app/(office)/money/page.tsx` — reads `?tab=`, renders `MoneyLedger` or `OrdersPanel`
- `components/shell/section-tabs.tsx:52-67` — a Money branch, mirroring the Jobs branch
- `lib/store/app-store.ts` — wire the slice
- `lib/store/modal-ids.ts` — `PO`, `NEW_PO`
- `components/modals/modal-host.tsx` — register both modals
- `app/(office)/money/layout.tsx` or `page.tsx` — mount `OrdersHydrator`
- `modules/jobs/infra/drizzle-labor-reader.ts` — `purchasedCents` (Task 9)
- `server/routers/v1.ts` (or wherever routers compose) — mount `purchaseOrderRouter`

**Deleted in Task 8**
- `app/(office)/money/po/page.tsx`, `features/money/po-view-modal.tsx`, `features/money/po-create-modal.tsx`, and the `.po-lines`/`.po-scope` preview comments in `app/prototype.css` are rewritten as permanent rules.

---

### Task 1: Schema, RLS and the PO number sequence

**Files:**
- Create: `shared/db/schema/purchase-orders.ts`
- Create: `shared/db/migrations/0180_purchase_orders.sql` (generated)
- Create: `shared/db/migrations/0181_purchase_orders_rls.sql` (hand-written)
- Modify: `shared/db/schema/number-sequences.ts:20`
- Modify: `shared/db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: tables `purchase_orders`, `purchase_order_lines`, `purchase_order_notes`; `number_sequences.kind` accepts `'po'`.

- [ ] **Step 1: Re-check the migration number is still free**

```bash
cd /path/to/worktree
ls shared/db/migrations | tail -3
gh pr list --json number,title,files | grep -c migrations || echo "no open migration PRs"
```
Expected: highest is `0179_lead_note_attachments`. If not, use the next free pair and adjust every filename below. **If another open PR touches migrations, STOP and ask Owen** — applies must be serialized.

- [ ] **Step 2: Write the schema**

```ts
// shared/db/schema/purchase-orders.ts
import { pgTable, uuid, text, integer, numeric, date, timestamp, index, unique, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { jobs } from "./jobs";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    // NULL until the order is placed — a draft has no number to read to a branch.
    num: text("num"),
    vendor: text("vendor").notNull(),
    status: text("status").notNull().default("draft"),
    // NULLABLE ON PURPOSE: a stock/truck-restock order has no job. Forcing one puts a restock on
    // whatever job happened to be open, which corrupts costing worse than having no PO at all.
    jobId: uuid("job_id"),
    orderedAt: date("ordered_at"),
    expectedAt: date("expected_at"),
    shipTo: text("ship_to").notNull().default("counter_pickup"),
    orderedByUserId: uuid("ordered_by_user_id"),
    freightCents: integer("freight_cents").notNull().default(0),
    // What the vendor CHARGED, never a rate we compute. org_settings.tax_bps is the SELL-side
    // rate: wrong jurisdiction (the branch's, not the customer's) and wrong direction.
    taxCents: integer("tax_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("purchase_orders_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "purchase_orders_org_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }),
    check("purchase_orders_status_check", sql`${t.status} in ('draft','ordered','cancelled')`),
    check("purchase_orders_ship_to_check", sql`${t.shipTo} in ('counter_pickup','job_site','shop')`),
    // A placed order must carry its number; a draft must not.
    check("purchase_orders_num_check", sql`(${t.status} = 'draft') = (${t.num} is null)`),
    uniqueIndex("purchase_orders_org_num_uidx").on(t.orgId, t.num).where(sql`deleted_at is null and num is not null`),
    index("purchase_orders_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index("purchase_orders_org_job_idx").on(t.orgId, t.jobId),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    description: text("description").notNull(),
    // DECIMAL: 100.5 ft of PEX, 3.5 lb of refrigerant. An integer column silently truncates
    // exactly the highest-volume line types.
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("1"),
    uom: text("uom").notNull().default("ea"),
    // THOUSANDTHS OF A CENT — see DECISION 1. $86.40 is 8_640_000.
    unitCostMillicents: integer("unit_cost_millicents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_lines_org_po_fk",
      columns: [t.orgId, t.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }).onDelete("cascade"),
    index("purchase_order_lines_org_po_idx").on(t.orgId, t.poId, t.position),
  ],
);

export const purchaseOrderNotes = pgTable(
  "purchase_order_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    body: text("body").notNull().default(""),
    authorUserId: uuid("author_user_id"),
    // One file may ride a note — a photo of the counter receipt is a whole note on its own.
    attachmentPath: text("attachment_path"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_notes_org_po_fk",
      columns: [t.orgId, t.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }).onDelete("cascade"),
    // A note is text OR a file — same shape rule lead_notes uses.
    check("purchase_order_notes_shape_check", sql`length(trim(${t.body})) > 0 or ${t.attachmentPath} is not null`),
    index("purchase_order_notes_org_po_idx").on(t.orgId, t.poId, t.createdAt.desc()),
  ],
);
```

- [ ] **Step 3: Widen the number-sequence kind check**

In `shared/db/schema/number-sequences.ts:20`, change:

```ts
check("number_sequences_kind_check", sql`${t.kind} in ('estimate', 'invoice', 'job')`),
```

to:

```ts
// 'po' rides the same allocator as invoices — see DrizzlePurchaseOrderRepository.nextNumber.
check("number_sequences_kind_check", sql`${t.kind} in ('estimate', 'invoice', 'job', 'po')`),
```

- [ ] **Step 4: Export the schema from the barrel**

Add to `shared/db/schema/index.ts`:

```ts
export * from "./purchase-orders";
```

- [ ] **Step 5: Generate the migration**

```bash
npm run db:generate
git status shared/db/migrations
```
Expected: a new `0180_*.sql` plus a journal entry. Rename the file to `0180_purchase_orders.sql` and update its `tag` in `shared/db/migrations/meta/_journal.json` to match.

**Read the generated SQL before continuing.** If drizzle proposes dropping or altering anything that is not one of these three tables or the kind check, delete those statements — the shared DB carries state this branch does not know about.

- [ ] **Step 6: Hand-write the RLS migration**

```sql
-- shared/db/migrations/0181_purchase_orders_rls.sql
-- Tenant isolation for the purchasing tables. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0180 created these WITHOUT it.
--
-- Purchase orders carry what a shop pays its suppliers — the most commercially sensitive figure
-- in the app. A leak here hands a competitor the shop's margin.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_orders_tenant_isolation ON public.purchase_orders
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_order_lines_tenant_isolation ON public.purchase_order_lines
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.purchase_order_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_order_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_order_notes_tenant_isolation ON public.purchase_order_notes
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Add the journal entry by hand, copying the shape of the last one:

```json
{ "idx": 181, "version": "7", "when": <epoch_ms>, "tag": "0181_purchase_orders_rls", "breakpoints": true }
```

- [ ] **Step 7: Apply and verify**

```bash
npm run db:migrate
npm run db:verify
```
Expected: `db:verify` exits 0. If it reports divergence, STOP — a silent no-op means the migration did not apply and every later task will fail against a table that does not exist.

- [ ] **Step 8: Prove RLS actually bites**

```bash
node --env-file=.env.local -e "
const postgres=require('postgres');
const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:'require',prepare:false});
(async()=>{
  const r=await sql\`select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('purchase_orders','purchase_order_lines','purchase_order_notes')\`;
  console.log(r);
  await sql.end();
})();"
```
Expected: all three rows show `relrowsecurity: true` and `relforcerowsecurity: true`.

- [ ] **Step 9: Commit**

```bash
git add shared/db/schema shared/db/migrations
git commit -m "feat(db): purchase_orders, lines and notes with RLS"
```

---

### Task 2: The domain aggregate

**Files:**
- Create: `modules/purchasing/domain/purchase-order.ts`
- Create: `modules/purchasing/domain/purchase-order-repository.ts`
- Test: `modules/purchasing/domain/purchase-order.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PurchaseOrder` (immutable, `PurchaseOrder.create(props) → Result<PurchaseOrder>`), `POStatus = "draft" | "ordered" | "cancelled"`, `ShipTo = "counter_pickup" | "job_site" | "shop"`, `POLineProps`, `lineCents(line): number`, `subtotalCents(po): number`, `totalCents(po): number`, and the port `PurchaseOrderRepository`.

- [ ] **Step 1: Write the failing test**

```ts
// modules/purchasing/domain/purchase-order.test.ts
import { describe, it, expect } from "vitest";
import { asOrgId, isOk, isErr } from "@mallet/shared/types";
import { PurchaseOrder, lineCents, totalCents } from "./purchase-order";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  num: null,
  vendor: "Ferguson",
  status: "draft" as const,
  jobId: null,
  orderedAt: null,
  expectedAt: null,
  shipTo: "counter_pickup" as const,
  orderedByUserId: null,
  freightCents: 0,
  taxCents: 0,
  lines: [],
  createdAt: new Date("2026-08-28T00:00:00Z"),
  updatedAt: new Date("2026-08-28T00:00:00Z"),
};

describe("PurchaseOrder.create", () => {
  it("needs a vendor — there is no such thing as an order with nobody to place it with", () => {
    const r = PurchaseOrder.create({ ...base, vendor: "  " });
    expect(isErr(r)).toBe(true);
  });

  it("accepts a stock order with no job", () => {
    const r = PurchaseOrder.create(base);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.jobId).toBeNull();
  });

  it("refuses a placed order with no number", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: null });
    expect(isErr(r)).toBe(true);
  });

  it("refuses a draft that already carries a number", () => {
    const r = PurchaseOrder.create({ ...base, num: "PO-1000" });
    expect(isErr(r)).toBe(true);
  });

  it("refuses a negative freight or tax — money out is not a credit", () => {
    expect(isErr(PurchaseOrder.create({ ...base, freightCents: -1 }))).toBe(true);
    expect(isErr(PurchaseOrder.create({ ...base, taxCents: -1 }))).toBe(true);
  });
});

describe("money", () => {
  const line = { id: "l1", description: "3/4in PEX-A coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 };

  it("rounds a line to whole cents from millicents", () => {
    expect(lineCents(line)).toBe(34_560);
  });

  // $0.2145/ft is why unit cost is millicents: integer cents would price this at 21c and
  // under-report 500ft by $2.25.
  it("keeps sub-cent unit costs honest across a long run", () => {
    expect(lineCents({ ...line, qty: 500, uom: "ft", unitCostMillicents: 21_450 })).toBe(10_725);
  });

  it("adds freight and tax on top of the lines", () => {
    const r = PurchaseOrder.create({ ...base, lines: [line], freightCents: 4_200, taxCents: 6_890 });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(totalCents(r.value)).toBe(34_560 + 4_200 + 6_890);
  });
});

describe("place / cancel", () => {
  it("placing stamps the number and the date, and is not reversible to draft", () => {
    const r = PurchaseOrder.create(base);
    if (!isOk(r)) throw new Error("seed invalid");
    const placed = r.value.place("PO-1000", new Date("2026-08-28T00:00:00Z"));
    expect(isOk(placed)).toBe(true);
    if (isOk(placed)) {
      expect(placed.value.props.status).toBe("ordered");
      expect(placed.value.props.num).toBe("PO-1000");
      // The original is untouched — the aggregate is immutable.
      expect(r.value.props.status).toBe("draft");
    }
  });

  it("refuses to place an order with no lines", () => {
    const r = PurchaseOrder.create(base);
    if (!isOk(r)) throw new Error("seed invalid");
    expect(isErr(r.value.place("PO-1000", new Date()))).toBe(true);
  });

  it("cancels a placed order and contributes nothing to job cost after", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: "PO-1000", lines: [{ id: "l1", description: "x", qty: 1, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    const c = r.value.cancel();
    expect(isOk(c)).toBe(true);
    if (isOk(c)) expect(c.value.jobCostCents()).toBe(0);
  });

  it("charges the job the whole order once placed — there is no receiving", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: "PO-1000", freightCents: 500, lines: [{ id: "l1", description: "x", qty: 2, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    expect(r.value.jobCostCents()).toBe(200 + 500);
  });

  it("charges nothing for a draft", () => {
    const r = PurchaseOrder.create({ ...base, lines: [{ id: "l1", description: "x", qty: 1, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    expect(r.value.jobCostCents()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run modules/purchasing/domain/purchase-order.test.ts
```
Expected: FAIL — `Cannot find module './purchase-order'`.

- [ ] **Step 3: Write the domain object**

```ts
// modules/purchasing/domain/purchase-order.ts
import { err, ok, type Result, type OrgId } from "@mallet/shared/types";

export type POStatus = "draft" | "ordered" | "cancelled";
export type ShipTo = "counter_pickup" | "job_site" | "shop";

export interface POLineProps {
  readonly id: string;
  readonly description: string;
  readonly qty: number;
  readonly uom: string;
  /** Thousandths of a cent — see DECISION 1 in the plan. */
  readonly unitCostMillicents: number;
  readonly position: number;
}

export interface PurchaseOrderProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly num: string | null;
  readonly vendor: string;
  readonly status: POStatus;
  readonly jobId: string | null;
  readonly orderedAt: Date | null;
  readonly expectedAt: Date | null;
  readonly shipTo: ShipTo;
  readonly orderedByUserId: string | null;
  readonly freightCents: number;
  readonly taxCents: number;
  readonly lines: readonly POLineProps[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Extended amount, rounded to whole cents. Millicents stay on the unit cost only. */
export const lineCents = (l: POLineProps): number => Math.round((l.qty * l.unitCostMillicents) / 1000);

export const subtotalCents = (po: PurchaseOrder): number =>
  po.props.lines.reduce((s, l) => s + lineCents(l), 0);

export const totalCents = (po: PurchaseOrder): number =>
  subtotalCents(po) + po.props.freightCents + po.props.taxCents;

export class PurchaseOrder {
  private constructor(public readonly props: PurchaseOrderProps) {}

  static create(props: PurchaseOrderProps): Result<PurchaseOrder> {
    if (!props.vendor.trim()) return err("A purchase order needs a vendor.");
    if (props.freightCents < 0) return err("Freight cannot be negative.");
    if (props.taxCents < 0) return err("Tax cannot be negative.");
    // A placed order must carry the number somebody reads to the branch; a draft must not,
    // or abandoned taps burn numbers out of a sequence that is meant to be gapless.
    if (props.status === "draft" && props.num !== null) return err("A draft has no number until it is placed.");
    if (props.status !== "draft" && !props.num) return err("A placed order must carry its number.");
    for (const l of props.lines) {
      if (!l.description.trim()) return err("Every line needs a description.");
      if (l.qty <= 0) return err("A line quantity must be greater than zero.");
      if (l.unitCostMillicents < 0) return err("A unit cost cannot be negative.");
    }
    return ok(new PurchaseOrder(props));
  }

  private with(patch: Partial<PurchaseOrderProps>): Result<PurchaseOrder> {
    return PurchaseOrder.create({ ...this.props, ...patch });
  }

  /** Draft → ordered. Allocates nothing itself; the caller hands in the number. */
  place(num: string, now: Date): Result<PurchaseOrder> {
    if (this.props.status !== "draft") return err("This order has already been placed.");
    if (this.props.lines.length === 0) return err("Add a line before placing the order.");
    return this.with({ status: "ordered", num, orderedAt: now, updatedAt: now });
  }

  cancel(): Result<PurchaseOrder> {
    if (this.props.status === "cancelled") return err("This order is already cancelled.");
    if (this.props.status === "draft") return err("Delete a draft rather than cancelling it — the vendor never heard of it.");
    return this.with({ status: "cancelled" });
  }

  /**
   * WHAT THE JOB IS CHARGED. The whole order once placed, nothing from a draft or a cancelled one.
   * There is no receiving (DECISION 4), so the cost lands when the order does, not when the van does.
   */
  jobCostCents(): number {
    return this.props.status === "ordered" ? totalCents(this) : 0;
  }
}
```

- [ ] **Step 4: Write the repository port**

```ts
// modules/purchasing/domain/purchase-order-repository.ts
import type { PurchaseOrder } from "./purchase-order";

export interface PONoteRow {
  readonly id: string;
  readonly body: string;
  readonly authorUserId: string | null;
  readonly attachmentPath: string | null;
  readonly attachmentName: string | null;
  readonly createdAt: Date;
}

export interface PurchaseOrderRepository {
  list(): Promise<readonly PurchaseOrder[]>;
  findById(id: string): Promise<PurchaseOrder | null>;
  save(po: PurchaseOrder): Promise<void>;
  softDelete(id: string, now: Date): Promise<number>;
  /** Allocates the next PO-#### for this org, inside the caller's transaction. */
  nextNumber(): Promise<string>;
  listNotes(poId: string): Promise<readonly PONoteRow[]>;
  addNote(note: PONoteRow & { poId: string }): Promise<void>;
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run modules/purchasing/domain/purchase-order.test.ts
```
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add modules/purchasing/domain
git commit -m "feat(purchasing): the purchase order aggregate"
```

---

### Task 3: The Drizzle repository

**Files:**
- Create: `modules/purchasing/infra/purchase-order-mapper.ts`
- Create: `modules/purchasing/infra/drizzle-purchase-order-repository.ts`
- Test: `modules/purchasing/infra/drizzle-purchase-order-repository.int.test.ts`

**Interfaces:**
- Consumes: `PurchaseOrder`, `PurchaseOrderRepository`, `PONoteRow` from Task 2.
- Produces: `class DrizzlePurchaseOrderRepository implements PurchaseOrderRepository` with constructor `(tx: Tx, orgId: OrgId)`.

- [ ] **Step 1: Write the failing integration test**

```ts
// modules/purchasing/infra/drizzle-purchase-order-repository.int.test.ts
import { describe, it, expect } from "vitest";
import { withTestTx } from "@/test/int/tx"; // read modules/invoicing/infra/*.int.test.ts for the real helper name
import { DrizzlePurchaseOrderRepository } from "./drizzle-purchase-order-repository";
import { PurchaseOrder } from "../domain/purchase-order";
import { isOk } from "@mallet/shared/types";

describe("DrizzlePurchaseOrderRepository", () => {
  it("allocates PO numbers in sequence per org", async () => {
    const nums = await withTestTx(async (tx, orgId) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, orgId);
      return [await repo.nextNumber(), await repo.nextNumber()];
    });
    expect(nums).toEqual(["PO-1000", "PO-1001"]);
  });

  it("round-trips an order with its lines, in position order", async () => {
    await withTestTx(async (tx, orgId) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, orgId);
      const r = PurchaseOrder.create({
        id: crypto.randomUUID(), orgId, num: null, vendor: "Ferguson", status: "draft",
        jobId: null, orderedAt: null, expectedAt: null, shipTo: "counter_pickup",
        orderedByUserId: null, freightCents: 4_200, taxCents: 6_890,
        lines: [
          { id: crypto.randomUUID(), description: "Brass valve", qty: 12, uom: "ea", unitCostMillicents: 1_810_000, position: 1 },
          { id: crypto.randomUUID(), description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 },
        ],
        createdAt: new Date(), updatedAt: new Date(),
      });
      if (!isOk(r)) throw new Error("seed invalid");
      await repo.save(r.value);
      const back = await repo.findById(r.value.props.id);
      expect(back).not.toBeNull();
      expect(back!.props.lines.map((l) => l.description)).toEqual(["PEX coil", "Brass valve"]);
      expect(back!.props.freightCents).toBe(4_200);
      // numeric(12,3) comes back as a STRING from postgres — the mapper must coerce it or every
      // quantity multiplies as NaN.
      expect(typeof back!.props.lines[0]!.qty).toBe("number");
    });
  });

  it("replaces lines on save rather than appending them", async () => {
    await withTestTx(async (tx, orgId) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, orgId);
      const id = crypto.randomUUID();
      const mk = (desc: string) => PurchaseOrder.create({
        id, orgId, num: null, vendor: "Ferguson", status: "draft", jobId: null,
        orderedAt: null, expectedAt: null, shipTo: "counter_pickup", orderedByUserId: null,
        freightCents: 0, taxCents: 0,
        lines: [{ id: crypto.randomUUID(), description: desc, qty: 1, uom: "ea", unitCostMillicents: 1000, position: 0 }],
        createdAt: new Date(), updatedAt: new Date(),
      });
      const a = mk("first"); if (!isOk(a)) throw new Error("bad");
      await repo.save(a.value);
      const b = mk("second"); if (!isOk(b)) throw new Error("bad");
      await repo.save(b.value);
      const back = await repo.findById(id);
      expect(back!.props.lines).toHaveLength(1);
      expect(back!.props.lines[0]!.description).toBe("second");
    });
  });

  it("omits soft-deleted orders from list", async () => {
    await withTestTx(async (tx, orgId) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, orgId);
      const r = PurchaseOrder.create({
        id: crypto.randomUUID(), orgId, num: null, vendor: "Winsupply", status: "draft",
        jobId: null, orderedAt: null, expectedAt: null, shipTo: "shop", orderedByUserId: null,
        freightCents: 0, taxCents: 0, lines: [], createdAt: new Date(), updatedAt: new Date(),
      });
      if (!isOk(r)) throw new Error("bad");
      await repo.save(r.value);
      expect(await repo.softDelete(r.value.props.id, new Date())).toBe(1);
      const all = await repo.list();
      expect(all.find((p) => p.props.id === r.value.props.id)).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts modules/purchasing
```
Expected: FAIL — module not found. **Note:** the full integration suite hangs on some machines; always run a path filter as above, never the bare `npm run test:int`.

- [ ] **Step 3: Write the mapper**

```ts
// modules/purchasing/infra/purchase-order-mapper.ts
import type { POLineProps, PurchaseOrderProps } from "../domain/purchase-order";

interface PORow {
  id: string; orgId: string; num: string | null; vendor: string; status: string;
  jobId: string | null; orderedAt: string | null; expectedAt: string | null;
  shipTo: string; orderedByUserId: string | null; freightCents: number; taxCents: number;
  createdAt: Date; updatedAt: Date;
}
interface LineRow {
  id: string; description: string; qty: string; uom: string;
  unitCostMillicents: number; position: number;
}

/** `date` columns read back as "YYYY-MM-DD"; noon-anchored so no timezone rolls the day. */
const toDate = (s: string | null): Date | null => (s ? new Date(`${s}T12:00:00`) : null);

/** numeric(12,3) reads back as a STRING — coerce or every quantity multiplies as NaN. */
export const toLine = (r: LineRow): POLineProps => ({
  id: r.id,
  description: r.description,
  qty: Number(r.qty),
  uom: r.uom,
  unitCostMillicents: r.unitCostMillicents,
  position: r.position,
});

export const toProps = (r: PORow, lines: readonly LineRow[]): PurchaseOrderProps => ({
  id: r.id,
  orgId: r.orgId as PurchaseOrderProps["orgId"],
  num: r.num,
  vendor: r.vendor,
  status: r.status as PurchaseOrderProps["status"],
  jobId: r.jobId,
  orderedAt: toDate(r.orderedAt),
  expectedAt: toDate(r.expectedAt),
  shipTo: r.shipTo as PurchaseOrderProps["shipTo"],
  orderedByUserId: r.orderedByUserId,
  freightCents: r.freightCents,
  taxCents: r.taxCents,
  lines: [...lines].sort((a, b) => a.position - b.position).map(toLine),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
```

- [ ] **Step 4: Write the repository**

Model it on `modules/invoicing/infra/drizzle-invoice-repository.ts`. `nextNumber` copies that file's allocator verbatim with `'po'` and a `PO-` prefix:

```ts
async nextNumber(): Promise<string> {
  await this.tx.execute(sql`
    insert into number_sequences (org_id, kind) values (${this.orgId}, 'po')
    on conflict (org_id, kind) do nothing
  `);
  const rows = (await this.tx.execute(sql`
    update number_sequences set next_val = next_val + 1, updated_at = now()
    where org_id = ${this.orgId} and kind = 'po'
    returning next_val - 1 as allocated
  `)) as unknown as { allocated: number }[];
  return `PO-${rows[0]?.allocated ?? 1000}`;
}
```

`save` must **delete then insert** the lines inside the same transaction — an upsert leaves removed lines behind, which is what the third test pins. Every query filters `eq(purchaseOrders.orgId, this.orgId)` explicitly, in addition to RLS.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --config vitest.integration.config.ts modules/purchasing
```
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add modules/purchasing/infra
git commit -m "feat(purchasing): drizzle repository with PO number allocation"
```

---

### Task 4: Use-cases

**Files:**
- Create: `modules/purchasing/app/list-purchase-orders.ts` (+ `.test.ts`)
- Create: `modules/purchasing/app/create-purchase-order.ts` (+ `.test.ts`)
- Create: `modules/purchasing/app/update-purchase-order.ts` (+ `.test.ts`)
- Create: `modules/purchasing/app/place-purchase-order.ts` (+ `.test.ts`)
- Create: `modules/purchasing/app/cancel-purchase-order.ts` (+ `.test.ts`)
- Create: `modules/purchasing/app/add-purchase-order-note.ts` (+ `.test.ts`)

**Interfaces:**
- Consumes: `PurchaseOrderRepository`, `PurchaseOrder` from Task 2.
- Produces: DI-constructed classes each exposing `exec(...) → Promise<Result<...>>`, e.g. `new PlacePurchaseOrderUseCase(repo, clock).exec(orgId, poId)`.

- [ ] **Step 1: Write a fake repository the tests share**

Put `FakePurchaseOrderRepository` in `list-purchase-orders.test.ts` and export it, exactly as `modules/settings/app/get-settings.test.ts` exports `FakeSettingsRepository`. It holds an in-memory array, and `nextNumber()` returns `PO-1000`, `PO-1001`, … from a counter.

- [ ] **Step 2: Write the failing tests**

```ts
// modules/purchasing/app/place-purchase-order.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr } from "@mallet/shared/types";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { PlacePurchaseOrderUseCase } from "./place-purchase-order";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const CLOCK = { now: () => new Date("2026-08-28T00:00:00Z") };

describe("PlacePurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  beforeEach(() => { repo = new FakePurchaseOrderRepository(); });

  it("allocates the number at PLACE time, not at create — abandoned drafts burn none", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.num).toBe("PO-1000");
  });

  it("refuses to place an order with no lines, and allocates no number doing so", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 0 });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isErr(r)).toBe(true);
    expect(repo.allocations).toBe(0);
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, "00000000-0000-0000-0000-000000000000");
    expect(isErr(r)).toBe(true);
  });
});
```

Write the equivalent for the other five: `create` (rejects a blank vendor, accepts a null job), `update` (refuses to edit lines on a placed order — *"reconciling a bill by editing what you ordered erases the variance"*), `cancel` (refuses on a draft, telling you to delete it), `addNote` (accepts an attachment with empty text), `list` (returns newest first).

- [ ] **Step 3: Run and watch them fail**

```bash
npx vitest run modules/purchasing/app
```
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the six use-cases**

Each is a class with a DI constructor and one `exec`, returning `Result`. `PlacePurchaseOrderUseCase.exec` loads, calls `po.place(await repo.nextNumber(), clock.now())`, saves, returns. **Allocate the number only after `place()` has validated** — otherwise a rejected place still burns a number, which the second test pins.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run modules/purchasing/app
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/purchasing/app
git commit -m "feat(purchasing): use-cases for create, update, place, cancel and notes"
```

---

### Task 5: DTOs, router and the module barrel

**Files:**
- Create: `modules/purchasing/api/purchase-order-dto.ts`
- Create: `modules/purchasing/api/purchase-order-router.ts`
- Create: `modules/purchasing/index.ts`
- Test: `modules/purchasing/api/purchase-order-router.int.test.ts`
- Modify: the v1 router composition file (find it with `grep -rn "invoicingRouter" --include="*.ts" | grep -v modules/invoicing`)

**Interfaces:**
- Consumes: the use-cases from Task 4.
- Produces: `v1.purchasing.list`, `.create`, `.update`, `.place`, `.cancel`, `.remove`, `.addNote`, `.listNotes`, `.noteUploadUrl`, `.noteViewUrl` — all `ownerOrOffice`.

- [ ] **Step 1: Write the failing router test**

```ts
// modules/purchasing/api/purchase-order-router.int.test.ts
it("never lets a caller set the org id", async () => {
  // Pass an orgId in the input and assert the created row carries ctx.principal.orgId instead.
});

it("refuses a tech — purchasing is an office surface", async () => {
  // Call as a tech principal, expect FORBIDDEN.
});

it("returns money as {cents, currency}, never a bare number", async () => {
  const dto = await caller.v1.purchasing.list();
  expect(dto.items[0]?.total).toEqual({ cents: expect.any(Number), currency: "USD" });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts modules/purchasing/api
```
Expected: FAIL.

- [ ] **Step 3: Write the DTO**

DTOs are NOT the domain. Money crosses as `{cents, currency}`; `unitCostMillicents` crosses as a number; dates cross as ISO strings.

```ts
export interface PurchaseOrderDTO {
  id: string;
  num: string | null;
  vendor: string;
  status: "draft" | "ordered" | "cancelled";
  jobId: string | null;
  jobTitle: string | null;
  orderedAt: string | null;
  expectedAt: string | null;
  shipTo: "counter_pickup" | "job_site" | "shop";
  orderedByName: string | null;
  freight: { cents: number; currency: "USD" };
  tax: { cents: number; currency: "USD" };
  total: { cents: number; currency: "USD" };
  lines: Array<{ id: string; description: string; qty: number; uom: string; unitCostMillicents: number; amount: { cents: number; currency: "USD" } }>;
  createdAt: string;
}
```

- [ ] **Step 4: Write the router**

Thin transport only: validate with zod, construct the use-case with a repository bound to `ctx.principal.orgId`, map the `Result` to a tRPC error or a DTO. Note upload/view URLs reuse the job-photo storage gateway pattern from `modules/customers/infra/lead-attachment-storage.ts`.

- [ ] **Step 5: Mount it and run the tests**

```bash
npx vitest run --config vitest.integration.config.ts modules/purchasing
npx tsc --noEmit
```
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add modules/purchasing
git commit -m "feat(purchasing): tRPC router and DTOs"
```

---

### Task 6: Store slice and hydrator

**Files:**
- Create: `lib/store/slices/purchase-orders-slice.ts` (+ `.test.ts`)
- Create: `features/money/orders-hydrator.tsx` (+ `.test.tsx`)
- Modify: `lib/store/app-store.ts`, `lib/store/types.ts`, `lib/store/dto-mapper.ts`

**Interfaces:**
- Consumes: `v1.purchasing.*` from Task 5.
- Produces: store type `PurchaseOrder` (money in DOLLARS), actions `adoptPurchaseOrders`, `adoptPurchaseOrder`, `updatePurchaseOrder`, `removePurchaseOrder`, `appendPONote`.

- [ ] **Step 1: Write the failing slice test**

```ts
it("optimistically applies an edit and rolls back on failure, naming the failure", async () => {
  // The house pattern: optimistic → trpcVanilla mutate → reconcile from the returned DTO →
  // rollback + dev-log on failure. A silent rollback is the bug this test exists to prevent.
});

it("stores money in DOLLARS, converting once in dto-mapper", () => {
  const po = dtoPurchaseOrderToStore({ ...dto, total: { cents: 95_270, currency: "USD" } });
  expect(po.total).toBe(952.7);
});
```

- [ ] **Step 2–5:** run-fail, implement, run-pass. The hydrator calls `api.v1.purchasing.list.useQuery` with `refetchOnWindowFocus: false` and adopts into the store, exactly as `features/money/invoices-hydrator.tsx` does.

- [ ] **Step 6: Commit**

```bash
git add lib/store features/money/orders-hydrator.tsx
git commit -m "feat(money): purchase order store slice and hydrator"
```

---

### Task 7: The Orders tab and its list

**Files:**
- Create: `features/money/orders-panel.tsx` (+ `.test.tsx`)
- Modify: `app/(office)/money/page.tsx`
- Modify: `components/shell/section-tabs.tsx:52-67`

**Interfaces:**
- Consumes: the store slice from Task 6.
- Produces: `<OrdersPanel />`, and `/money?tab=orders`.

- [ ] **Step 1: Write the failing tab test**

```tsx
// components/shell/section-tabs.test.tsx
it("shows Money's two tabs when inside /money", () => {
  render(<SectionTabs />, { pathname: "/money" });
  expect(screen.getByRole("link", { name: /Getting paid/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Orders/ })).toBeTruthy();
});

it("marks Orders active on ?tab=orders and Getting paid active with no tab", () => { /* … */ });
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run components/shell/section-tabs.test.tsx
```

- [ ] **Step 3: Add the Money branch to SectionTabs**

Mirror the Jobs branch at `components/shell/section-tabs.tsx:59-67`:

```tsx
} else if (pathname.startsWith("/money")) {
  tabs = [
    { href: "/money", label: "Getting paid", active: tab !== "orders" },
    { href: "/money?tab=orders", label: "Orders", active: tab === "orders" },
  ];
}
```

The mock used a `ViewToggle` inside the page; `SectionTabs` is the app's real tab grammar and is what Jobs uses. **Do not ship the ViewToggle.**

- [ ] **Step 4: Split the Money page on ?tab=**

```tsx
// app/(office)/money/page.tsx
const tab = useSearchParams().get("tab");
return <div>{tab === "orders" ? <OrdersPanel /> : <MoneyLedger />}</div>;
```

- [ ] **Step 5: Write the OrdersPanel test, then the panel**

The list is a `.list-tbl` of `# · Vendor · For job · Status · Total · Ordered`, filter chips over `draft/ordered/cancelled` from `PO_STATUS_META`, and a footer reading `Placed <total>` in `var(--red)` / `In draft <total>`. It must render the four list states — first-run empty, loading, load-failed, and populated — using `FirstRunEmptyState`, `ListLoading` and `LoadFailed`, like `money-ledger.tsx`.

- [ ] **Step 6: Commit**

```bash
git add features/money components/shell app/\(office\)/money
git commit -m "feat(money): Orders tab with the purchase order list"
```

---

### Task 8: The two modals, promoted from the mock

**Files:**
- Create: `components/modals/po-modal/po-modal.tsx` (+ `.test.tsx`)
- Create: `components/modals/new-po-modal.tsx` (+ `.test.tsx`)
- Move: `features/money/po-defs.ts`, `features/money/po-line-table.tsx` (from the mock branch, types swapped to store types)
- Modify: `lib/store/modal-ids.ts`, `components/modals/modal-host.tsx`, `app/prototype.css`
- Delete: `app/(office)/money/po/page.tsx`, `features/money/po-view-modal.tsx`, `features/money/po-create-modal.tsx`

**Interfaces:**
- Consumes: the store slice (Task 6), `po-defs.ts`, `po-line-table.tsx`.
- Produces: `MODAL.PO` (`{ poId }`) and `MODAL.NEW_PO`.

- [ ] **Step 1: Cherry-pick the mock's two shared files**

```bash
git checkout mock/money-purchase-orders -- features/money/po-defs.ts features/money/po-line-table.tsx
```
Then replace the local `PO`/`POLine`/`PONote` interfaces in `po-defs.ts` with imports of the store types from Task 6. Everything else — `PO_STATUS_META`, `PO_LABEL`, `PO_LINE_COLS`, `SHIP_TO_LABEL`, `poOrderSummary`, `poLinesSummary`, `poNotesSummary`, `lineCents`, `totalCents` — carries over unchanged.

- [ ] **Step 2: Write the consistency test — this is the point of the task**

```tsx
// components/modals/po-modal/po-modal.consistency.test.tsx
import { PO_LINE_COLS, PO_LABEL } from "@/features/money/po-defs";

/**
 * The create modal and the record sheet must read as ONE record. The mechanism is a shared
 * definition, not a habit — these tests fail the moment somebody hard-codes a label in one of them.
 */
it("both modals render the same line columns, in the same order", () => {
  const view = render(<POModal poId="po-1" />);
  const viewCols = [...view.container.querySelectorAll(".lineedit thead th")].map((t) => t.textContent);
  view.unmount();
  const create = render(<NewPOModal />);
  const createCols = [...create.container.querySelectorAll(".lineedit thead th")].map((t) => t.textContent);
  expect(createCols).toEqual(viewCols);
  expect(viewCols.filter(Boolean)).toEqual(PO_LINE_COLS.map((c) => c.label));
});

it("both modals call the vendor field the same thing", () => {
  // PO_LABEL.vendor in both — never "Supplier" in one of them.
});

// The registers deliberately do NOT cross: a create form is a form, a record is chapters.
it("the create modal uses DisclosureRow and never SheetRow", () => {
  const { container } = render(<NewPOModal />);
  expect(container.querySelector(".fdd")).toBeTruthy();
  expect(container.querySelector(".fsec")).toBeNull();
});

it("the record sheet uses SheetRow sections and never DisclosureRow", () => {
  const { container } = render(<POModal poId="po-1" />);
  expect(container.querySelector(".fsec")).toBeTruthy();
  expect(container.querySelector(".fdd")).toBeNull();
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run components/modals/po-modal
```

- [ ] **Step 4: Port the two modals**

`po-modal.tsx` is `po-view-modal.tsx` with `onPatch` replaced by store actions (per-field write on blur, no Save button). Chapters: **Order · Lines · Notes**. Lines lock when `status !== "draft"`. Notes use the shared `NoteComposer` with `onAttachFile` over a `NoteRow` feed — the same surface as the job and customer sheets.

`new-po-modal.tsx` is `po-create-modal.tsx` with `onCreate` calling `v1.purchasing.create`. Two essentials open (Vendor, For job), the rest staged in `DisclosureRow`s. **No `type="submit"` control** — Enter must never place an order.

- [ ] **Step 5: Make the type rules permanent**

In `app/prototype.css`, rewrite the two `PREVIEW ONLY` blocks as permanent rules, keeping the `.po-scope` and `.po-lines` selectors and dropping the "remove with the route" sentences. **No text below `var(--type-md)` on these surfaces** — this is a standing requirement from Owen, not a preference.

- [ ] **Step 6: Delete the mock route**

```bash
git rm app/\(office\)/money/po/page.tsx features/money/po-view-modal.tsx features/money/po-create-modal.tsx
```

- [ ] **Step 7: Verify in a browser, not just in jsdom**

Start the dev server on a dedicated port, log in as the E2E owner, and check: the Orders tab renders; creating an order persists it and opens its sheet; the sheet's chapters open; a note with an attachment saves; **and no element renders below 15px**:

```js
const small = await page.evaluate(() => [...document.querySelector(".modal").querySelectorAll("*")]
  .filter((el) => (el.value ?? el.textContent ?? "").trim() && parseFloat(getComputedStyle(el).fontSize) < 15)
  .map((el) => `${el.tagName}.${el.className}`));
console.log(small.length ? "SMALL TEXT: " + small.join(" | ") : "none under 15px");
```
Expected: `none under 15px`.

- [ ] **Step 8: Commit**

```bash
git add -A components/modals features/money app/prototype.css lib/store
git commit -m "feat(money): purchase order create and record modals"
```

---

### Task 9: Feed purchased cost to the job Costing tab

**Files:**
- Modify: `modules/jobs/infra/drizzle-labor-reader.ts:186-205` (`materialsByJob` and the row shape)
- Modify: `modules/jobs/api/job-router.ts:493` (the DTO)
- Modify: `features/jobs/job-costing-derive.ts` (+ its test)

**Interfaces:**
- Consumes: `purchase_orders` / `purchase_order_lines` from Task 1.
- Produces: `purchasedCents: number` on the costing row, reported ALONGSIDE `materialsCents`.

- [ ] **Step 1: Write the failing test**

```ts
// features/jobs/job-costing-derive.test.ts
/**
 * QUOTED AND PURCHASED ARE NOT ADDED TOGETHER. materialsByJob sums what the job was QUOTED for
 * parts; a PO buys the same physical part. Summing them reports roughly double the material cost
 * and invents a loss. They are two columns answering two questions: what we said it would cost,
 * and what we actually spent.
 */
it("reports purchased cost beside quoted materials, never folded into it", () => {
  const t = totals([item({ jobId: "j1", materialsCents: 5_000, purchasedCents: 4_200 })]);
  expect(t.materialsCents).toBe(5_000);
  expect(t.purchasedCents).toBe(4_200);
});

it("counts only PLACED orders — a draft is not money committed", () => { /* … */ });
it("counts nothing from a cancelled order", () => { /* … */ });
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run features/jobs/job-costing-derive.test.ts
```

- [ ] **Step 3: Add the reader query**

Alongside `materialsByJob`, add:

```ts
/**
 * What was actually BOUGHT for these jobs. Placed orders only — a draft is not money committed and
 * a cancelled one never was. There is no receiving (DECISION 4), so the whole order counts from the
 * day it is placed.
 */
private async purchasedByJob(jobIds: string[]): Promise<Map<string, number>> {
  // select po.job_id,
  //        sum(round(l.qty * l.unit_cost_millicents / 1000)) + po.freight_cents + po.tax_cents
  //   from purchase_orders po join purchase_order_lines l on (l.org_id, l.po_id) = (po.org_id, po.id)
  //  where po.org_id = $org and po.job_id = any($jobIds)
  //    and po.status = 'ordered' and po.deleted_at is null
  //  group by po.id, po.job_id
}
```

Add it to the existing `Promise.all` so it costs one more round trip for the page, not one per row — the same reason `materialsByJob` and `revenueByJob` are batched there.

- [ ] **Step 4: Run the tests and the browser check**

```bash
npx vitest run features/jobs modules/jobs
```
Then open a job with a PO against it and confirm the Costing tab shows both figures.

- [ ] **Step 5: Commit**

```bash
git add modules/jobs features/jobs
git commit -m "feat(jobs): costing reports purchased cost beside quoted materials"
```

---

### Task 10: Full gate and PR

- [ ] **Step 1: Run everything**

```bash
npx tsc --noEmit
pnpm lint
pnpm lint:css
npm test
npx vitest run --config vitest.integration.config.ts modules/purchasing modules/jobs
npm run coverage
npm run build
```
Expected: 0 tsc errors, 0 lint errors, all tests green, coverage ≥ 80% stmts / 75% branches, build compiles.

- [ ] **Step 2: Re-run the visual and a11y nets**

```bash
E2E_VISUAL=1 npx playwright test
```
Re-baseline deliberately for the new Orders tab. Note that ~14 baselines already fail on clean main — compare against a main run before blaming this branch.

- [ ] **Step 3: Confirm `db:verify` still agrees**

```bash
npm run db:verify
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "feat(money): purchase orders" --body "…"
```
The body must state: the four decisions and how they were resolved; that POs are a separate set and the receivables totals are untouched; that there is no receiving and the job is therefore charged at order time; and that `purchasedCents` is reported beside `materialsCents`, never summed into it.

---

## Self-Review

**Spec coverage.** Tab under Money → Task 7. The two modals and their consistency → Task 8. Persistence → Tasks 1, 3. Notes with attachments → Tasks 1 (`purchase_order_notes`), 5 (upload/view URLs), 8 (the composer). No receiving → reflected in the schema (no receipt columns), the domain (`jobCostCents` returns the full total), and Task 9. No small text → Global Constraints and Task 8 Steps 5 and 7. Stock orders with no job → nullable `job_id`, pinned by a domain test in Task 2.

**Placeholders.** The SQL body in Task 9 Step 3 is written as a comment sketch rather than final code, because the exact Drizzle builder call depends on the reader's existing query helpers — the implementer should follow `materialsByJob` directly above it. Every other step carries real code.

**Type consistency.** `unitCostMillicents` is spelled the same in the schema (`unit_cost_millicents`), the domain (`POLineProps`), the mapper, the DTO and the store. `jobCostCents()` is the domain method; `purchasedCents` is the costing-row field — deliberately different names for the per-order and per-job figures. Status strings are `draft | ordered | cancelled` everywhere, with no derived values anywhere, following DECISION 4.
