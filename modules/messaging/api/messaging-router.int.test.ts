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

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
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

suite("messaging tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

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
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
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

  it("a tech cannot list conversations (FORBIDDEN)", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.messaging.listConversations(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  it("a tech cannot send messages (FORBIDDEN)", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.messaging.send({ leadId: leadAId, body: "Hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a tech cannot list thread (FORBIDDEN)", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.messaging.listByLead({ leadId: leadAId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
});
