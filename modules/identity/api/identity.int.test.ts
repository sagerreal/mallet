import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb, db } from "@mallet/shared/db/client";
import { SignupStore } from "@mallet/identity";
import type { Principal, Role, VerifiedToken } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
const createdOrgIds: string[] = [];

const stubDeps = {
  authProvider: { authenticate: async () => { throw new Error("unused"); } },
  apiKeyAuthenticator: { authenticate: async () => null },
  tokenVerifier: { verify: async () => null },
  signupStore: new SignupStore(db),
  bus: new InMemoryEventBus(),
  clock: systemClock,
  ids: uuidGenerator,
  paymentLinkGateway: null,
  llmClient: null,
} as unknown as Context["deps"];

const unmappedCtx = (unmapped: VerifiedToken): Context => ({ principal: null, unmapped, tx: null, deps: stubDeps });
const principalCtx = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: stubDeps,
});

suite("v1.identity (live RLS)", () => {
  afterAll(async () => {
    for (const id of createdOrgIds) await admin`delete from orgs where id = ${id}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("signup provisions org+owner for an unmapped identity, idempotently", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "own@e2e.test", orgNameHint: "Duggan Electric" }));

    const first = await caller.v1.identity.signup({});
    createdOrgIds.push(first.orgId);
    expect(first.role).toBe("owner");
    expect(first.orgName).toBe("Duggan Electric");

    const again = await caller.v1.identity.signup({ orgName: "Renamed LLC" }); // idempotent — no second org
    expect(again.orgId).toBe(first.orgId);

    const users = await admin`select role, email from users where auth_user_id = ${authUserId}`;
    expect(users).toHaveLength(1);
  });

  it("me returns role + org name for a provisioned member (any role incl. tech)", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Me Org') returning id`;
    createdOrgIds.push(org!.id);
    const authUserId = randomUUID();
    const [u] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${authUserId}, 't@x.com', 'tech') returning id`;
    const ctx: Context = { ...principalCtx(org!.id, "tech"), principal: { userId: asUserId(u!.id), orgId: asOrgId(org!.id), role: "tech" } };

    const me = await appRouter.createCaller(ctx).v1.identity.me();
    expect(me).toMatchObject({ role: "tech", orgName: "Me Org" });
  });

  it("members lists the org's users for owner/office and FORBIDDEN for tech", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Members Org') returning id`;
    createdOrgIds.push(org!.id);
    await admin`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'o@x.com', 'owner'), (${org!.id}, ${randomUUID()}, 'te@x.com', 'tech')`;

    const list = await appRouter.createCaller(principalCtx(org!.id, "owner")).v1.identity.members();
    expect(list.items.map((m) => m.role).sort()).toEqual(["owner", "tech"]);

    await expect(appRouter.createCaller(principalCtx(org!.id, "tech")).v1.identity.members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
