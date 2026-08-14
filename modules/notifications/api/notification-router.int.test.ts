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

// Capstone: money loop up to a sent invoice, then send a customer reminder via the STUB sender;
// plus the reminder-due sequence over an aged invoice. org B sees nothing; a tech is forbidden.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("notifications tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let orgCId = ""; // no registration AND no number — dedicated to the "no line at all" gate tests.
  let leadAId = "";
  let agedInvoiceId = "";
  let orgCInvoiceId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifApi B ' || gen_random_uuid()) returning id`;
    const [c] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifApi C ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    orgCId = c!.id;
    // Lead WITH a phone so an SMS reminder has a destination.
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name, phone_e164) values (${orgAId}, 'Cust A', '+15551230000') returning id`;
    leadAId = la!.id;
    // An invoice sent 5 days ago -> reminder stage 1 is due.
    const [inv] = await admin<{ id: string }[]>`
      insert into invoices (org_id, num, lead_id, status, total_cents, sent_at)
      values (${orgAId}, 'INV-AGED', ${leadAId}, 'sent', 100000, now() - interval '5 days') returning id`;
    agedInvoiceId = inv!.id;

    // Org A can send: it owns a number AND its campaign carries a Messaging Service. BOTH halves
    // are required and the fixture used to supply neither — it inserted `status = 'active'` alone,
    // a state that cannot occur in production (registration refuses to start without a provisioned
    // number, and the campaign attaches to a service; verified on live data: of the active
    // campaigns, zero lack either). The old gate only read `status`, so the gap never showed. The
    // gate now asks whether there is a LINE to send from, and an org with no line has none.
    //
    // Why org A must be sendable at all: the "channel is unconfigured" test below is named for the
    // delivery (assertDelivered) guard, and a shop that cannot text would fail earlier and mask it.
    await admin`update orgs set twilio_number = '+15550000001' where id = ${orgAId}`;
    await admin`insert into a2p_registrations (org_id, status, messaging_service_sid)
                values (${orgAId}, 'active', 'MG-int-test')`;

    // Org C stays A2P-inactive (no registration row at all) — the dedicated fixture for proving
    // SMS is blocked and email is unaffected. Lead has BOTH contact fields so sendInvoiceReminder
    // can resolve a destination for either channel.
    const [lc] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164, email) values (${orgCId}, 'Cust C', '+15551230099', 'custc@example.com') returning id`;
    const [invC] = await admin<{ id: string }[]>`
      insert into invoices (org_id, num, lead_id, status) values (${orgCId}, 'INV-C1', ${lc!.id}, 'sent') returning id`;
    orgCInvoiceId = invC!.id;
  });

  afterAll(async () => {
    if (orgAId) {
      await admin`delete from a2p_registrations where org_id in (${orgAId}, ${orgBId}, ${orgCId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId}, ${orgCId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("refuses an interactive invoice reminder when the channel is unconfigured (stub sender)", async () => {
    // Interactive sends must surface delivery truth: with no real sender configured the
    // logging stub would silently "succeed" — the router now maps that to
    // PRECONDITION_FAILED so the office user is never shown a false success. The whole
    // tx rolls back, so no notification row is recorded and a retry stays idempotent.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.notifications.sendInvoiceReminder({ invoiceId: agedInvoiceId, channel: "sms" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("not configured") });

    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items.some((n) => n.relatedId === agedInvoiceId && n.reminderStage === null)).toBe(false);
  });

  // ── the automated-send gate ───────────────────────────────────────────────────
  // Org C has no registration row AND no number of its own. It is blocked here because THIS TEST
  // ENVIRONMENT configures no shared line either (MALLET_SHARED_SMS_* unset) — so there is no line
  // anywhere, which is the only remaining reason to refuse.
  //
  // NOT because its own campaign is inactive. That was the old rule, and it made the shared line
  // unreachable for exactly the shops it exists to serve. With a shared line configured, this same
  // org sends. Email is untouched either way — 10DLC governs text messages only.

  it("send blocks SMS when there is no line to send from at all", async () => {
    const caller = appRouter.createCaller(ctxFor(orgCId, "owner"));
    await expect(
      caller.v1.notifications.send({
        channel: "sms",
        to: "+15555550123",
        kind: "test",
        body: "hello",
        idempotencyKey: `a2p-gate-sms-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("isn't available") });

    // No row was recorded — the gate fires before the use-case ever claims the idempotency key.
    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items.some((n) => n.kind === "test")).toBe(false);
  });

  it("send does not block email for an org whose A2P campaign isn't active", async () => {
    const caller = appRouter.createCaller(ctxFor(orgCId, "owner"));
    // Passes the a2p gate (email is unaffected) and reaches the existing delivery-truth guard
    // (no real email sender configured in this test env) — proves the SMS gate never fires
    // for this channel.
    await expect(
      caller.v1.notifications.send({
        channel: "email",
        to: "someone@example.com",
        kind: "test",
        body: "hello",
        idempotencyKey: `a2p-gate-email-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("not configured") });
  });

  it("sendInvoiceReminder blocks SMS when there is no line to send from at all", async () => {
    const caller = appRouter.createCaller(ctxFor(orgCId, "owner"));
    await expect(
      caller.v1.notifications.sendInvoiceReminder({ invoiceId: orgCInvoiceId, channel: "sms" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("isn't available") });

    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items.some((n) => n.relatedId === orgCInvoiceId)).toBe(false);
  });

  it("sendInvoiceReminder still allows email for an org whose A2P campaign isn't active", async () => {
    const caller = appRouter.createCaller(ctxFor(orgCId, "owner"));
    await expect(
      caller.v1.notifications.sendInvoiceReminder({ invoiceId: orgCInvoiceId, channel: "email" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("not configured") });
  });

  it("advanceReminder blocks an org whose A2P campaign isn't active", async () => {
    // Org C's invoice isn't aged, so without the gate this would resolve to `null` (nothing due)
    // rather than reject — a rejection here can only come from the SMS gate firing before the
    // use-case (and its reminder-stage read) ever runs.
    const caller = appRouter.createCaller(ctxFor(orgCId, "owner"));
    await expect(
      caller.v1.notifications.advanceReminder({ relatedType: "invoice", relatedId: orgCInvoiceId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("isn't available") });

    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items.some((n) => n.relatedId === orgCInvoiceId)).toBe(false);
  });

  it("surfaces the aged invoice as a due reminder and advances the stage once (deduped)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const due = await caller.v1.notifications.listDueReminders({ limit: 50 });
    expect(due.items.some((d) => d.relatedId === agedInvoiceId && d.stage === 1)).toBe(true);

    const first = await caller.v1.notifications.advanceReminder({
      relatedType: "invoice",
      relatedId: agedInvoiceId,
    });
    expect(first?.reminderStage).toBe(1);
    // Stage 1 already sent, stage 2 not yet due (5 days < 6) -> no-op.
    const second = await caller.v1.notifications.advanceReminder({
      relatedType: "invoice",
      relatedId: agedInvoiceId,
    });
    expect(second).toBeNull();
  });

  it("rejects an SMS reminder when the customer has no phone (validation)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    // Seed a lead + invoice with NO phone, email-less, then request sms.
    const [lead] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'No Contact') returning id`;
    const [inv] = await admin<{ id: string }[]>`insert into invoices (org_id, num, lead_id, status) values (${orgAId}, 'INV-NOPHONE', ${lead!.id}, 'sent') returning id`;
    await expect(
      caller.v1.notifications.sendInvoiceReminder({ invoiceId: inv!.id, channel: "sms" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a different org sees no notifications", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a tech is forbidden from the notifications API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(caller.v1.notifications.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
