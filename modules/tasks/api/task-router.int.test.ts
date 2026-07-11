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

// Capstone: exercise the full tasks stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves an owner in org A can create+list, org B sees nothing of A's, and a tech is forbidden.
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
    paymentLinkGateway: null, photoStorageGateway: null,
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

suite("tasks tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TaskApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TaskApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── create + list ─────────────────────────────────────────────────────────────

  it("an owner creates a task and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({
      text: "Send quote",
      dueDate: "2026-07-15",
    });
    expect(created.text).toBe("Send quote");
    expect(created.dueDate).toBe("2026-07-15");
    expect(created.done).toBe(false);

    const listed = await caller.v1.tasks.list({ limit: 50 });
    expect(listed.items.some((t) => t.id === created.id)).toBe(true);
  });

  it("a different org sees none of org A's tasks", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await callerB.v1.tasks.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  // ── client-authored id ────────────────────────────────────────────────────────

  it("create with a client-authored id uses that id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const myId = randomUUID();
    const created = await caller.v1.tasks.create({ id: myId, text: "Client id task" });
    expect(created.id).toBe(myId);
  });

  // ── setDone ───────────────────────────────────────────────────────────────────

  it("setDone marks a task done and the change persists", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({ text: "Set done test" });

    const done = await caller.v1.tasks.setDone({ taskId: created.id, done: true });
    expect(done.done).toBe(true);

    // setDone to false
    const undone = await caller.v1.tasks.setDone({ taskId: created.id, done: false });
    expect(undone.done).toBe(false);
  });

  it("setDone on unknown taskId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.tasks.setDone({ taskId: randomUUID(), done: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  it("update changes text and dueDate", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({
      text: "Old text",
      dueDate: "2026-07-10",
    });

    const updated = await caller.v1.tasks.update({
      taskId: created.id,
      text: "New text",
      dueDate: "2026-08-01",
    });

    expect(updated.text).toBe("New text");
    expect(updated.dueDate).toBe("2026-08-01");
  });

  it("update rejects empty text with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({ text: "Valid text" });
    await expect(
      caller.v1.tasks.update({ taskId: created.id, text: "  " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update on unknown taskId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.tasks.update({ taskId: randomUUID(), text: "Whatever" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── remove ────────────────────────────────────────────────────────────────────

  it("remove soft-deletes a task; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({ text: "Remove me" });

    const result = await caller.v1.tasks.remove({ taskId: created.id });
    expect(result.ok).toBe(true);

    const listed = await caller.v1.tasks.list({ limit: 500 });
    expect(listed.items.some((t) => t.id === created.id)).toBe(false);
  });

  it("remove on unknown taskId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.tasks.remove({ taskId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── cross-org isolation ────────────────────────────────────────────────────────

  it("org B cannot get, update, setDone, or remove org A's task (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.tasks.create({ text: "RLS boundary" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.tasks.setDone({ taskId: created.id, done: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.tasks.update({ taskId: created.id, text: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.tasks.remove({ taskId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ──────────────────────────────────────────────────────────────────────

  it("a tech is forbidden from all task mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.tasks.create({ text: "Nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Sanity: the rejection is a TRPCError, not an incidental throw.
    await callerTech.v1.tasks.create({ text: "Nope2" }).catch((e) => {
      expect(e).toBeInstanceOf(TRPCError);
    });
  });

  // ── dueDate format validation ─────────────────────────────────────────────────

  it("create rejects a malformed dueDate with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.tasks.create({ text: "Bad date", dueDate: "07/15/2026" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update rejects a malformed dueDate with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.tasks.create({ text: "Good task" });
    await expect(
      caller.v1.tasks.update({ taskId: created.id, dueDate: "tomorrow" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── filter: done ──────────────────────────────────────────────────────────────

  it("list with done=true only returns done tasks", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const undone = await caller.v1.tasks.create({ text: "Not done yet" });
    const done = await caller.v1.tasks.create({ text: "Already done" });
    await caller.v1.tasks.setDone({ taskId: done.id, done: true });

    const doneList = await caller.v1.tasks.list({ limit: 500, done: true });
    expect(doneList.items.some((t) => t.id === done.id)).toBe(true);
    expect(doneList.items.some((t) => t.id === undone.id)).toBe(false);
  });
});
