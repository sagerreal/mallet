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

// The edit-delta mining loop over the full stack: draft (with the ai_draft
// snapshot) → send → deterministic diff → PROPOSED rule. One observation stays
// hidden; a second independent recurrence surfaces it; an idempotent re-send
// never double-counts; hand-built estimates mine nothing.
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

// The AI drafted $200/h; the office keeps sending it at $150/h.
const AI_LINES = [{ description: "Water heater swap labor", quantity: 5, rateCents: 20_000 }];
const SENT_LINES = [{ description: "Water heater swap labor", quantity: 5, rateCents: 15_000 }];

suite("edit-delta mining on send (full stack, live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Mining ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Cust M') returning id`;
    leadId = l!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("mines a proposed rule at send, surfaces it only after 2 recurrences, and never double-counts a re-send", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));

    // First AI-originated send: office repriced the AI's line down >10%.
    const first = await caller.v1.quoting.draft({
      leadId,
      title: "WH swap 1",
      lines: SENT_LINES,
      aiDraft: { lines: AI_LINES },
    });
    await caller.v1.quoting.send({ estimateId: first.id });

    // One observation: the proposal exists but does NOT surface in the queue.
    let listed = await caller.v1.quoting.rules.list();
    expect(listed.proposed).toHaveLength(0);
    expect(listed.confirmed).toHaveLength(0);
    const [rowAfterFirst] = await admin<{ times_confirmed: number; status: string; source: string }[]>`
      select times_confirmed, status, source from quoting_rules where org_id = ${orgId}`;
    expect(rowAfterFirst).toMatchObject({ times_confirmed: 1, status: "proposed", source: "edit_delta" });

    // Idempotent re-send: no new observation, no bump.
    await caller.v1.quoting.send({ estimateId: first.id });
    const [afterResend] = await admin<{ times_confirmed: number }[]>`
      select times_confirmed from quoting_rules where org_id = ${orgId}`;
    expect(afterResend!.times_confirmed).toBe(1);

    // Second independent estimate with the same correction: bump to 2 → queue.
    const second = await caller.v1.quoting.draft({
      leadId,
      title: "WH swap 2",
      lines: SENT_LINES,
      aiDraft: { lines: AI_LINES },
    });
    await caller.v1.quoting.send({ estimateId: second.id });

    listed = await caller.v1.quoting.rules.list();
    expect(listed.proposed).toHaveLength(1);
    expect(listed.proposed[0]).toMatchObject({
      source: "edit_delta",
      status: "proposed",
      timesConfirmed: 2,
    });
    expect(listed.proposed[0]!.rule).toContain("Price down:");
  });

  it("a hand-built estimate (no ai_draft) mines nothing", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const rulesBefore = await admin<{ count: string }[]>`
      select count(*) as count from quoting_rules where org_id = ${orgId}`;

    const drafted = await caller.v1.quoting.draft({
      leadId,
      title: "Hand-built",
      lines: [{ description: "Manual line", quantity: 1, rateCents: 9_900 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });

    const rulesAfter = await admin<{ count: string }[]>`
      select count(*) as count from quoting_rules where org_id = ${orgId}`;
    expect(rulesAfter[0]!.count).toBe(rulesBefore[0]!.count);
  });

  it("the ai_draft snapshot is write-once (a later save never clobbers it)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId,
      title: "Snapshot",
      lines: SENT_LINES,
      aiDraft: { lines: AI_LINES },
    });
    const [row] = await admin<{ ai_draft: { lines: unknown[]; at: string } | null }[]>`
      select ai_draft from estimates where id = ${drafted.id}`;
    expect(row!.ai_draft?.lines).toHaveLength(1);

    // Accept commits new lines (a save) — the snapshot must survive untouched.
    await caller.v1.quoting.send({ estimateId: drafted.id });
    await caller.v1.quoting.accept({ estimateId: drafted.id });
    const [after] = await admin<{ ai_draft: { at: string } | null }[]>`
      select ai_draft from estimates where id = ${drafted.id}`;
    expect(after!.ai_draft?.at).toBe(row!.ai_draft?.at);
  });
});
