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

// Capstone: exercise the WHOLE request stack via createCaller — auth gate, RBAC, the org-scoped
// transaction, the use-case, the Drizzle repo, and live RLS — without spinning up HTTP. Proves
// an owner in org A can create+list, org B sees nothing of A's, and a tech is forbidden.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// authProvider is never invoked here: createCaller injects the Principal directly, bypassing
// token verification. A throwing stub makes accidental use loud.
const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("customers tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ApiTest A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ApiTest B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("an owner creates a customer and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({
      name: "Karen Doyle",
      phone: "(555) 444-1212",
      source: "web",
    });
    expect(created.name).toBe("Karen Doyle");
    expect(created.phone).toBe("+15554441212");
    expect(created.stage).toBe("new");

    const listed = await caller.v1.customers.list({ limit: 50 });
    expect(listed.items.some((l) => l.id === created.id)).toBe(true);
  });

  it("a different org sees none of org A's customers", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.customers.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a created customer is gettable by id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Get Test User", phone: "(555) 123-9999" });
    const fetched = await caller.v1.customers.get({ leadId: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Get Test User");
    expect(fetched.stage).toBe("new");
  });

  it("customers.get returns NOT_FOUND for a random uuid", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(caller.v1.customers.get({ leadId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("org B cannot get org A's customer (NOT_FOUND under RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.customers.create({ name: "RLS Boundary Test" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(callerB.v1.customers.get({ leadId: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("a tech is forbidden from the office customer API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(caller.v1.customers.create({ name: "Nope" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // sanity: the rejection is a TRPCError, not an incidental throw
    await caller.v1.customers.create({ name: "Nope2" }).catch((e) => {
      expect(e).toBeInstanceOf(TRPCError);
    });
  });
});
