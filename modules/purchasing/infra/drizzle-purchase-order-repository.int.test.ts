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

const baseOrder = (org: OrgId, overrides: Partial<PurchaseOrderProps> = {}): PurchaseOrderProps => ({
  id: randomUUID(),
  orgId: org,
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  orderedAt: null,
  expectedAt: null,
  shipTo: "counter_pickup",
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

  it("omits soft-deleted orders from list", async () => {
    const org = asOrgId(orgId);
    const outcome = await withTenant(org, async (tx) => {
      const repo = new DrizzlePurchaseOrderRepository(tx, org);
      const r = PurchaseOrder.create(baseOrder(org, { vendor: "Winsupply", shipTo: "shop" }));
      if (!isOk(r)) throw new Error("bad");
      await repo.save(r.value);
      const deletedCount = await repo.softDelete(r.value.props.id, new Date());
      const all = await repo.list();
      return { id: r.value.props.id, deletedCount, all };
    });
    expect(outcome.deletedCount).toBe(1);
    expect(outcome.all.find((p) => p.props.id === outcome.id)).toBeUndefined();
  });
});
