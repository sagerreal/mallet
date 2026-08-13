import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role, AuthProvider } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * Staff chat against the LIVE schema and real RLS.
 *
 * This file carries more weight than most router suites: thread MEMBERSHIP is enforced in the
 * application layer, not by RLS (the tenant session knows an org, not a user), so these tests
 * ARE the privacy boundary. Every one of them asks a question a nosy employee would ask.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, userId: string, role: Role = "tech"): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: null,
    chatFileGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  } as unknown as Context["deps"],
});

suite("v1.teamChat (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  // Org A: Dana (tech), Mike (tech), Priya (office). Org B: one stranger.
  let danaId = "";
  let mikeId = "";
  let priyaId = "";
  let strangerId = "";

  const seedUser = async (orgId: string, role: Role, name: string): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, name)
      values (${orgId}, ${randomUUID()}, ${`${randomUUID()}@e2e.test`}, ${role}, ${name})
      returning id`;
    return row!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TeamChat A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TeamChat B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    danaId = await seedUser(orgAId, "tech", "Dana Alvarez");
    mikeId = await seedUser(orgAId, "tech", "Mike Rivera");
    priyaId = await seedUser(orgAId, "office", "Priya Anand");
    strangerId = await seedUser(orgBId, "owner", "Other Shop");
  });

  afterAll(async () => {
    if (orgAId) {
      // team_thread_members and team_messages composite-FK onto users with no ON DELETE action
      // on the author/creator side, so drain the chat tables before the org cascade reaches
      // users (the same diamond-cascade trap visit-router.int.test.ts documents).
      await admin`delete from team_messages where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from team_thread_members where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from team_threads where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── the roster ───────────────────────────────────────────────────────────────────────────────

  it("a TECH can list coworkers to start a chat — and the roster carries no pay data", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, danaId, "tech"));
    const roster = await caller.v1.teamChat.roster();
    const names = roster.map((r) => r.name);
    expect(names).toContain("Mike Rivera");
    expect(names).toContain("Priya Anand");
    // Yourself is not someone you message.
    expect(names).not.toContain("Dana Alvarez");
    // The shape is who-you-are only: identity.members carries costRateCents, this must not.
    expect(Object.keys(roster[0]!).sort()).toEqual(["name", "role", "userId"]);
  });

  it("the roster is org-scoped — another shop's people are not in it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, danaId, "tech"));
    const roster = await caller.v1.teamChat.roster();
    expect(roster.map((r) => r.name)).not.toContain("Other Shop");
  });

  // ── DMs ──────────────────────────────────────────────────────────────────────────────────────

  it("startDm is find-or-create: messaging the same person twice reuses ONE thread", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const first = await dana.v1.teamChat.startDm({ userId: mikeId });
    const second = await dana.v1.teamChat.startDm({ userId: mikeId });
    expect(second.threadId).toBe(first.threadId);
  });

  it("the DM does not fork when the OTHER person opens it — same thread, either direction", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const mike = appRouter.createCaller(ctxFor(orgAId, mikeId));
    const fromDana = await dana.v1.teamChat.startDm({ userId: mikeId });
    const fromMike = await mike.v1.teamChat.startDm({ userId: danaId });
    expect(fromMike.threadId).toBe(fromDana.threadId);
  });

  it("cannot DM yourself, or anyone outside the shop", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    await expect(dana.v1.teamChat.startDm({ userId: danaId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(dana.v1.teamChat.startDm({ userId: strangerId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ── the privacy boundary ─────────────────────────────────────────────────────────────────────

  it("a third person cannot read, post to, mark, or leave a DM they are not in", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    await dana.v1.teamChat.send({ threadId, body: "the Reyes panel is toast" });

    // Priya is OFFICE — the highest non-owner role — and still cannot see a DM she is not in.
    const priya = appRouter.createCaller(ctxFor(orgAId, priyaId, "office"));
    for (const attempt of [
      () => priya.v1.teamChat.listMessages({ threadId }),
      () => priya.v1.teamChat.send({ threadId, body: "hello" }),
      () => priya.v1.teamChat.markRead({ threadId }),
      () => priya.v1.teamChat.leave({ threadId }),
      () => priya.v1.teamChat.addMembers({ threadId, userIds: [priyaId] }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // And it is absent from her inbox entirely.
    const inbox = await priya.v1.teamChat.listThreads();
    expect(inbox.map((t) => t.id)).not.toContain(threadId);
  });

  it("another ORG cannot touch the thread at all (RLS floor beneath the membership gate)", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    const stranger = appRouter.createCaller(ctxFor(orgBId, strangerId, "owner"));
    await expect(stranger.v1.teamChat.listMessages({ threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await stranger.v1.teamChat.listThreads()).toHaveLength(0);
  });

  // ── groups ───────────────────────────────────────────────────────────────────────────────────

  it("a group is readable by its members and carries every member's name", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.createGroup({
      title: "Friday van checks",
      userIds: [mikeId, priyaId],
    });
    await dana.v1.teamChat.send({ threadId, body: "inspections before dispatch" });

    const mike = appRouter.createCaller(ctxFor(orgAId, mikeId));
    const thread = (await mike.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    expect(thread?.title).toBe("Friday van checks");
    expect(thread?.members.map((m) => m.name).sort()).toEqual([
      "Dana Alvarez",
      "Mike Rivera",
      "Priya Anand",
    ]);
  });

  it("membership is EDITABLE — the thing Housecall Pro documents it cannot do", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.createGroup({
      title: "Ridgeline repipe",
      userIds: [mikeId],
    });
    await dana.v1.teamChat.send({ threadId, body: "day one done" });

    // Priya cannot see it yet…
    const priya = appRouter.createCaller(ctxFor(orgAId, priyaId, "office"));
    await expect(priya.v1.teamChat.listMessages({ threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // …then she is added, and can.
    await dana.v1.teamChat.addMembers({ threadId, userIds: [priyaId] });
    const seen = await priya.v1.teamChat.listMessages({ threadId });
    expect(seen.map((m) => m.body)).toContain("day one done");
  });

  it("a new group member starts with a CLEAN badge, not the whole backlog", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.createGroup({
      title: "Backlog test",
      userIds: [mikeId],
    });
    for (const body of ["one", "two", "three"]) {
      await dana.v1.teamChat.send({ threadId, body });
    }
    await dana.v1.teamChat.addMembers({ threadId, userIds: [priyaId] });

    const priya = appRouter.createCaller(ctxFor(orgAId, priyaId, "office"));
    const row = (await priya.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    // She can read the history…
    expect((await priya.v1.teamChat.listMessages({ threadId })).length).toBe(3);
    // …but she is not shown 3 unread messages from before she joined.
    expect(row?.unreadCount).toBe(0);
  });

  it("leaving closes access, and history keeps what was said", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.createGroup({
      title: "Leavers",
      userIds: [mikeId],
    });
    await dana.v1.teamChat.send({ threadId, body: "still here" });

    const mike = appRouter.createCaller(ctxFor(orgAId, mikeId));
    expect(await mike.v1.teamChat.leave({ threadId })).toEqual({ left: true });
    await expect(mike.v1.teamChat.listMessages({ threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The message survives for the people still in it.
    expect((await dana.v1.teamChat.listMessages({ threadId })).map((m) => m.body)).toContain(
      "still here",
    );
  });

  it("a DM cannot be turned into a group by adding a third person", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    await expect(
      dana.v1.teamChat.addMembers({ threadId, userIds: [priyaId] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── unread state, per person ─────────────────────────────────────────────────────────────────

  it("unread is PER USER: the sender's badge stays clear, the recipient's lights up", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const mike = appRouter.createCaller(ctxFor(orgAId, mikeId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    await dana.v1.teamChat.send({ threadId, body: "bringing the 40 gal" });

    const danaRow = (await dana.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    const mikeRow = (await mike.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    expect(danaRow?.unreadCount).toBe(0);
    expect(mikeRow?.unreadCount).toBeGreaterThan(0);

    // Mike reading it clears HIS badge only — and does not touch Dana's.
    await mike.v1.teamChat.markRead({ threadId });
    const afterMike = (await mike.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    expect(afterMike?.unreadCount).toBe(0);
  });

  it("one person reading a GROUP does not clear it for everybody else", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.createGroup({
      title: "Shared read state",
      userIds: [mikeId, priyaId],
    });
    await dana.v1.teamChat.send({ threadId, body: "who has the sewer camera" });

    const mike = appRouter.createCaller(ctxFor(orgAId, mikeId));
    const priya = appRouter.createCaller(ctxFor(orgAId, priyaId, "office"));
    await mike.v1.teamChat.markRead({ threadId });

    const mikeRow = (await mike.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    const priyaRow = (await priya.v1.teamChat.listThreads()).find((t) => t.id === threadId);
    expect(mikeRow?.unreadCount).toBe(0);
    // This is the Workiz complaint, asserted as a non-regression.
    expect(priyaRow?.unreadCount).toBeGreaterThan(0);
  });

  it("the inbox sorts by latest activity and previews the last line", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const older = await dana.v1.teamChat.createGroup({ title: "Older", userIds: [mikeId] });
    await dana.v1.teamChat.send({ threadId: older.threadId, body: "first" });
    const newer = await dana.v1.teamChat.createGroup({ title: "Newer", userIds: [mikeId] });
    await dana.v1.teamChat.send({ threadId: newer.threadId, body: "second" });

    const inbox = await dana.v1.teamChat.listThreads();
    const positions = [
      inbox.findIndex((t) => t.id === newer.threadId),
      inbox.findIndex((t) => t.id === older.threadId),
    ];
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(inbox.find((t) => t.id === newer.threadId)?.lastBody).toBe("second");
  });

  // ── messages ─────────────────────────────────────────────────────────────────────────────────

  it("messages read oldest-first and carry the sender's display name", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: priyaId });
    await dana.v1.teamChat.send({ threadId, body: "one" });
    await dana.v1.teamChat.send({ threadId, body: "two" });

    const thread = await dana.v1.teamChat.listMessages({ threadId });
    expect(thread.map((m) => m.body)).toEqual(["one", "two"]);
    expect(thread[0]!.senderName).toBe("Dana Alvarez");
  });

  it("an empty message is refused — a row must carry words or a photo", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    await expect(dana.v1.teamChat.send({ threadId, body: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("an attachment path from ANOTHER thread is refused, not grafted on", async () => {
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const mine = await dana.v1.teamChat.startDm({ userId: mikeId });
    const other = await dana.v1.teamChat.createGroup({ title: "Other", userIds: [priyaId] });

    await expect(
      dana.v1.teamChat.send({
        threadId: mine.threadId,
        body: "look",
        // A real-looking key, but minted for a different conversation.
        attachment: {
          path: `${orgAId}/${other.threadId}/${randomUUID()}.jpg`,
          mediaType: "image/jpeg",
          bytes: 1024,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("attachment endpoints answer PRECONDITION_FAILED when storage is unconfigured", async () => {
    // chatFileGateway is null in this fixture — the honest dark state, not a half-working upload.
    const dana = appRouter.createCaller(ctxFor(orgAId, danaId));
    const { threadId } = await dana.v1.teamChat.startDm({ userId: mikeId });
    await expect(
      dana.v1.teamChat.attachmentUploadUrl({ threadId, objectId: randomUUID(), ext: "jpg" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
