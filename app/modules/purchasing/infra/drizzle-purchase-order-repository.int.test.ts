import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzlePurchaseOrderRepository } from "./drizzle-purchase-order-repository";
import { PurchaseOrder, type PurchaseOrderProps } from "../domain/purchase-order";

// NOTE: the task brief for this test imported a shared `withTestTx` helper from `@/test/int/tx`
// that does not exist in this repo — every integration test builds its own harness. This one
// follows `modules/invoicing/infra/drizzle-invoice-repository.int.test.ts`: a real `postgres`
// admin client seeds one org in `beforeAll`, each test runs its assertions inside `withTenant`
// (which opens a tenant-scoped, RLS-enforcing transaction that COMMITS), and the suite is
// skipped entirely when DB env isn't present so a machine without it doesn't fail the run.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

/** Local-calendar Y-M-D of a Date, for comparing "same day" without a timestamp's TZ noise. */
const ymd = (d: Date | null): string | null =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

const baseOrder = (org: OrgId, overrides: Partial<PurchaseOrderProps> = {}): PurchaseOrderProps => ({
  id: randomUUID(),
  orgId: org,
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  orderedAt: null,
  expectedAt: null,
  shipToAddress: null,
  orderedByUserId: null,
  freightCents: 0,
  taxCents: 0,
  lines: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

suite("DrizzlePurchaseOrderRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`insert into orgs (name) values ('PORepoT ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("allocates PO numbers in sequence per org", async () => {
    const org = asOrgId(orgId);
    const nums = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      return [await repo.nextNumber(), await repo.nextNumber()];
    });
    expect(nums).toEqual(["PO-1000", "PO-1001"]);
  });

  it("round-trips an order with its lines, in position order", async () => {
    const org = asOrgId(orgId);
    const back = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      const r = PurchaseOrder.create(
        baseOrder(org, {
          freightCents: 4_200,
          taxCents: 6_890,
          lines: [
            { id: randomUUID(), description: "Brass valve", qty: 12, uom: "ea", unitCostMillicents: 1_810_000, position: 1 },
            { id: randomUUID(), description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 },
          ],
        }),
      );
      if (!isOk(r)) throw new Error(r.error.message);
      await repo.save(r.value);
      return repo.findById(r.value.props.id);
    });
    expect(back).not.toBeNull();
    expect(back!.props.lines.map((l) => l.description)).toEqual(["PEX coil", "Brass valve"]);
    expect(back!.props.freightCents).toBe(4_200);
    // numeric(12,3) comes back as a STRING from postgres — the mapper must coerce it or every
    // quantity multiplies as NaN.
    expect(typeof back!.props.lines[0]!.qty).toBe("number");
  });

  it("replaces lines on save rather than appending them", async () => {
    const org = asOrgId(orgId);
    const id = randomUUID();
    const mk = (description: string) =>
      PurchaseOrder.create(
        baseOrder(org, {
          id,
          lines: [{ id: randomUUID(), description, qty: 1, uom: "ea", unitCostMillicents: 1000, position: 0 }],
        }),
      );
    const back = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      const a = mk("first");
      if (!isOk(a)) throw new Error("bad");
      await repo.save(a.value);
      const b = mk("second");
      if (!isOk(b)) throw new Error("bad");
      await repo.save(b.value);
      return repo.findById(id);
    });
    expect(back!.props.lines).toHaveLength(1);
    expect(back!.props.lines[0]!.description).toBe("second");
  });

  // `ordered_at`/`expected_at` are postgres `date` columns; the mapper's `fromDate` (write) and
  // `toDate` (read) are a hand-rolled, deliberately-asymmetric pair (write: local Y-M-D of the
  // Date; read: local noon of that Y-M-D) — exactly the shape that has bitten this repo before
  // with `time` columns reading back as "HH:MM:SS". This pins the full round trip: the calendar
  // date that goes in via `save()` is the calendar date that comes back via `findById()`,
  // compared as Y-M-D (not as a timestamp, which would be sensitive to the noon anchor).
  it("round-trips orderedAt/expectedAt as the SAME calendar date, not shifted by a timezone", async () => {
    const org = asOrgId(orgId);
    // Constructed from local calendar components (not an ISO/UTC string) so the test's own
    // expectation isn't itself at the mercy of the runner's timezone.
    const orderedAt = new Date(2026, 5, 15); // June 15, 2026
    const expectedAt = new Date(2026, 6, 2); // July 2, 2026
    const back = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      const r = PurchaseOrder.create(baseOrder(org, { orderedAt, expectedAt }));
      if (!isOk(r)) throw new Error(r.error.message);
      await repo.save(r.value);
      return repo.findById(r.value.props.id);
    });
    expect(back).not.toBeNull();
    expect(ymd(back!.props.orderedAt)).toBe(ymd(orderedAt));
    expect(ymd(back!.props.expectedAt)).toBe(ymd(expectedAt));
  });

  it("omits soft-deleted orders from list", async () => {
    const org = asOrgId(orgId);
    const outcome = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      const r = PurchaseOrder.create(baseOrder(org, { vendor: "Winsupply", shipToAddress: "456 Warehouse Ave" }));
      if (!isOk(r)) throw new Error("bad");
      await repo.save(r.value);
      const deletedCount = await repo.softDelete(r.value.props.id, new Date());
      const all = await repo.list();
      return { id: r.value.props.id, deletedCount, all };
    });
    expect(outcome.deletedCount).toBe(1);
    expect(outcome.all.find((p) => p.props.id === outcome.id)).toBeUndefined();
  });

  // Regression for the list() N+1 fix: one batched `inArray(poId, headerIds)` read of lines,
  // grouped by poId in memory, replaced a per-header query. Pins that the grouping keeps each
  // order's OWN lines — a wrong key or a flattened/shared array would show up here as one order
  // borrowing another's lines, or a line landing under a description it doesn't own.
  it("list() hydrates each order with ITS OWN lines, not another order's, across a multi-order page", async () => {
    const org = asOrgId(orgId);
    const outcome = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);

      const withLines = (vendor: string, descriptions: string[]) =>
        PurchaseOrder.create(
          baseOrder(org, {
            vendor,
            lines: descriptions.map((description, i) => ({
              id: randomUUID(),
              description,
              qty: 1,
              uom: "ea",
              unitCostMillicents: 1_000_000,
              position: i,
            })),
          }),
        );

      const a = withLines("List NPlus1 A", ["A-line-1", "A-line-2"]);
      const b = withLines("List NPlus1 B", ["B-line-1"]);
      const c = withLines("List NPlus1 C", []); // no lines at all — must not blow up the grouping
      if (!isOk(a) || !isOk(b) || !isOk(c)) throw new Error("bad fixture");
      await repo.save(a.value);
      await repo.save(b.value);
      await repo.save(c.value);

      const all = await repo.list();
      return {
        aId: a.value.props.id,
        bId: b.value.props.id,
        cId: c.value.props.id,
        byId: new Map(all.map((po) => [po.props.id, po])),
      };
    });

    expect(outcome.byId.get(outcome.aId)?.props.lines.map((l) => l.description).sort()).toEqual([
      "A-line-1",
      "A-line-2",
    ]);
    expect(outcome.byId.get(outcome.bId)?.props.lines.map((l) => l.description)).toEqual(["B-line-1"]);
    expect(outcome.byId.get(outcome.cId)?.props.lines).toEqual([]);
  });
});
