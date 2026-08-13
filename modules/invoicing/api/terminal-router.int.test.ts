import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock, ok, err, externalService } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import type {
  TerminalGateway,
  CreateConnectionTokenCmd,
  CreateTerminalLocationCmd,
  CreateTapIntentCmd,
  RetrievedTapIntent,
} from "../domain/terminal-gateway";

/**
 * v1.terminal against the live database with real RLS: the Connect gate, the ensure-once
 * location, the field assignment fence on tap intents, and the idempotent reconcile recorder.
 * Stripe itself is a fake gateway injected through deps — these tests prove OUR wiring
 * (org-scoping, persistence, the ledger), not Stripe's API.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const OUT_OF_SCOPE = "that invoice isn't on one of your jobs.";
const ACCT = "acct_int_test";

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

/** A capturing fake gateway; every call succeeds with fixed ids unless `intent` is overridden. */
const fakeGateway = (intent?: () => RetrievedTapIntent) => {
  const tokenCalls: CreateConnectionTokenCmd[] = [];
  const locationCalls: CreateTerminalLocationCmd[] = [];
  const intentCalls: CreateTapIntentCmd[] = [];
  const gateway: TerminalGateway = {
    createConnectionToken: async (cmd) => {
      tokenCalls.push(cmd);
      return ok({ secret: "pst_int_secret" });
    },
    createLocation: async (cmd) => {
      locationCalls.push(cmd);
      return ok({ locationId: "tml_int_1" });
    },
    createTapPaymentIntent: async (cmd) => {
      intentCalls.push(cmd);
      return ok({ paymentIntentId: `pi_${cmd.invoiceId.slice(0, 8)}`, clientSecret: "pi_secret" });
    },
    retrieveTapPaymentIntent: async () =>
      intent ? ok(intent()) : err(externalService("stripe", "no intent faked", true)),
  };
  return { gateway, tokenCalls, locationCalls, intentCalls };
};

const ctxFor = (
  userId: string,
  orgId: string,
  role: Role,
  terminalGateway: TerminalGateway | null,
): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    terminalGateway,
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

suite("v1.terminal — Tap to Pay server rails (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let coldOrgId = ""; // never onboarded — the PRECONDITION_FAILED fixture
  let techId = "";
  let otherTechId = "";
  let ownerId = "";
  let leadId = "";

  const seedJob = async (assignee: string | null): Promise<string> => {
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, kind, assignee_user_id, completed_at)
      values (${orgId}, ${leadId}, ${"JOB-" + randomUUID().slice(0, 8)}, 'complete', 100000, 'work',
              ${assignee}, ${new Date()})
      returning id
    `;
    return job!.id;
  };

  /** A SENT invoice on a job assigned to `assignee`, raised through the field surface itself. */
  const seedSentInvoice = async (assignee: string): Promise<{ jobId: string; invoiceId: string }> => {
    const jobId = await seedJob(assignee);
    const tech = appRouter.createCaller(ctxFor(assignee, orgId, "tech", fakeGateway().gateway));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });
    return { jobId, invoiceId: invoice.id };
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Terminal Test ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Terminal Cold ' || gen_random_uuid()) returning id`;
    orgId = a!.id;
    coldOrgId = b!.id;

    const mkUser = async (org: string, role: string): Promise<string> => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${org}, ${randomUUID()}, ${randomUUID() + "@terminal.test"}, ${role})
        returning id`;
      return u!.id;
    };
    techId = await mkUser(orgId, "tech");
    otherTechId = await mkUser(orgId, "tech");
    ownerId = await mkUser(orgId, "owner");

    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Tap Customer') returning id`;
    leadId = lead!.id;

    // The warm org finished Connect onboarding and has a business address on file; the cold org
    // has an org_settings row but never onboarded.
    const booking = admin.json({ services: [], notServices: "", serviceFee: 0, feeCredited: false });
    await admin`
      insert into org_settings (org_id, booking, biz_address, stripe_connected_account_id, stripe_charges_enabled)
      values (${orgId}, ${booking}, '742 Copper Line Rd', ${ACCT}, true)
    `;
    await admin`insert into org_settings (org_id, booking) values (${coldOrgId}, ${booking})`;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from job_visits where org_id in (${orgId}, ${coldOrgId})`;
      await admin`delete from time_entries where org_id in (${orgId}, ${coldOrgId})`;
      await admin`delete from orgs where id in (${orgId}, ${coldOrgId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── the Connect gate ──────────────────────────────────────────────────────────────────────

  it("every terminal procedure answers PRECONDITION_FAILED before Connect onboarding", async () => {
    const owner = appRouter.createCaller(ctxFor(ownerId, coldOrgId, "owner", fakeGateway().gateway));
    await expect(owner.v1.terminal.connectionToken()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(owner.v1.terminal.location()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("answers PRECONDITION_FAILED when Stripe itself is unconfigured (no gateway in deps)", async () => {
    const owner = appRouter.createCaller(ctxFor(ownerId, orgId, "owner", null));
    await expect(owner.v1.terminal.connectionToken()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "card payments are not enabled",
    });
  });

  // ── location: ensure-once, persisted where the other Stripe ids live ─────────────────────

  it("creates the org's location once from its own profile, persists it, and never re-creates", async () => {
    const { gateway, locationCalls } = fakeGateway();
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));

    const first = await tech.v1.terminal.location();
    expect(first).toEqual({ locationId: "tml_int_1", created: true });
    expect(locationCalls).toHaveLength(1);
    expect(locationCalls[0]?.connectedAccountId).toBe(ACCT);
    expect(locationCalls[0]?.addressLine1).toBe("742 Copper Line Rd");

    const rows = await admin<{ stripe_terminal_location_id: string | null }[]>`
      select stripe_terminal_location_id from org_settings where org_id = ${orgId}`;
    expect(rows[0]!.stripe_terminal_location_id).toBe("tml_int_1");

    const second = await tech.v1.terminal.location();
    expect(second).toEqual({ locationId: "tml_int_1", created: false });
    expect(locationCalls).toHaveLength(1); // no second Stripe create
  });

  it("mints connection tokens on the connected account, scoped to the stored location", async () => {
    const { gateway, tokenCalls } = fakeGateway();
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));
    const token = await tech.v1.terminal.connectionToken();
    expect(token).toEqual({ secret: "pst_int_secret" });
    expect(tokenCalls).toEqual([{ connectedAccountId: ACCT, locationId: "tml_int_1" }]);
  });

  // ── tap intents: the field fence ──────────────────────────────────────────────────────────

  it("a tech on the job mints an intent for the FULL balance with the platform fee", async () => {
    const { invoiceId } = await seedSentInvoice(techId);
    const { gateway, intentCalls } = fakeGateway();
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));

    const minted = await tech.v1.terminal.createTapPaymentIntent({ invoiceId });
    expect(minted.amountCents).toBe(100_000);
    expect(minted.clientSecret).toBe("pi_secret");
    expect(intentCalls[0]?.connectedAccountId).toBe(ACCT);
    expect(intentCalls[0]?.applicationFeeCents).toBe(250);
  });

  it("a tech NOT on the job gets the flattened NOT_FOUND — no existence oracle, same as the field surface", async () => {
    const { invoiceId } = await seedSentInvoice(techId);
    const intruder = appRouter.createCaller(ctxFor(otherTechId, orgId, "tech", fakeGateway().gateway));
    await expect(intruder.v1.terminal.createTapPaymentIntent({ invoiceId })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: OUT_OF_SCOPE,
    });
    await expect(
      intruder.v1.terminal.reconcileTapPayment({ invoiceId, paymentIntentId: "pi_x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  // ── reconcile: records once, through the same ledger as every other card payment ─────────

  it("records a succeeded intent idempotently and flips the invoice paid", async () => {
    const { invoiceId } = await seedSentInvoice(techId);
    const pi = `pi_${randomUUID().slice(0, 12)}`;
    const { gateway } = fakeGateway(() => ({
      paymentIntentId: pi,
      status: "succeeded",
      amountReceivedCents: 100_000,
      metadata: { orgId, invoiceId, kind: "tap" },
    }));
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));

    const first = await tech.v1.terminal.reconcileTapPayment({ invoiceId, paymentIntentId: pi });
    expect(first).toEqual({ recorded: true });

    // Delivered twice (retry, or a future Connect webhook racing this) → still ONE ledger row.
    const second = await tech.v1.terminal.reconcileTapPayment({ invoiceId, paymentIntentId: pi });
    expect(second).toEqual({ recorded: true });

    const rows = await admin<{ amount_cents: number; external_id: string | null }[]>`
      select amount_cents, external_id from payments where org_id = ${orgId} and invoice_id = ${invoiceId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount_cents).toBe(100_000);
    expect(rows[0]!.external_id).toBe(pi);

    const read = await tech.v1.fieldInvoicing.get({ invoiceId });
    expect(read.status).toBe("paid");
  });

  it("refuses to record an intent whose metadata names a different invoice or a non-tap kind", async () => {
    const { invoiceId } = await seedSentInvoice(techId);
    const { invoiceId: otherInvoiceId } = await seedSentInvoice(techId);
    const pi = `pi_${randomUUID().slice(0, 12)}`;
    // The intent genuinely settled — but for the OTHER invoice. Recording it here would credit
    // the wrong bill.
    const { gateway } = fakeGateway(() => ({
      paymentIntentId: pi,
      status: "succeeded",
      amountReceivedCents: 100_000,
      metadata: { orgId, invoiceId: otherInvoiceId, kind: "tap" },
    }));
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));
    const outcome = await tech.v1.terminal.reconcileTapPayment({ invoiceId, paymentIntentId: pi });
    expect(outcome).toEqual({ recorded: false, reason: "wrong_target" });

    const rows = await admin`select id from payments where org_id = ${orgId} and invoice_id = ${invoiceId}`;
    expect(rows).toHaveLength(0);
  });

  it("does not record an intent that has not succeeded yet", async () => {
    const { invoiceId } = await seedSentInvoice(techId);
    const pi = `pi_${randomUUID().slice(0, 12)}`;
    const { gateway } = fakeGateway(() => ({
      paymentIntentId: pi,
      status: "requires_payment_method",
      amountReceivedCents: 0,
      metadata: { orgId, invoiceId, kind: "tap" },
    }));
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech", gateway));
    const outcome = await tech.v1.terminal.reconcileTapPayment({ invoiceId, paymentIntentId: pi });
    expect(outcome).toEqual({ recorded: false, reason: "not_succeeded" });
  });
});
