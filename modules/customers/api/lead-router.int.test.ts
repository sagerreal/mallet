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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
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
    // Genuine new insert must surface created:true
    expect(created.created).toBe(true);

    const listed = await caller.v1.customers.list({ limit: 50 });
    expect(listed.items.some((l) => l.id === created.id)).toBe(true);
  });

  it("create returns created:false when phone matches an existing customer", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const first = await caller.v1.customers.create({
      name: "Dedup Alice",
      phone: "(555) 777-8888",
    });
    expect(first.created).toBe(true);

    // Same phone, different name — should dedup and return the existing record.
    const second = await caller.v1.customers.create({
      name: "Alice (again)",
      phone: "(555) 777-8888",
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name); // original name preserved
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

  // ── update ──────────────────────────────────────────────────────────────────

  it("update happy path: name, valueCents, and stage are persisted", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({
      name: "Update Target",
      phone: "(555) 700-0001",
    });

    const updated = await caller.v1.customers.update({
      leadId: created.id,
      name: "Updated Name",
      valueCents: 25000,
      stage: "contacted",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.value.cents).toBe(25000);
    expect(updated.stage).toBe("contacted");

    // Assert persistence: get and list both reflect the new values.
    const fetched = await caller.v1.customers.get({ leadId: created.id });
    expect(fetched.name).toBe("Updated Name");
    expect(fetched.value.cents).toBe(25000);
    expect(fetched.stage).toBe("contacted");

    const listed = await caller.v1.customers.list({ limit: 50 });
    const inList = listed.items.find((l) => l.id === created.id);
    expect(inList).toBeDefined();
    expect(inList!.name).toBe("Updated Name");
  });

  it("update rejects an invalid phone string with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Bad Phone Target" });

    await expect(
      caller.v1.customers.update({ leadId: created.id, phone: "not-a-phone" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update rejects a name longer than 255 characters via input schema", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Bounds Test Target" });

    const tooLong = "x".repeat(256);
    await expect(
      caller.v1.customers.update({ leadId: created.id, name: tooLong }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── archive ──────────────────────────────────────────────────────────────────

  it("archive-then-list: archived lead disappears from list and get returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Archive Me" });

    const result = await caller.v1.customers.archive({ leadId: created.id });
    expect(result.ok).toBe(true);

    // Should not appear in the active list.
    const listed = await caller.v1.customers.list({ limit: 500 });
    expect(listed.items.some((l) => l.id === created.id)).toBe(false);

    // get should surface NOT_FOUND for an archived lead.
    await expect(caller.v1.customers.get({ leadId: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("archive not-found: archiving a random uuid throws NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.customers.archive({ leadId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── restore ──────────────────────────────────────────────────────────────────

  it("restore-then-list: restored lead reappears in list and get succeeds", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Restore Me" });
    await caller.v1.customers.archive({ leadId: created.id });

    const restored = await caller.v1.customers.restore({ leadId: created.id });
    expect(restored.id).toBe(created.id);

    // Should now appear in the active list again.
    const listed = await caller.v1.customers.list({ limit: 500 });
    expect(listed.items.some((l) => l.id === created.id)).toBe(true);

    // get should succeed.
    const fetched = await caller.v1.customers.get({ leadId: created.id });
    expect(fetched.id).toBe(created.id);
  });

  // ── companyId + role round-trip ───────────────────────────────────────────────

  it("create with companyId+role persists both fields", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // First create a company so we have a valid FK target.
    const company = await caller.v1.companies.create({ name: "Test Property Co" });

    const lead = await caller.v1.customers.create({
      name: "Jane Contact",
      companyId: company.id,
      role: "Property manager",
    });

    expect(lead.companyId).toBe(company.id);
    expect(lead.role).toBe("Property manager");

    // Verify round-trip via get.
    const fetched = await caller.v1.customers.get({ leadId: lead.id });
    expect(fetched.companyId).toBe(company.id);
    expect(fetched.role).toBe("Property manager");
  });

  it("update can set and clear companyId+role", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const company = await caller.v1.companies.create({ name: "Update Company Target" });
    const lead = await caller.v1.customers.create({ name: "Bob Contact" });

    // Initially no company link.
    expect(lead.companyId).toBeNull();
    expect(lead.role).toBeNull();

    // Set the link.
    const linked = await caller.v1.customers.update({
      leadId: lead.id,
      companyId: company.id,
      role: "Owner",
    });
    expect(linked.companyId).toBe(company.id);
    expect(linked.role).toBe("Owner");

    // Clear the link.
    const cleared = await caller.v1.customers.update({
      leadId: lead.id,
      companyId: null,
      role: null,
    });
    expect(cleared.companyId).toBeNull();
    expect(cleared.role).toBeNull();
  });

  // ── cross-org isolation ───────────────────────────────────────────────────────

  it("org B cannot update, archive, or restore org A's lead (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.customers.create({ name: "Cross-Org RLS Guard" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.customers.update({ leadId: created.id, name: "Should Fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.customers.archive({ leadId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // restore: the lead is active under org A; org B sees nothing and gets NOT_FOUND.
    await expect(
      callerB.v1.customers.restore({ leadId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
