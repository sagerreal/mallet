import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Capstone: exercise the full timesheets stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, userId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
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

suite("timesheets tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let techAId = "";
  let techBId = "";
  let ownerAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TEApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TEApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const [ta] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'techA@test.test', 'tech', true) returning id`;
    techAId = ta!.id;

    const [tb] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'techB@test.test', 'tech', true) returning id`;
    techBId = tb!.id;

    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'owner@test.test', 'owner', false) returning id`;
    ownerAId = ow!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── create + list round-trip ──────────────────────────────────────────────────

  it("owner creates an entry and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const created = await caller.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-07",
      kind: "job",
      startTime: "08:00",
      endTime: "12:00",
    });
    expect(created.workDate).toBe("2026-07-07");
    expect(created.kind).toBe("job");
    expect(created.status).toBe("draft");

    const listed = await caller.v1.timesheets.list({ limit: 50 });
    expect(listed.items.some((e) => e.id === created.id)).toBe(true);
  });

  it("tech creates their own entry", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    const created = await caller.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-08",
      kind: "travel",
      startTime: "07:30",
      endTime: "08:00",
    });
    expect(created.techUserId).toBe(techAId);
    expect(created.kind).toBe("travel");
  });

  // ── tech list sees only their own entries ─────────────────────────────────────

  it("tech listing returns only their own entries", async () => {
    const callerOwner = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    // Create an entry for techB as owner.
    await callerOwner.v1.timesheets.create({
      techUserId: techBId,
      workDate: "2026-07-09",
      kind: "shop",
      startTime: "09:00",
      endTime: "10:00",
    });
    // Create an entry for techA.
    await callerOwner.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-09",
      kind: "job",
      startTime: "10:00",
      endTime: "11:00",
    });

    const callerTechA = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    const result = await callerTechA.v1.timesheets.list({ limit: 100 });

    // All entries returned must belong to techA.
    expect(result.items.every((e) => e.techUserId === techAId)).toBe(true);
    // techB's entry should not appear.
    expect(result.items.some((e) => e.techUserId === techBId)).toBe(false);
  });

  it("owner listing can see all entries in the org", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const result = await caller.v1.timesheets.list({ limit: 200 });
    // Owner should see entries from at least two different techs.
    const techIds = new Set(result.items.map((e) => e.techUserId));
    expect(techIds.size).toBeGreaterThanOrEqual(2);
  });

  // ── FORBIDDEN: tech creating for another tech ─────────────────────────────────

  it("tech creating for another tech's userId → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    await expect(
      caller.v1.timesheets.create({
        techUserId: techBId, // NOT techAId
        workDate: "2026-07-10",
        kind: "job",
        startTime: "08:00",
        endTime: "12:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  it("tech can update their own entry", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    const created = await caller.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-10",
      kind: "job",
      startTime: "08:00",
      endTime: "12:00",
    });
    const updated = await caller.v1.timesheets.update({
      entryId: created.id,
      note: "Updated note",
    });
    expect(updated.note).toBe("Updated note");
  });

  it("tech editing another tech's entry → FORBIDDEN", async () => {
    const callerOwner = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const created = await callerOwner.v1.timesheets.create({
      techUserId: techBId,
      workDate: "2026-07-10",
      kind: "job",
      startTime: "08:00",
      endTime: "12:00",
    });

    const callerTechA = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    await expect(
      callerTechA.v1.timesheets.update({ entryId: created.id, note: "Mallory" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner can edit any entry", async () => {
    const callerOwner = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const created = await callerOwner.v1.timesheets.create({
      techUserId: techBId,
      workDate: "2026-07-11",
      kind: "shop",
      startTime: "09:00",
      endTime: "10:00",
    });
    const updated = await callerOwner.v1.timesheets.update({
      entryId: created.id,
      note: "Manager edited",
    });
    expect(updated.note).toBe("Manager edited");
  });

  // ── remove ────────────────────────────────────────────────────────────────────

  it("tech can remove their own entry", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    const created = await caller.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-12",
      kind: "break",
      startTime: "10:00",
      endTime: "10:15",
    });
    const result = await caller.v1.timesheets.remove({ entryId: created.id });
    expect(result.ok).toBe(true);
  });

  it("tech removing another tech's entry → FORBIDDEN", async () => {
    const callerOwner = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const created = await callerOwner.v1.timesheets.create({
      techUserId: techBId,
      workDate: "2026-07-12",
      kind: "job",
      startTime: "08:00",
      endTime: "12:00",
    });

    const callerTechA = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    await expect(
      callerTechA.v1.timesheets.remove({ entryId: created.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── approveWeek ────────────────────────────────────────────────────────────────

  it("owner approves a week of draft entries for a tech", async () => {
    const callerOwner = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    // Seed two draft entries.
    await callerOwner.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-14",
      kind: "job",
      startTime: "08:00",
      endTime: "17:00",
    });
    await callerOwner.v1.timesheets.create({
      techUserId: techAId,
      workDate: "2026-07-15",
      kind: "job",
      startTime: "08:00",
      endTime: "17:00",
    });

    const result = await callerOwner.v1.timesheets.approveWeek({
      techUserId: techAId,
      dates: ["2026-07-14", "2026-07-15"],
    });
    expect(result.approved).toBeGreaterThanOrEqual(2);
  });

  it("tech calling approveWeek → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, techAId, "tech"));
    await expect(
      caller.v1.timesheets.approveWeek({ techUserId: techAId, dates: ["2026-07-14"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Verify it's a TRPCError, not an accidental throw.
    await caller.v1.timesheets
      .approveWeek({ techUserId: techAId, dates: ["2026-07-14"] })
      .catch((e) => {
        expect(e).toBeInstanceOf(TRPCError);
      });
  });

  // ── cross-org isolation ────────────────────────────────────────────────────────

  it("org B sees nothing from org A (RLS isolation)", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, randomUUID(), "owner"));
    const listed = await callerB.v1.timesheets.list({ limit: 100 });
    expect(listed.items).toHaveLength(0);
  });

  it("update on unknown entryId → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    await expect(
      caller.v1.timesheets.update({ entryId: randomUUID(), note: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("remove on unknown entryId → NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    await expect(
      caller.v1.timesheets.remove({ entryId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── client-authored id ─────────────────────────────────────────────────────────

  it("create with client-authored id uses that id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, ownerAId, "owner"));
    const myId = randomUUID();
    const created = await caller.v1.timesheets.create({
      id: myId,
      techUserId: techAId,
      workDate: "2026-07-16",
      kind: "job",
      startTime: "08:00",
      endTime: "17:00",
    });
    expect(created.id).toBe(myId);
  });
});
