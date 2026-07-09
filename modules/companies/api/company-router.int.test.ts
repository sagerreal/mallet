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

// Capstone: exercise the full companies stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves an owner in org A can create/list/update/archive, org B sees nothing of A's, and
// a tech is forbidden.
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

suite("companies tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CompanyApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CompanyApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── create + list ──────────────────────────────────────────────────────────

  it("an owner creates a company and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.companies.create({
      name: "Acme Property Management",
      phone: "+15551234567",
      email: "contact@acme.com",
      website: "https://acme.com",
    });
    expect(created.name).toBe("Acme Property Management");
    expect(created.phone).toBe("+15551234567");
    expect(created.email).toBe("contact@acme.com");
    expect(created.website).toBe("https://acme.com");
    expect(created.notes).toBeNull();

    const listed = await caller.v1.companies.list({ limit: 50 });
    expect(listed.items.some((c) => c.id === created.id)).toBe(true);
  });

  it("a different org sees none of org A's companies", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await callerB.v1.companies.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  // ── client-authored id ─────────────────────────────────────────────────────

  it("create with a client-authored id uses that id", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const myId = randomUUID();
    const created = await caller.v1.companies.create({ id: myId, name: "Client ID Corp" });
    expect(created.id).toBe(myId);
  });

  // ── update ─────────────────────────────────────────────────────────────────

  it("update happy path: name, phone, notes persist", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.companies.create({ name: "Update Target Ltd" });

    const updated = await caller.v1.companies.update({
      companyId: created.id,
      name: "Updated Corp",
      phone: "+15559990001",
      notes: "Key account",
    });

    expect(updated.name).toBe("Updated Corp");
    expect(updated.phone).toBe("+15559990001");
    expect(updated.notes).toBe("Key account");
  });

  it("update rejects an empty name with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.companies.create({ name: "Empty Name Target" });
    await expect(
      caller.v1.companies.update({ companyId: created.id, name: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update on unknown companyId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.companies.update({ companyId: randomUUID(), name: "Whatever" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── archive ────────────────────────────────────────────────────────────────

  it("archive soft-deletes a company; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.companies.create({ name: "Archive Me Ltd" });

    const result = await caller.v1.companies.archive({ companyId: created.id });
    expect(result.ok).toBe(true);

    const listed = await caller.v1.companies.list({ limit: 500 });
    expect(listed.items.some((c) => c.id === created.id)).toBe(false);
  });

  it("archive on unknown companyId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.companies.archive({ companyId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── cross-org RLS ──────────────────────────────────────────────────────────

  it("org B cannot update or archive org A's company (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.companies.create({ name: "RLS Boundary Corp" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.companies.update({ companyId: created.id, name: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.companies.archive({ companyId: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("a tech is forbidden from all company mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.companies.create({ name: "Nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await callerTech.v1.companies.create({ name: "Nope2" }).catch((e) => {
      expect(e).toBeInstanceOf(TRPCError);
    });
  });
});
