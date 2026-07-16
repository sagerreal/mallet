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

  it("owner creates a template with typed/required items and lists it back ordered", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({
      name: "Water heater",
      trade: "Plumbing",
      stage: "job",
      match: ["water heater"],
      items: [
        { text: "Photo of the finished install", type: "photo" },
        { text: "Test T&P valve", type: "check", required: true },
      ],
    });
    expect(chk.name).toBe("Water heater");
    expect(chk.items.map((i) => i.position)).toEqual([0, 1]);
    expect(chk.items[0]!.type).toBe("photo");
    expect(chk.items[1]!.required).toBe(true);

    const listed = await caller.v1.checklists.list({ limit: 50 });
    const found = listed.items.find((c) => c.id === chk.id);
    expect(found?.items).toHaveLength(2);
  });

  it("create with items[] persists template + ordered items in ONE call (the pasted-list path)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({
      name: "Drain call close-out",
      stage: "job",
      items: [
        { text: "Photo of the cleared line", type: "photo", required: true },
        { text: "Flow tested after clearing", type: "check", required: true },
        { text: "Work area wiped down", type: "check", required: true },
      ],
    });
    expect(chk.items).toHaveLength(3);
    expect(chk.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(chk.items[0]).toMatchObject({ text: "Photo of the cleared line", type: "photo", required: true });

    // Round-trips through list — the items were committed, not just echoed.
    const listed = await caller.v1.checklists.list({ limit: 100 });
    const found = listed.items.find((c) => c.id === chk.id);
    expect(found?.items).toHaveLength(3);
  });

  it("remove archives the whole template (gone from list, items and all)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({
      name: "Repipe",
      stage: "scope",
      items: [{ text: "Access notes", type: "check" }],
    });
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

  it("org B cannot remove org A's template (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await callerA.v1.checklists.create({ name: "RLS Boundary", stage: "job" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(callerB.v1.checklists.remove({ checklistId: chk.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rejects an empty name with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(caller.v1.checklists.create({ name: "   ", stage: "job" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create rejects duplicate client item ids with BAD_REQUEST (not a PK 500)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const dup = randomUUID();
    await expect(
      caller.v1.checklists.create({
        name: "Dup ids",
        stage: "job",
        items: [
          { id: dup, text: "First", type: "check" },
          { id: dup, text: "Second", type: "check" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a tech is forbidden from checklist mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.checklists.create({ name: "Nope", stage: "job" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("update replaces name + items; findById shows the new state and trade/stage/match unchanged", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await caller.v1.checklists.create({
      name: "Drain close-out",
      trade: "Plumbing",
      stage: "job",
      match: ["drain"],
      items: [
        { text: "Old photo", type: "photo" },
        { text: "Old check", type: "check", required: true },
      ],
    });
    expect(chk.items).toHaveLength(2);

    const updated = await caller.v1.checklists.update({
      checklistId: chk.id,
      name: "Drain close-out v2",
      items: [
        { text: "New photo", type: "photo", required: true },
        { text: "New check A", type: "check" },
        { text: "New check B", type: "check" },
      ],
    });
    expect(updated.name).toBe("Drain close-out v2");
    expect(updated.items).toHaveLength(3);
    expect(updated.items.map((i) => i.text)).toEqual(["New photo", "New check A", "New check B"]);
    expect(updated.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(updated.trade).toBe("Plumbing");
    expect(updated.stage).toBe("job");
    expect(updated.match).toEqual(["drain"]);

    // Round-trip via list confirms persistence.
    const listed = await caller.v1.checklists.list({ limit: 500 });
    const found = listed.items.find((c) => c.id === chk.id);
    expect(found?.name).toBe("Drain close-out v2");
    expect(found?.items).toHaveLength(3);
  });

  it("update returns NOT_FOUND for a non-existent checklistId", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.checklists.update({
        checklistId: randomUUID(),
        name: "Ghost",
        items: [{ text: "Step", type: "check" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update is blocked for org B trying to modify org A's template (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const chk = await callerA.v1.checklists.create({ name: "RLS Update Boundary", stage: "job" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.checklists.update({
        checklistId: chk.id,
        name: "Hijacked",
        items: [{ text: "Hijacked step", type: "check" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
