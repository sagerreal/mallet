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

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => { throw new Error("authProvider should not be called in createCaller tests"); },
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
    paymentLinkGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },
  },
});

suite("checklists tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('ChkApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('ChkApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("owner creates a template, adds items, toggles required, lists it back with ordered items", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({ name: "Water heater", trade: "Plumbing", stage: "job", match: ["water heater"] });
    expect(chk.name).toBe("Water heater");
    expect(chk.items).toHaveLength(0);

    const withPhoto = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Photo of the finished install", type: "photo" });
    const withCheck = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Test T&P valve", type: "check" });
    expect(withCheck.items.map((i) => i.position)).toEqual([0, 1]);
    expect(withPhoto.items[0]!.type).toBe("photo");

    const toggled = await caller.v1.checklists.setItemRequired({ checklistId: chk.id, itemId: withCheck.items[1]!.id, required: true });
    expect(toggled.items[1]!.required).toBe(true);

    const listed = await caller.v1.checklists.list({ limit: 50 });
    const found = listed.items.find((c) => c.id === chk.id);
    expect(found?.items).toHaveLength(2);
  });

  it("removeItem soft-deletes one item; remove archives the whole template", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({ name: "Repipe", stage: "scope" });
    const withItem = await caller.v1.checklists.addItem({ checklistId: chk.id, text: "Access notes", type: "check" });
    const afterRemove = await caller.v1.checklists.removeItem({ checklistId: chk.id, itemId: withItem.items[0]!.id });
    expect(afterRemove.items).toHaveLength(0);

    const gone = await caller.v1.checklists.remove({ checklistId: chk.id });
    expect(gone.ok).toBe(true);
    const listed = await caller.v1.checklists.list({ limit: 500 });
    expect(listed.items.some((c) => c.id === chk.id)).toBe(false);
  });

  it("a different org sees none of org A's templates", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await callerB.v1.checklists.list({ limit: 500 });
    expect(listed.items).toHaveLength(0);
  });

  it("org B cannot addItem/remove org A's template (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await callerA.v1.checklists.create({ name: "RLS Boundary", stage: "job" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(callerB.v1.checklists.addItem({ checklistId: chk.id, text: "x", type: "check" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.checklists.remove({ checklistId: chk.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rejects an empty name with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(caller.v1.checklists.create({ name: "   ", stage: "job" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a tech is forbidden from checklist mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.checklists.create({ name: "Nope", stage: "job" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
