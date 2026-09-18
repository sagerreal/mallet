import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asOrgId, asUserId, asLeadId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import { withTenant } from "@mallet/shared/db/tx";
import { DrizzleMessageRepository } from "../infra/drizzle-message-repository";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Integration: exercise the full messaging stack via createCaller — auth gate, RBAC,
// org-scoped transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves org A messages are invisible to org B, and the send use-case rejects missing config.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxForUser = (orgId: string, role: Role, userId: string): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
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

const ctxFor = (orgId: string, role: Role): Context => ctxForUser(orgId, role, randomUUID());

suite("messaging tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  // Orgs minted by the per-org rate-limit tests below (each needs its own limiter window).
  const rateLimitOrgIds: string[] = [];

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name, twilio_number)
      values ('MsgApi A ' || gen_random_uuid(), '+15005550006')
      returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('MsgApi B ' || gen_random_uuid()) returning id`;

    orgAId = a!.id;
    orgBId = b!.id;

    // Insert a lead with a phone number in org A (used for listByLead).
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164)
      values (${orgAId}, 'Test Customer', '+15555550199')
      returning id`;
    leadAId = lead!.id;

    // Insert a seed message directly (bypasses send so no Twilio call needed in CI).
    await admin`
      insert into messages (org_id, lead_id, direction, body, from_number, to_number, status)
      values (${orgAId}, ${leadAId}, 'outbound', 'Hi from us', '+15005550006', '+15555550199', 'sent')`;

    // Org A is A2P-active so the "send" tests below exercise the Twilio-config guard they're
    // named for, not the (separately unit-tested, see send-message.test.ts) 10DLC gate — an org
    // with no registration row reads as inactive and would mask the intended assertion.
    await admin`
      insert into a2p_registrations (org_id, status) values (${orgAId}, 'active')`;
  });

  afterAll(async () => {
    if (orgAId) {
      await admin`delete from messages where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from a2p_registrations where org_id in (${orgAId}, ${orgBId})`;
      // The tech-access fixtures reference users through non-cascading composite FKs
      // (job_visits_assignee_fk) — clear them before the org cascade reaches users.
      await admin`delete from job_visits where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from jobs where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    if (rateLimitOrgIds.length > 0) {
      await admin`delete from orgs where id = any(${rateLimitOrgIds})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── listByLead ────────────────────────────────────────────────────────────────

  it("org A can list its own thread", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const thread = await caller.v1.messaging.listByLead({ leadId: leadAId });
    expect(thread.length).toBeGreaterThanOrEqual(1);
    expect(thread[0]!.direction).toBe("outbound");
  });

  it("org B cannot see org A's messages (RLS: empty result)", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const thread = await callerB.v1.messaging.listByLead({ leadId: leadAId });
    // RLS returns 0 rows for cross-org lead — not a 403, just empty (lead is scoped to A).
    expect(thread).toHaveLength(0);
  });

  // ── listConversations ─────────────────────────────────────────────────────────

  it("returns one conversation row for org A (the seed message)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const conversations = await caller.v1.messaging.listConversations();
    expect(conversations.length).toBeGreaterThanOrEqual(1);
    // Find the row for our known lead.
    const row = conversations.find((c) => c.leadId === leadAId);
    expect(row).toBeDefined();
    expect(row!.leadName).toBe("Test Customer");
    expect(row!.lastDirection).toBe("outbound");
    expect(row!.lastBody).toBe("Hi from us");
    expect(typeof row!.lastAt).toBe("string"); // ISO string
    expect(typeof row!.unread).toBe("boolean");
  });

  it("conversations are sorted newest-first (lastAt DESC)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const conversations = await caller.v1.messaging.listConversations();
    const dates = conversations.map((c) => new Date(c.lastAt).getTime());
    // Each element must be >= the next (newest-first).
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i]!).toBeGreaterThanOrEqual(dates[i + 1]!);
    }
  });

  it("org B sees zero conversations (RLS org isolation)", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const conversations = await callerB.v1.messaging.listConversations();
    expect(conversations).toHaveLength(0);
  });

  it("a tech with no assignments gets an EMPTY inbox — scoped, not locked out", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    const conversations = await callerTech.v1.messaging.listConversations();
    expect(conversations).toHaveLength(0);
  });

  // ── send: config guard ────────────────────────────────────────────────────────
  // The send procedure requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in env.
  // In CI without those vars, we expect PRECONDITION_FAILED rather than a live Twilio call.

  it("send returns PRECONDITION_FAILED when Twilio is not configured", async () => {
    // Only run this assertion when the Twilio vars are NOT set in the test environment.
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return;

    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.messaging.send({ leadId: leadAId, body: "Hello" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("not set up") });
  });

  // ── RBAC ──────────────────────────────────────────────────────────────────────

  it("an UNASSIGNED tech cannot send — NOT_FOUND, the same scoped refusal as reads", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.messaging.send({ leadId: leadAId, body: "Hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an unassigned tech gets NOT_FOUND on a thread read — scoped, not role-blocked", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.messaging.listByLead({ leadId: leadAId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── send: input validation ────────────────────────────────────────────────────

  it("send rejects an empty body", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.messaging.send({ leadId: leadAId, body: "" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("send rejects a body over 1600 chars", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.messaging.send({ leadId: leadAId, body: "x".repeat(1601) }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("send rejects an idempotency key shorter than 8 chars", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.messaging.send({ leadId: leadAId, body: "Hi", idempotencyKey: "short" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  // ── send: per-org rate limit ──────────────────────────────────────────────────
  // The limiter is a module-level singleton keyed by orgId, so every test here uses its OWN
  // fresh org — reusing orgAId would let earlier tests' send() calls in this file count against
  // the same window. Each org is created with NO twilioNumber, so any call that gets PAST the
  // limiter always fails on the (DB-backed) "no business number provisioned" precondition —
  // which is what lets these tests prove the limiter runs before that DB work, not because of it.

  async function makeRateLimitOrg(): Promise<string> {
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('MsgApi RateLimit ' || gen_random_uuid()) returning id`;
    const id = org!.id;
    rateLimitOrgIds.push(id);
    return id;
  }

  it("rate limits the 31st send in a minute per org, without affecting a different org's window", async () => {
    const orgId = await makeRateLimitOrg();
    const otherOrgId = await makeRateLimitOrg();
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const otherCaller = appRouter.createCaller(ctxFor(otherOrgId, "owner"));
    const fakeLeadId = randomUUID();

    for (let i = 0; i < 30; i++) {
      await caller.v1.messaging.send({ leadId: fakeLeadId, body: "hi" }).catch(() => {});
    }
    await expect(
      caller.v1.messaging.send({ leadId: fakeLeadId, body: "hi" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // otherOrgId has never sent in this window — still well under the limit, proving the two
    // orgs' windows are independent rather than sharing one global counter.
    await expect(
      otherCaller.v1.messaging.send({ leadId: fakeLeadId, body: "hi" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("the 30th send in the window still reaches the DB precondition, not the limiter", async () => {
    const orgId = await makeRateLimitOrg();
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const fakeLeadId = randomUUID();

    for (let i = 0; i < 29; i++) {
      await caller.v1.messaging.send({ leadId: fakeLeadId, body: "hi" }).catch(() => {});
    }
    await expect(
      caller.v1.messaging.send({ leadId: fakeLeadId, body: "hi" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ── the claim itself (messages_org_idem_uidx, live) ───────────────────────────
  // Exercised at the repository rather than through send(): this environment has no Twilio
  // credentials, so a router send never reaches the claim. What has to hold is the DB contract
  // the double-send guard rests on — one row per (org_id, idempotency_key), enforced by the
  // partial unique index and not by application logic.

  it("a second claim on the same (org, key) writes no row and returns the first one", async () => {
    const orgA = asOrgId(orgAId);
    const key = `okq-int-${randomUUID()}-fu1`;

    const first = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({
        id: randomUUID(),
        leadId: asLeadId(leadAId),
        sentByUserId: null,
        from: "+15005550006",
        to: "+15555550199",
        body: "follow-up",
        idempotencyKey: key,
      }),
    );
    const second = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({
        id: randomUUID(),
        leadId: asLeadId(leadAId),
        sentByUserId: null,
        from: "+15005550006",
        to: "+15555550199",
        body: "follow-up",
        idempotencyKey: key,
      }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.message.props.id).toBe(first.message.props.id);
    expect(first.message.props.status).toBe("queued");

    const rows = await admin<{ id: string }[]>`
      select id from messages where org_id = ${orgAId} and idempotency_key = ${key}`;
    expect(rows).toHaveLength(1);
  });

  it("the same key in a different org is a different message (the index is per-tenant)", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);
    const key = `okq-int-${randomUUID()}-fu1`;

    const inA = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({
        id: randomUUID(),
        leadId: asLeadId(leadAId),
        sentByUserId: null,
        from: "+15005550006",
        to: "+15555550199",
        body: "follow-up",
        idempotencyKey: key,
      }),
    );
    const inB = await withTenant(orgB, (tx) =>
      new DrizzleMessageRepository(tx, orgB).claimOutbound({
        id: randomUUID(),
        leadId: null,
        sentByUserId: null,
        from: "+15005550007",
        to: "+15555550199",
        body: "follow-up",
        idempotencyKey: key,
      }),
    );

    expect(inA.created).toBe(true);
    expect(inB.created).toBe(true);
    expect(inB.message.props.id).not.toBe(inA.message.props.id);

    const rows = await admin<{ id: string }[]>`
      select id from messages where idempotency_key = ${key}`;
    expect(rows).toHaveLength(2);
  });

  it("a failed claim is reclaimed in place — same row, still one row for the key", async () => {
    const orgA = asOrgId(orgAId);
    const key = `okq-int-${randomUUID()}-fu1`;
    const claimCmd = {
      leadId: asLeadId(leadAId),
      sentByUserId: null,
      from: "+15005550006",
      to: "+15555550199",
      body: "follow-up",
      idempotencyKey: key,
    };

    const first = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({ ...claimCmd, id: randomUUID() }),
    );
    await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).markFailed(first.message.props.id, "30034"),
    );

    // The retry: a deterministic follow-up key must not be spent by an attempt that failed.
    const retry = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({
        ...claimCmd,
        id: randomUUID(),
        body: "follow-up, corrected",
        to: "+15555550188",
      }),
    );

    expect(retry.created).toBe(true);
    expect(retry.message.props.id).toBe(first.message.props.id);
    expect(retry.message.props.status).toBe("queued");
    // Re-stamped from the retry, and the dead attempt's carrier code cleared.
    expect(retry.message.props.body).toBe("follow-up, corrected");
    expect(retry.message.props.toNumber).toBe("+15555550188");
    expect(retry.message.props.errorCode).toBeNull();

    const rows = await admin<{ id: string }[]>`
      select id from messages where org_id = ${orgAId} and idempotency_key = ${key}`;
    expect(rows).toHaveLength(1);
  });

  it("settling a message that does not exist throws rather than passing silently", async () => {
    const orgA = asOrgId(orgAId);
    await expect(
      withTenant(orgA, (tx) => new DrizzleMessageRepository(tx, orgA).markSent(randomUUID(), "SM_x")),
    ).rejects.toThrow(/matched no message row/);
  });

  it("markSent and markFailed settle a claim in place", async () => {
    const orgA = asOrgId(orgAId);
    const key = `okq-int-${randomUUID()}-fu2`;

    const claim = await withTenant(orgA, (tx) =>
      new DrizzleMessageRepository(tx, orgA).claimOutbound({
        id: randomUUID(),
        leadId: asLeadId(leadAId),
        sentByUserId: null,
        from: "+15005550006",
        to: "+15555550199",
        body: "follow-up",
        idempotencyKey: key,
      }),
    );
    const id = claim.message.props.id;

    await withTenant(orgA, (tx) => new DrizzleMessageRepository(tx, orgA).markSent(id, "SM_int_sid"));
    const [sent] = await admin<{ status: string; provider_sid: string | null }[]>`
      select status, provider_sid from messages where id = ${id}`;
    expect(sent!.status).toBe("sent");
    expect(sent!.provider_sid).toBe("SM_int_sid");

    await withTenant(orgA, (tx) => new DrizzleMessageRepository(tx, orgA).markFailed(id, "30034"));
    const [failed] = await admin<{ status: string; error_code: string | null }[]>`
      select status, error_code from messages where id = ${id}`;
    expect(failed!.status).toBe("failed");
    expect(failed!.error_code).toBe("30034");
  });

  // ── The field gate: a tech reaches exactly the threads for customers they're scheduled on ──
  //
  // "When a tech gets scheduled on the job they should have access to all past and future
  // messages" — the assignment (job-level assignee OR any visit assignee) is the grant. An
  // unassigned tech sees an empty inbox and NOT_FOUND per-thread: scoped, never the whole book.
  describe("tech thread access", () => {
    let techId = "";
    let officeId = "";
    let leadCId = ""; // a second customer the tech is NOT assigned to

    beforeAll(async () => {
      const [tech] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role, name)
        values (${orgAId}, ${randomUUID()}, ${"tech-" + randomUUID() + "@e2e.test"}, 'tech', 'Dana Fieldtech')
        returning id`;
      techId = tech!.id;
      const [office] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role, name)
        values (${orgAId}, ${randomUUID()}, ${"office-" + randomUUID() + "@e2e.test"}, 'office', 'Priya Office')
        returning id`;
      officeId = office!.id;

      // Job for leadA assigned to the tech AT THE JOB LEVEL.
      await admin`
        insert into jobs (org_id, num, lead_id, title, assignee_user_id)
        values (${orgAId}, ${"J-" + randomUUID().slice(0, 8)}, ${leadAId}, 'Water heater swap', ${techId})`;

      // A second customer with a thread the tech has NO assignment on.
      const [leadC] = await admin<{ id: string }[]>`
        insert into leads (org_id, name, phone_e164)
        values (${orgAId}, 'Unassigned Customer', '+15555550166')
        returning id`;
      leadCId = leadC!.id;
      await admin`
        insert into messages (org_id, lead_id, direction, channel, body, from_number, to_number, status)
        values (${orgAId}, ${leadCId}, 'inbound', 'sms', 'is anyone coming?', '+15555550166', '+15005550006', 'received')`;
      // And make sure leadA has at least one message so the inbox has a row to show.
      await admin`
        insert into messages (org_id, lead_id, direction, channel, body, from_number, to_number, status, sent_by_user_id)
        values (${orgAId}, ${leadAId}, 'outbound', 'sms', 'On our way.', '+15005550006', '+15555550155', 'sent', ${officeId})`;
    });

    it("an assigned tech's inbox holds THEIR customer's thread — and not the other one", async () => {
      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", techId));
      const conversations = await caller.v1.messaging.listConversations();
      const leadIds = conversations.map((c) => c.leadId);
      expect(leadIds).toContain(leadAId);
      expect(leadIds).not.toContain(leadCId);
    });

    it("the office still sees every thread, unscoped", async () => {
      const caller = appRouter.createCaller(ctxForUser(orgAId, "office", officeId));
      const leadIds = (await caller.v1.messaging.listConversations()).map((c) => c.leadId);
      expect(leadIds).toContain(leadAId);
      expect(leadIds).toContain(leadCId);
    });

    it("an assigned tech reads the whole thread, and outbound rows carry the sender's name", async () => {
      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", techId));
      const thread = await caller.v1.messaging.listByLead({ leadId: leadAId });
      expect(thread.length).toBeGreaterThan(0);
      const attributed = thread.find((m) => m.senderName !== null);
      expect(attributed?.senderName).toBe("Priya Office");
    });

    it("an unassigned tech gets NOT_FOUND on the thread — and on send, before any telephony read", async () => {
      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", techId));
      await expect(caller.v1.messaging.listByLead({ leadId: leadCId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        caller.v1.messaging.send({ leadId: leadCId, body: "hi" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a VISIT-level assignment opens the thread too — the board's multi-visit shape counts", async () => {
      const [tech2] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgAId}, ${randomUUID()}, ${"tech2-" + randomUUID() + "@e2e.test"}, 'tech')
        returning id`;
      const [job] = await admin<{ id: string }[]>`
        insert into jobs (org_id, num, lead_id, title)
        values (${orgAId}, ${"J-" + randomUUID().slice(0, 8)}, ${leadCId}, 'Return visit')
        returning id`;
      await admin`
        insert into job_visits (org_id, job_id, assignee_user_id)
        values (${orgAId}, ${job!.id}, ${tech2!.id})`;

      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", tech2!.id));
      const thread = await caller.v1.messaging.listByLead({ leadId: leadCId });
      expect(thread.length).toBeGreaterThan(0);
    });

    it("markThreadRead: an assigned tech clears the shared unread flag", async () => {
      await admin`update leads set unread = true where id = ${leadAId}`;
      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", techId));
      const out = await caller.v1.messaging.markThreadRead({ leadId: leadAId });
      expect(out.cleared).toBe(true);
      const [row] = await admin<{ unread: boolean }[]>`select unread from leads where id = ${leadAId}`;
      expect(row!.unread).toBe(false);
    });

    it("markThreadRead: an unassigned tech cannot touch the flag", async () => {
      const caller = appRouter.createCaller(ctxForUser(orgAId, "tech", techId));
      await expect(caller.v1.messaging.markThreadRead({ leadId: leadCId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
