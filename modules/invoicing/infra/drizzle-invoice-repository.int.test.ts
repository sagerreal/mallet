import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asInvoiceId,
  money,
  zeroMoney,
  toPage,
  isOk,
  type OrgId,
  type LeadId,
  type JobId,
  type InvoiceId,
  type UserId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Invoice, type InvoiceStatus } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import { Payment } from "../domain/payment";
import { DrizzleInvoiceRepository } from "./drizzle-invoice-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

interface InvOpts {
  sourceJobId?: JobId | null;
  total?: number;
  withLine?: boolean;
  num?: string;
  status?: InvoiceStatus;
  publicToken?: string | null;
}

const buildInvoice = (orgId: OrgId, leadId: LeadId, o: InvOpts = {}): Invoice => {
  const now = new Date("2026-06-01T00:00:00Z");
  const lines: InvoiceLine[] = [];
  if (o.withLine) {
    const l = InvoiceLine.create({
      id: randomUUID(),
      sourceJobLineId: null,
      description: "Work",
      quantity: 1,
      rate: money(o.total ?? 0),
      cost: zeroMoney,
      position: 0,
    });
    if (!isOk(l)) throw new Error(l.error.message);
    lines.push(l.value);
  }
  const status = o.status ?? "draft";
  // A sent/partial/paid invoice must carry a sent/due date (the factory rejects a sent invoice
  // without one) — set them whenever the status is past 'draft'.
  const isSent = status !== "draft";
  const r = Invoice.create({
    id: asInvoiceId(randomUUID()),
    orgId,
    num: o.num ?? `INV-${Math.floor(now.getTime() / 1000)}-${Math.round(o.total ?? 0)}`,
    sourceJobId: o.sourceJobId ?? null,
    leadId,
    title: "T",
    status,
    total: money(o.total ?? 0),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines,
    termsDays: 7,
    sentAt: isSent ? now : null,
    dueAt: isSent ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) : null,
    publicToken: o.publicToken ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const buildPayment = (key: string, recordedByUserId: UserId | null = null): Payment => {
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

suite("DrizzleInvoiceRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let leadBId = "";
  let jobAId = "";
  let jobBId = "";
  let invBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('InvT A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('InvT B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    const [lb] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    leadAId = la!.id;
    leadBId = lb!.id;
    const [ja] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status, total_cents) values (${orgAId}, 'JOB-A1', ${leadAId}, 'complete', 100000) returning id`;
    const [jb] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgBId}, 'JOB-B1', ${leadBId}, 'complete') returning id`;
    jobAId = ja!.id;
    jobBId = jb!.id;
    const [ib] = await admin<{ id: string }[]>`insert into invoices (org_id, num, lead_id, status) values (${orgBId}, 'INV-B1', ${leadBId}, 'draft') returning id`;
    invBId = ib!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("allocates gapless per-org INV numbers starting at INV-1000", async () => {
    const orgA = asOrgId(orgAId);
    const nums = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      return [await repo.nextNumber(), await repo.nextNumber()];
    });
    expect(nums).toEqual(["INV-1000", "INV-1001"]);
  });

  it("round-trips an invoice with a line by id", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { total: 50_000, withLine: true, num: await repo.nextNumber() });
      await repo.save(inv);
      const loaded = await repo.findById(inv.props.id);
      return { total: loaded?.props.total, lines: loaded?.props.lines.length };
    });
    expect(result.total).toBe(50_000);
    expect(result.lines).toBe(1);
  });

  it("createFromJob-style insert is idempotent on source_job_id", async () => {
    const orgA = asOrgId(orgAId);
    const outcome = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const src = asJobId(jobAId);
      const first = await repo.insertForJob(
        buildInvoice(orgA, asLeadId(leadAId), { sourceJobId: src, num: await repo.nextNumber() }),
      );
      const second = await repo.insertForJob(
        buildInvoice(orgA, asLeadId(leadAId), { sourceJobId: src, num: await repo.nextNumber() }),
      );
      const found = await repo.findBySourceJob(src);
      return { first, second, foundId: found?.props.id };
    });
    expect(outcome.first).toBe(true);
    expect(outcome.second).toBe(false); // idempotent — one invoice per job
    expect(outcome.foundId).toBeTruthy();
  });

  it("dedupes payments on the idempotency key (append-only ledger)", async () => {
    const orgA = asOrgId(orgAId);
    const outcome = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { total: 100_000, num: await repo.nextNumber() });
      await repo.save(inv);
      const key = `idem-${randomUUID()}`;
      const a = await repo.insertPayment(orgA, inv.props.id, buildPayment(key));
      const b = await repo.insertPayment(orgA, inv.props.id, buildPayment(key));
      return { a, b };
    });
    expect(outcome.a).toBe(true);
    expect(outcome.b).toBe(false); // same key -> not applied twice
  });

  it("persists the public token, finds by it, and never rotates it (write-once in SQL)", async () => {
    const orgA = asOrgId(orgAId);
    const tokenA = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const tokenB = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const outcome = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), {
        status: "sent",
        total: 10_000,
        publicToken: tokenA,
        num: await repo.nextNumber(),
      });
      await repo.save(inv);
      const found = await repo.findByPublicToken(tokenA);

      // Save AGAIN with a different in-memory token — the COALESCE guard must keep the first.
      const rotated = Invoice.create({ ...inv.props, publicToken: tokenB });
      if (!isOk(rotated)) throw new Error(rotated.error.message);
      await repo.save(rotated.value);
      const afterRotate = await repo.findById(inv.props.id);
      const byOldToken = await repo.findByPublicToken(tokenA);
      const byNewToken = await repo.findByPublicToken(tokenB);
      return {
        foundId: found?.props.id,
        keptToken: afterRotate?.props.publicToken,
        oldStillResolves: byOldToken?.props.id,
        newResolves: byNewToken,
      };
    });
    expect(outcome.foundId).toBeTruthy();
    expect(outcome.keptToken).toBe(tokenA); // write-once — the rotation attempt was ignored
    expect(outcome.oldStillResolves).toBeTruthy();
    expect(outcome.newResolves).toBeNull();
  });

  it("findByPublicToken respects soft-delete", async () => {
    const orgA = asOrgId(orgAId);
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const invId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), {
        status: "sent",
        publicToken: token,
        num: await repo.nextNumber(),
      });
      await repo.save(inv);
      return inv.props.id;
    });
    await admin`update invoices set deleted_at = now() where id = ${invId}`;
    const found = await withTenant(orgA, async (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).findByPublicToken(token),
    );
    expect(found).toBeNull(); // a revoked/archived invoice's link goes dark
  });

  it("findByPublicToken is RLS-scoped — another org's tenant tx resolves nothing", async () => {
    const orgA = asOrgId(orgAId);
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      await repo.save(
        buildInvoice(orgA, asLeadId(leadAId), { status: "sent", publicToken: token, num: await repo.nextNumber() }),
      );
    });
    const orgB = asOrgId(orgBId);
    const crossOrg = await withTenant(orgB, async (tx) =>
      new DrizzleInvoiceRepository(tx, orgB).findByPublicToken(token),
    );
    expect(crossOrg).toBeNull();
  });

  it("public_token is globally unique when present (partial unique index)", async () => {
    const orgA = asOrgId(orgAId);
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      await repo.save(
        buildInvoice(orgA, asLeadId(leadAId), { status: "sent", publicToken: token, num: await repo.nextNumber() }),
      );
    });
    // Drizzle wraps the pg error ("Failed query: …") and keeps the constraint violation in
    // `cause` — assert on both so the test states WHICH index refused the row.
    const thrown: unknown = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      await repo.save(
        buildInvoice(orgA, asLeadId(leadAId), { status: "sent", publicToken: token, num: await repo.nextNumber() }),
      );
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).not.toBeNull();
    const text = `${String(thrown)} ${String((thrown as Error | null)?.cause ?? "")}`;
    expect(text).toMatch(/invoices_public_token_uidx|duplicate key/);
  });

  it("cannot see another org's invoice — by id or in a list", async () => {
    const orgA = asOrgId(orgAId);
    const invId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { num: await repo.nextNumber() });
      await repo.save(inv);
      return inv.props.id;
    });
    const orgB = asOrgId(orgBId);
    const seen = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgB);
      const byId = await repo.findById(invId);
      const listed = await repo.list(toPage({ limit: 100 }));
      return { byId, ids: listed.items.map((i) => i.props.id) };
    });
    expect(seen.byId).toBeNull();
    expect(seen.ids).not.toContain(invId);
  });

  it("composite FKs reject cross-tenant lead / source_job / payment references", async () => {
    const orgA = asOrgId(orgAId);
    const attemptSave = (inv: Invoice) =>
      withTenant(orgA, async (tx) => {
        await new DrizzleInvoiceRepository(tx, orgA).save(inv);
      }).then(
        () => false,
        () => true,
      );

    // invoice referencing org B's lead
    expect(await attemptSave(buildInvoice(orgA, asLeadId(leadBId)))).toBe(true);
    // invoice referencing org B's source job
    expect(
      await attemptSave(buildInvoice(orgA, asLeadId(leadAId), { sourceJobId: asJobId(jobBId) })),
    ).toBe(true);
    // payment referencing org B's invoice
    const paymentRejected = await withTenant(orgA, async (tx) => {
      await new DrizzleInvoiceRepository(tx, orgA).insertPayment(
        orgA,
        asInvoiceId(invBId),
        buildPayment(`idem-${randomUUID()}`),
      );
    }).then(
      () => false,
      () => true,
    );
    expect(paymentRejected).toBe(true);
  });

  it("applyPayment is atomic under CONCURRENT distinct payments (no lost update)", async () => {
    // Two distinct payments ($4000 + $6000) applied concurrently to a $10000 invoice must sum to
    // $10000 and reach 'paid' — the atomic UPDATE increment serializes on the row lock.
    const orgA = asOrgId(orgAId);
    const invId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { total: 10_000, status: "sent", num: await repo.nextNumber() });
      await repo.save(inv);
      return inv.props.id;
    });
    const apply = (cents: number) =>
      withTenant(orgA, (tx) => new DrizzleInvoiceRepository(tx, orgA).applyPayment(invId, cents));
    await Promise.all([apply(4_000), apply(6_000)]);

    const final = await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).findById(invId),
    );
    expect(final?.props.amountPaid).toBe(10_000); // neither write lost
    expect(final?.props.status).toBe("paid");
    expect(final?.due()).toBe(0);
  });

  it("applyPayment does NOT resurrect a voided invoice (atomic status guard)", async () => {
    // The void-vs-settlement race: a card payment settling on an invoice the office just voided must
    // not clobber it back to 'paid'. applyPayment's WHERE re-asserts the payable status under the row
    // lock, so it no-ops (applied:false) and the void stands.
    const orgA = asOrgId(orgAId);
    const invId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { total: 50_000, status: "sent", num: await repo.nextNumber() });
      await repo.save(inv);
      return inv.props.id;
    });
    // Void it (as VoidInvoiceUseCase does — a plain header save with status 'void', deleted_at null).
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const current = await repo.findById(invId);
      const voided = current!.void(new Date("2026-06-05T00:00:00Z"));
      if (!isOk(voided)) throw new Error("void failed");
      await repo.save(voided.value);
    });

    const result = await withTenant(orgA, (tx) =>
      new DrizzleInvoiceRepository(tx, orgA).applyPayment(invId, 50_000),
    );
    expect(result.applied).toBe(false); // guard rejected the write
    expect(result.invoice?.props.status).toBe("void"); // still void, not resurrected
    expect(result.invoice?.props.amountPaid).toBe(0); // no money applied
  });

  it("payment idempotency holds under CONCURRENT inserts (exactly one applies)", async () => {
    const orgA = asOrgId(orgAId);
    const invId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleInvoiceRepository(tx, orgA);
      const inv = buildInvoice(orgA, asLeadId(leadAId), { total: 100_000, num: await repo.nextNumber() });
      await repo.save(inv);
      return inv.props.id;
    });
    const key = `idem-concurrent-${randomUUID()}`;
    const insert = () =>
      withTenant(orgA, (tx) =>
        new DrizzleInvoiceRepository(tx, orgA).insertPayment(orgA, invId as InvoiceId, buildPayment(key)),
      );
    const [a, b] = await Promise.all([insert(), insert()]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one applied
  });
});
