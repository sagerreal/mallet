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

// Capstone: exercise the full inbound stack via createCaller — auth gate, RBAC, org-scoped
// transaction, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves generate/list/rotate/disable behave correctly, generate is idempotent, a tech is
// forbidden, and org B cannot see org A's endpoints.
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
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
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

const HEX64 = /^[0-9a-f]{64}$/;

suite("inbound tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('InboundApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('InboundApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── generate + list ────────────────────────────────────────────────────────

  it("an owner generates an endpoint with a 64-hex token, not yet connected", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const generated = await caller.v1.inbound.generate({ channel: "form" });
    expect(generated.channel).toBe("form");
    expect(generated.token).toMatch(HEX64);
    expect(generated.connected).toBe(false);
    expect(generated.lastLeadAt).toBeNull();

    const listed = await caller.v1.inbound.list();
    expect(listed.some((e) => e.channel === "form" && e.token === generated.token)).toBe(true);
  });

  it("generate is idempotent: a second call for the same channel returns the same token", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const first = await caller.v1.inbound.generate({ channel: "angi" });
    const second = await caller.v1.inbound.generate({ channel: "angi" });
    expect(second.token).toBe(first.token);
  });

  it("a different org sees none of org A's endpoints", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await callerB.v1.inbound.list();
    expect(listed).toHaveLength(0);
  });

  // ── rotate ─────────────────────────────────────────────────────────────────

  it("rotate replaces the token with a different 64-hex value", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const generated = await caller.v1.inbound.generate({ channel: "thumbtack" });

    const rotated = await caller.v1.inbound.rotate({ channel: "thumbtack" });
    expect(rotated).not.toBeNull();
    expect(rotated?.token).toMatch(HEX64);
    expect(rotated?.token).not.toBe(generated.token);
  });

  it("rotate on a channel with no endpoint returns null", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const rotated = await caller.v1.inbound.rotate({ channel: "form" });
    expect(rotated).toBeNull();
  });

  // ── disable ────────────────────────────────────────────────────────────────

  it("disable soft-deletes the endpoint; list no longer returns it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await caller.v1.inbound.generate({ channel: "form" });

    const result = await caller.v1.inbound.disable({ channel: "form" });
    expect(result.ok).toBe(true);

    const listed = await caller.v1.inbound.list();
    expect(listed.some((e) => e.channel === "form")).toBe(false);
  });

  // ── cross-org RLS ──────────────────────────────────────────────────────────

  it("org B cannot see or rotate org A's endpoint (isolated via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await callerA.v1.inbound.generate({ channel: "angi" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listedB = await callerB.v1.inbound.list();
    expect(listedB.some((e) => e.token === created.token)).toBe(false);

    const rotatedB = await callerB.v1.inbound.rotate({ channel: "angi" });
    expect(rotatedB).toBeNull();
  });

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("a tech is forbidden from generating an endpoint", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.inbound.generate({ channel: "form" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await callerTech.v1.inbound.generate({ channel: "form" }).catch((e) => {
      expect(e).toBeInstanceOf(TRPCError);
    });
  });
});
