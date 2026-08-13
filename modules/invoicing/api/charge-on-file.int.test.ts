import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock, ok, err, conflict } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import type { CardChargeGateway, ChargeSavedCardCmd } from "../domain/card-charge-gateway";
import { saveCardOnFile } from "../app/save-card-on-file";

/**
 * Charge card on file, against the live database with real RLS.
 *
 * The Stripe leg is a fake gateway (no live charge in an integration test), which is exactly the
 * seam the production wiring uses — everything on THIS side of it is real: the scope guard, the
 * connect gate, the profile read under RLS, the balance arithmetic, the idempotent ledger write,
 * the attribution stamp, and the redacted field DTO.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const OUT_OF_SCOPE = "that invoice isn't on one of your jobs.";

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

/** A charge gateway that "settles" whatever it is asked, and remembers what it was asked. */
class FakeChargeGateway implements CardChargeGateway {
  public cmds: ChargeSavedCardCmd[] = [];
  public declineWith: string | null = null;
  async chargeSavedCard(cmd: ChargeSavedCardCmd) {
    this.cmds.push(cmd);
    if (this.declineWith) return err(conflict(this.declineWith));
    return ok({ paymentIntentId: `pi_int_${cmd.idempotencyKey.slice(-24)}`, amountReceivedCents: cmd.amountCents });
  }
}

const ctxFor = (userId: string, orgId: string, role: Role, gateway: CardChargeGateway | null): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    cardChargeGateway: gateway,
    connectGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

suite("chargeOnFile — field + office, live RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let techAId = "";
  let techBId = "";
  let ownerAId = "";
  let leadAId = "";

  const seedJob = async (assignee: string | null, opts: { totalCents?: number; leadId?: string } = {}): Promise<string> => {
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, kind, assignee_user_id, completed_at)
      values (${orgAId}, ${opts.leadId ?? leadAId}, ${"JOB-" + randomUUID().slice(0, 8)}, 'complete',
              ${opts.totalCents ?? 100_000}, 'work', ${assignee}, ${new Date()})
      returning id`;
    return job!.id;
  };

  const seedProfile = async (leadId: string, over: Record<string, string> = {}): Promise<void> => {
    await admin`
      insert into payment_profiles (org_id, lead_id, stripe_customer_id, stripe_payment_method_id, brand, last4, via)
      values (${orgAId}, ${leadId}, ${over.customer ?? "cus_int_1"}, ${over.pm ?? "pm_int_1"},
              ${over.brand ?? "visa"}, ${over.last4 ?? "4242"}, ${over.via ?? "payment"})
      on conflict (org_id, lead_id) do update set
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_payment_method_id = excluded.stripe_payment_method_id`;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ChargeOnFile A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ChargeOnFile B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const mkUser = async (org: string, role: string): Promise<string> => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${org}, ${randomUUID()}, ${randomUUID() + "@cof.test"}, ${role})
        returning id`;
      return u!.id;
    };
    techAId = await mkUser(orgAId, "tech");
    techBId = await mkUser(orgAId, "tech");
    ownerAId = await mkUser(orgAId, "owner");

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Card Customer') returning id`;
    leadAId = la!.id;

    // Connect-ready: the charge routes to this account as a destination charge. `booking` is
    // NOT NULL with no default — seeded the same way the field-invoice suite seeds it.
    await admin`
      insert into org_settings (org_id, timezone, booking, stripe_connected_account_id, stripe_charges_enabled)
      values (${orgAId}, 'America/Denver',
              ${admin.json({ services: [], notServices: "", serviceFee: 0, feeCredited: false })},
              'acct_int_1', true)`;
  });

  afterAll(async () => {
    if (orgAId) {
      await admin`delete from job_visits where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from time_entries where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── the happy path, field ─────────────────────────────────────────────────────────────────

  it("an assigned tech charges the card on file: full balance, real gateway cmd, attributed ledger row", async () => {
    const jobId = await seedJob(techAId, { totalCents: 68_000 });
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));

    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    const paid = await tech.v1.fieldInvoicing.chargeOnFile({
      invoiceId: invoice.id,
      idempotencyKey: `cof-${invoice.id}`,
    });
    expect(paid.status).toBe("paid");
    expect(paid.due.cents).toBe(0);

    // The gateway was handed the saved pointers, the FULL balance, and the shop's account.
    expect(gateway.cmds).toHaveLength(1);
    expect(gateway.cmds[0]).toMatchObject({
      amountCents: 68_000,
      customerId: "cus_int_1",
      paymentMethodId: "pm_int_1",
      connectedAccountId: "acct_int_1",
    });

    // The ledger row: keyed on the intent, attributed to the tech whose tap moved the money.
    const rows = await admin<{ idempotency_key: string; recorded_by_user_id: string | null; method: string }[]>`
      select idempotency_key, recorded_by_user_id, method from payments
      where org_id = ${orgAId} and invoice_id = ${invoice.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotency_key.startsWith("pi_int_")).toBe(true);
    expect(rows[0]!.method).toBe("card");
    expect(rows[0]!.recorded_by_user_id).toBe(techAId);
  });

  it("charges the REMAINING balance on a part-paid invoice, never the total", async () => {
    const jobId = await seedJob(techAId, { totalCents: 50_000 });
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));

    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });
    await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: invoice.id,
      amountCents: 20_000,
      method: "cash",
      idempotencyKey: `part-${invoice.id}`,
    });

    const paid = await tech.v1.fieldInvoicing.chargeOnFile({
      invoiceId: invoice.id,
      idempotencyKey: `cof2-${invoice.id}`,
    });
    expect(gateway.cmds[0]!.amountCents).toBe(30_000);
    expect(paid.status).toBe("paid");
  });

  // ── the fence ─────────────────────────────────────────────────────────────────────────────

  it("a tech NOT on the job gets the flattened NOT_FOUND — no oracle, no charge", async () => {
    const jobId = await seedJob(techBId);
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner", gateway));
    const invoice = await owner.v1.invoicing.createFromJob({ jobId });
    await owner.v1.invoicing.send({ invoiceId: invoice.id });

    const intruder = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));
    await expect(
      intruder.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `x-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
    expect(gateway.cmds).toHaveLength(0);
  });

  it("no card on file → PRECONDITION_FAILED naming the next step; Stripe never dialed", async () => {
    const [freshLead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'No Card Yet') returning id`;
    const jobId = await seedJob(techAId, { leadId: freshLead!.id });
    const gateway = new FakeChargeGateway();
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    await expect(
      tech.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `nc-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(gateway.cmds).toHaveLength(0);
  });

  it("a DECLINE surfaces Stripe's sentence verbatim and leaves the ledger untouched", async () => {
    const jobId = await seedJob(techAId, { totalCents: 30_000 });
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    gateway.declineWith = "Your card has insufficient funds.";
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    await expect(
      tech.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `dec-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Your card has insufficient funds." });

    const rows = await admin`select id from payments where org_id = ${orgAId} and invoice_id = ${invoice.id}`;
    expect(rows).toHaveLength(0);
    // Still collectable another way.
    const read = await tech.v1.fieldInvoicing.get({ invoiceId: invoice.id });
    expect(read.status).toBe("sent");
  });

  it("a second charge after settlement refuses on status — one ledger row, ever", async () => {
    const jobId = await seedJob(techAId, { totalCents: 20_000 });
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    await tech.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `a-${invoice.id}` });
    await expect(
      tech.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `b-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const rows = await admin`select id from payments where org_id = ${orgAId} and invoice_id = ${invoice.id}`;
    expect(rows).toHaveLength(1);
  });

  it("unconfigured Stripe self-disables with PRECONDITION_FAILED (both surfaces)", async () => {
    const jobId = await seedJob(techAId);
    await seedProfile(leadAId);
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", null));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    await expect(
      tech.v1.fieldInvoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `off-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });

    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner", null));
    await expect(
      owner.v1.invoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `off2-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ── the office surface ────────────────────────────────────────────────────────────────────

  it("the office charges through its own procedure; a tech is refused there", async () => {
    const jobId = await seedJob(techAId, { totalCents: 45_000 });
    await seedProfile(leadAId);
    const gateway = new FakeChargeGateway();
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner", gateway));

    const invoice = await owner.v1.invoicing.createFromJob({ jobId });
    await owner.v1.invoicing.send({ invoiceId: invoice.id });
    const paid = await owner.v1.invoicing.chargeOnFile({
      invoiceId: invoice.id,
      idempotencyKey: `office-${invoice.id}`,
    });
    expect(paid.status).toBe("paid");
    expect(gateway.cmds[0]!.amountCents).toBe(45_000);

    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", gateway));
    await expect(
      tech.v1.invoicing.chargeOnFile({ invoiceId: invoice.id, idempotencyKey: `t-${invoice.id}` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── capture persistence (saveCardOnFile — the webhook/reconcile write path) ───────────────

  it("saveCardOnFile UPSERTS: one row per customer, newest payment's pointers win", async () => {
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Upsert Customer') returning id`;
    const jobId = await seedJob(techAId, { leadId: lead!.id });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", new FakeChargeGateway()));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });

    const card = { customerId: "cus_first", paymentMethodId: "pm_first", brand: "visa", last4: "1111" };
    const saved1 = await saveCardOnFile({
      orgId: orgAId,
      subject: { kind: "payment", invoiceId: invoice.id },
      card,
      via: "payment",
    });
    expect(saved1).toBe(true);

    const saved2 = await saveCardOnFile({
      orgId: orgAId,
      subject: { kind: "payment", invoiceId: invoice.id },
      card: { customerId: "cus_second", paymentMethodId: "pm_second", brand: "mastercard", last4: "2222" },
      via: "payment",
    });
    expect(saved2).toBe(true);

    const rows = await admin<{ stripe_customer_id: string; brand: string; last4: string }[]>`
      select stripe_customer_id, brand, last4 from payment_profiles
      where org_id = ${orgAId} and lead_id = ${lead!.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stripe_customer_id: "cus_second", brand: "mastercard", last4: "2222" });
  });

  it("saveCardOnFile resolves a DEPOSIT subject through the estimate's own customer", async () => {
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Deposit Customer') returning id`;
    const [est] = await admin<{ id: string }[]>`
      insert into estimates (org_id, lead_id, num) values (${orgAId}, ${lead!.id}, ${"EST-" + randomUUID().slice(0, 8)})
      returning id`;

    const saved = await saveCardOnFile({
      orgId: orgAId,
      subject: { kind: "deposit", estimateId: est!.id },
      card: { customerId: "cus_dep", paymentMethodId: "pm_dep", brand: "amex", last4: "3333" },
      via: "deposit",
    });
    expect(saved).toBe(true);

    const rows = await admin<{ via: string; last4: string }[]>`
      select via, last4 from payment_profiles where org_id = ${orgAId} and lead_id = ${lead!.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ via: "deposit", last4: "3333" });
  });

  // ── the wire: where the card FACT travels (and where it must not) ─────────────────────────

  it("myDay hands the assigned tech the card facts — brand/last4/via and NOTHING else", async () => {
    await seedProfile(leadAId, { via: "payment" });
    await seedJob(techAId); // complete today → inside the day window
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech", null));

    const day = await tech.v1.field.myDay({
      dayStart: new Date(Date.now() - 6 * 3_600_000),
      dayEnd: new Date(Date.now() + 6 * 3_600_000),
    });
    const customer = day.customers.find((c) => c.id === leadAId);
    expect(customer?.card).toEqual({ brand: "visa", last4: "4242", via: "payment" });
    // The Stripe pointers must never cross the field wire — the DTO has no key for them.
    expect(Object.keys(customer!)).toEqual(["id", "name", "phone", "card"]);
  });

  it("customers.list carries the card for the office; a card-less customer answers null", async () => {
    await seedProfile(leadAId, { via: "payment" });
    const [noCard] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Listed No Card') returning id`;
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner", null));

    const listed = await owner.v1.customers.list({ limit: 100 });
    const withCard = listed.items.find((l) => l.id === leadAId);
    const without = listed.items.find((l) => l.id === noCard!.id);
    expect(withCard?.card).toEqual({ brand: "visa", last4: "4242", via: "payment" });
    expect(without?.card).toBeNull();
  });

  it("saveCardOnFile answers false for a subject that cannot hold a card — never a stray row", async () => {
    const saved = await saveCardOnFile({
      orgId: orgAId,
      subject: { kind: "payment", invoiceId: randomUUID() },
      card: { customerId: "cus_x", paymentMethodId: "pm_x", brand: "visa", last4: "9999" },
      via: "payment",
    });
    expect(saved).toBe(false);
  });
});
