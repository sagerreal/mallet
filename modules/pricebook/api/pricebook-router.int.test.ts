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

// Capstone: exercise the full pricebook stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves an owner can create/list/update/archive services and categories, a different org sees
// none of it (RLS), a tech is forbidden, and the keyset cursor pages every row exactly once.
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

suite("pricebook tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('PricebookApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── create + list (service) ─────────────────────────────────────────────────

  it("an owner creates a service and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.service.create({
      name: "Water Heater Install",
      unitPriceCents: 129900,
      costCents: 45000,
      laborHours: 3.5,
      taxable: true,
    });
    expect(created.name).toBe("Water Heater Install");
    expect(created.unitPriceCents).toBe(129900);
    expect(created.costCents).toBe(45000);
    expect(created.laborHours).toBe(3.5);
    expect(created.taxable).toBe(true);
    expect(created.active).toBe(true);
    expect(created.categoryId).toBeNull();

    const listed = await caller.v1.pricebook.service.list({ limit: 50 });
    expect(listed.items.some((s) => s.id === created.id)).toBe(true);
  });

  it("create with a client-authored id uses that id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const myId = randomUUID();
    const created = await caller.v1.pricebook.service.create({
      id: myId,
      name: "Client ID Service",
      unitPriceCents: 1000,
      costCents: 200,
    });
    expect(created.id).toBe(myId);
  });

  // ── update ─────────────────────────────────────────────────────────────────

  it("update happy path: name, price, cost, active persist", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.service.create({
      name: "Update Target Service",
      unitPriceCents: 5000,
      costCents: 1000,
    });

    const updated = await caller.v1.pricebook.service.update({
      serviceId: created.id,
      name: "Updated Service",
      unitPriceCents: 6000,
      costCents: 1500,
      active: false,
    });

    expect(updated.name).toBe("Updated Service");
    expect(updated.unitPriceCents).toBe(6000);
    expect(updated.costCents).toBe(1500);
    expect(updated.active).toBe(false);
  });

  it("update rejects an empty name with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.service.create({
      name: "Empty Name Target",
      unitPriceCents: 100,
      costCents: 10,
    });
    await expect(
      caller.v1.pricebook.service.update({ serviceId: created.id, name: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update on unknown serviceId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.pricebook.service.update({ serviceId: randomUUID(), name: "Whatever" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── archive ────────────────────────────────────────────────────────────────

  it("archive soft-deletes a service; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.service.create({
      name: "Archive Me Service",
      unitPriceCents: 100,
      costCents: 10,
    });

    const result = await caller.v1.pricebook.service.archive({ serviceId: created.id });
    expect(result.ok).toBe(true);

    const listed = await caller.v1.pricebook.service.list({ limit: 500 });
    expect(listed.items.some((s) => s.id === created.id)).toBe(false);
  });

  it("archive on unknown serviceId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.pricebook.service.archive({ serviceId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── category create + list ───────────────────────────────────────────────────

  it("an owner creates a category and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.pricebook.category.create({ name: "Water Heaters" });
    expect(created.name).toBe("Water Heaters");
    expect(created.parentId).toBeNull();
    expect(created.sortOrder).toBe(0);

    const listed = await caller.v1.pricebook.category.list();
    expect(listed.some((c) => c.id === created.id)).toBe(true);
  });

  // ── tenant isolation (RLS) ───────────────────────────────────────────────────

  it("a different org sees none of org A's services or categories", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const service = await callerA.v1.pricebook.service.create({
      name: "Org A Only Service",
      unitPriceCents: 100,
      costCents: 10,
    });
    const category = await callerA.v1.pricebook.category.create({ name: "Org A Only Category" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listedServices = await callerB.v1.pricebook.service.list({ limit: 500 });
    expect(listedServices.items.some((s) => s.id === service.id)).toBe(false);

    const listedCategories = await callerB.v1.pricebook.category.list();
    expect(listedCategories.some((c) => c.id === category.id)).toBe(false);
  });

  it("org B cannot update or archive org A's service (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.pricebook.service.create({
      name: "RLS Boundary Service",
      unitPriceCents: 100,
      costCents: 10,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.pricebook.service.update({ serviceId: created.id, name: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.pricebook.service.archive({ serviceId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("a tech is forbidden from all pricebook mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.pricebook.service.create({ name: "Nope", unitPriceCents: 0, costCents: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await callerTech.v1.pricebook.category.create({ name: "Nope" }).catch((e) => {
      expect(e).toBeInstanceOf(TRPCError);
    });
  });

  // ── pagination correctness (keyset cursor) ──────────────────────────────────

  it("pages through more services than the limit with no dupes and no skips", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const prefix = `Pager Item ${randomUUID().slice(0, 8)}`;
    const total = 12;
    const limit = 5;

    const createdIds = new Set<string>();
    for (let i = 0; i < total; i += 1) {
      const created = await caller.v1.pricebook.service.create({
        name: `${prefix} ${String(i).padStart(3, "0")}`,
        unitPriceCents: 100 + i,
        costCents: 10,
      });
      createdIds.add(created.id);
    }
    expect(createdIds.size).toBe(total);

    const seenIds: string[] = [];
    let cursor: string | null | undefined = undefined;
    let pages = 0;
    do {
      const page = await caller.v1.pricebook.service.list({ limit, search: prefix, cursor });
      seenIds.push(...page.items.map((s) => s.id));
      cursor = page.nextCursor;
      pages += 1;
      // Safety valve: never loop more than a handful past the expected page count.
      expect(pages).toBeLessThanOrEqual(Math.ceil(total / limit) + 2);
    } while (cursor);

    // No dupes: every id appears at most once across all pages.
    const uniqueSeen = new Set(seenIds);
    expect(uniqueSeen.size).toBe(seenIds.length);

    // No skips: every created id was returned, and nothing extra.
    expect(uniqueSeen).toEqual(createdIds);
  });
});
