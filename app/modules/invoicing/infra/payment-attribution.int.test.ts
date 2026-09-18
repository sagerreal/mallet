import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  asUserId,
  money,
  zeroMoney,
  toPage,
  isOk,
  type OrgId,
  type LeadId,
  type UserId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Invoice } from "../domain/invoice";
import { Payment } from "../domain/payment";
import { DrizzleInvoiceRepository } from "./drizzle-invoice-repository";

// Two claims, against the live database:
//   1. payments.recorded_by_user_id round-trips — the stamp survives the write and comes back on
//      the hydrated aggregate. A column the app cannot read back is not an audit trail.
//   2. Org scoping still holds now that the repository filters org_id EXPLICITLY as well as
//      relying on RLS. The interesting case is the one RLS cannot catch: a repository constructed
//      with the WRONG org id inside a legitimately-scoped tenant transaction. RLS sees an allowed
//      tenant and waves it through; only the explicit predicate stops it.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const TECH: UserId = asUserId("55555555-5555-4555-8555-555555555555");

const buildSentInvoice = (orgId: OrgId, leadId: LeadId, num: string, token: string): Invoice => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Invoice.create({
    id: asInvoiceId(randomUUID()),
    orgId,
    num,
    sourceJobId: null,
    leadId,
    title: "Water heater",
    status: "sent",
    total: money(100_000),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines: [],
    termsDays: 7,
    sentAt: now,
    dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    publicToken: token,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const buildPayment = (key: string, recordedByUserId: UserId | null): Payment => {
  const r = Payment.create({
    id: randomUUID(),
    amount: money(10_000),
    method: "cash",
    idempotencyKey: key,
    externalId: null,
    recordedByUserId,
    receivedAt: new Date("2026-06-05T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

suite("payment attribution + org scoping (live DB)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let invAToken = "";
  let invAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('PayAttr A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('PayAttr B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;

    const orgA = asOrgId(orgAId);
    invAToken = `tok-${randomUUID()}`;
    invAId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildSentInvoice(orgA, asLeadId(leadAId), await repo.nextNumber(), invAToken);
      await repo.save(inv);
      return inv.props.id;
    });
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("round-trips recorded_by_user_id from the write to the hydrated aggregate", async () => {
    const orgA = asOrgId(orgAId);
    const key = `attrib-${randomUUID()}`;

    const applied = await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).insertPayment(orgA, asInvoiceId(invAId), buildPayment(key, TECH)),
    );
    expect(applied).toBe(true);

    const reread = await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).findById(asInvoiceId(invAId)),
    );
    const stamped = reread?.props.payments.find((p) => p.props.idempotencyKey === key);
    expect(stamped).toBeDefined();
    expect(stamped?.props.recordedByUserId).toBe(TECH);

    // And the column really is on the row, not reconstructed in JS.
    const [row] = await admin<{ recorded_by_user_id: string | null }[]>`
      select recorded_by_user_id from payments where org_id = ${orgAId} and idempotency_key = ${key}
    `;
    expect(row?.recorded_by_user_id).toBe(TECH);
  });

  it("round-trips a null actor (customer paid online — nobody in the app took it)", async () => {
    const orgA = asOrgId(orgAId);
    const key = `attrib-null-${randomUUID()}`;

    await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).insertPayment(orgA, asInvoiceId(invAId), buildPayment(key, null)),
    );

    const reread = await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).findById(asInvoiceId(invAId)),
    );
    const stamped = reread?.props.payments.find((p) => p.props.idempotencyKey === key);
    expect(stamped).toBeDefined();
    expect(stamped?.props.recordedByUserId).toBeNull();
  });

  it("a repository built with the wrong org id reads NOTHING, even inside org A's tenant tx", async () => {
    // RLS is satisfied here — the transaction is legitimately org A's. The only thing standing
    // between org B's repository and org A's money is the explicit eq(invoices.org_id) predicate.
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);

    const seen = await withTenant(orgA, async (tx) => {
      const wrongOrg = new DrizzleInvoiceRepository(tx, orgB);
      return {
        byId: await wrongOrg.findById(asInvoiceId(invAId)),
        byToken: await wrongOrg.findByPublicToken(invAToken),
        listed: await wrongOrg.list(toPage({ limit: 50 })),
        byLead: await wrongOrg.listByLead(asLeadId(leadAId), toPage({ limit: 50 })),
        counted: await wrongOrg.count(),
        totals: await wrongOrg.totals(),
        overdue: await wrongOrg.findOverdue(new Date("2030-01-01T00:00:00Z"), toPage({ limit: 50 })),
      };
    });

    expect(seen.byId).toBeNull();
    expect(seen.byToken).toBeNull();
    expect(seen.listed.items).toHaveLength(0);
    expect(seen.byLead.items).toHaveLength(0);
    expect(seen.counted).toBe(0);
    expect(seen.totals).toEqual({ openCents: 0, overdueCents: 0, openCount: 0 });
    expect(seen.overdue.items).toHaveLength(0);
  });

  it("the correctly-scoped repository still sees its own invoice (the filter is not too tight)", async () => {
    const orgA = asOrgId(orgAId);
    const seen = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      return {
        byId: await repo.findById(asInvoiceId(invAId)),
        byToken: await repo.findByPublicToken(invAToken),
        byLead: await repo.listByLead(asLeadId(leadAId), toPage({ limit: 50 })),
        counted: await repo.count(),
        totals: await repo.totals(),
      };
    });

    expect(seen.byId?.props.id).toBe(invAId);
    expect(seen.byToken?.props.id).toBe(invAId);
    expect(seen.byLead.items).toHaveLength(1);
    expect(seen.counted).toBe(1);
    expect(seen.totals.openCount).toBe(1);
  });

  it("org B's own transaction still sees nothing of org A (RLS, the other line of defense)", async () => {
    const orgB = asOrgId(orgBId);
    const seen = await withTenant(orgB, (tx) =>
      new DrizzleInvoiceRepository(tx, orgB).findById(asInvoiceId(invAId)),
    );
    expect(seen).toBeNull();
  });
});
