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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("notifications tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let agedInvoiceId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('NotifApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    // Lead WITH a phone so an SMS reminder has a destination.
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name, phone_e164) values (${orgAId}, 'Cust A', '+15551230000') returning id`;
    leadAId = la!.id;
    // An invoice sent 5 days ago -> reminder stage 1 is due.
    const [inv] = await admin<{ id: string }[]>`
      insert into invoices (org_id, num, lead_id, status, total_cents, sent_at)
      values (${orgAId}, 'INV-AGED', ${leadAId}, 'sent', 100000, now() - interval '5 days') returning id`;
    agedInvoiceId = inv!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("sends an invoice reminder to the customer via the stub sender and lists it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const sent = await caller.v1.notifications.sendInvoiceReminder({
      invoiceId: agedInvoiceId,
      channel: "sms",
    });
    expect(sent.status).toBe("sent");
    expect(sent.channel).toBe("sms");
    expect(sent.body).toContain("INV-AGED");

    const listed = await caller.v1.notifications.list({ limit: 50 });
    expect(listed.items.some((n) => n.id === sent.id)).toBe(true);
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
