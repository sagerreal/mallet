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
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "own@e2e.test", orgNameHint: "Duggan Electric", name: null }));

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

  it("updateMe sets own display name and returns updated meDTO", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('UpdateMe Org') returning id`;
    createdOrgIds.push(org!.id);
    const authUserId = randomUUID();
    const [u] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${authUserId}, 'me@x.com', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "tech"), principal: { userId: asUserId(u!.id), orgId: asOrgId(org!.id), role: "tech" } };

    const result = await appRouter.createCaller(ctx).v1.identity.updateMe({ name: "Jane Doe" });

    expect(result.name).toBe("Jane Doe");
    expect(result.role).toBe("tech");
    expect(result.orgId).toBe(org!.id);

    const [row] = await admin<{ name: string }[]>`select name from users where id = ${u!.id}`;
    expect(row!.name).toBe("Jane Doe");
  });

  it("setMemberRole changes a member's role", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('SetRole Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'boss@x.com', 'owner') returning id`;
    const [tech] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'tech@x.com', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    const result = await appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: tech!.id, role: "office" });

    expect(result.role).toBe("office");
    expect(result.id).toBe(tech!.id);

    const [row] = await admin<{ role: string }[]>`select role from users where id = ${tech!.id}`;
    expect(row!.role).toBe("office");
  });

  it("setMemberRole refuses to demote the last owner (FORBIDDEN)", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('LastOwner Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'solo@x.com', 'owner') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: owner!.id, role: "tech" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "cannot remove the last owner" });
  });

  it("setMemberRole: office caller promoting themselves to owner → FORBIDDEN", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('PrivEsc Org A') returning id`;
    createdOrgIds.push(org!.id);
    const [officeUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'office@privesc.test', 'office') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "office"), principal: { userId: asUserId(officeUser!.id), orgId: asOrgId(org!.id), role: "office" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: officeUser!.id, role: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "only an owner can change owner roles" });
  });

  it("setMemberRole: office caller promoting another member to owner → FORBIDDEN", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('PrivEsc Org B') returning id`;
    createdOrgIds.push(org!.id);
    const [officeUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'office2@privesc.test', 'office') returning id`;
    const [techUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'tech2@privesc.test', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "office"), principal: { userId: asUserId(officeUser!.id), orgId: asOrgId(org!.id), role: "office" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: techUser!.id, role: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "only an owner can change owner roles" });
  });

  it("setMemberRole: office caller demoting an owner → FORBIDDEN", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('PrivEsc Org C') returning id`;
    createdOrgIds.push(org!.id);
    const [ownerUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'owner3@privesc.test', 'owner') returning id`;
    const [officeUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'office3@privesc.test', 'office') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "office"), principal: { userId: asUserId(officeUser!.id), orgId: asOrgId(org!.id), role: "office" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: ownerUser!.id, role: "tech" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "only an owner can change owner roles" });
  });

  it("setMemberRole rejects cross-org target via RLS (NOT_FOUND)", async () => {
    const [orgA] = await admin<{ id: string }[]>`insert into orgs (name) values ('OrgA') returning id`;
    const [orgB] = await admin<{ id: string }[]>`insert into orgs (name) values ('OrgB') returning id`;
    createdOrgIds.push(orgA!.id, orgB!.id);

    const [ownerA] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgA!.id}, ${randomUUID()}, 'a@x.com', 'owner') returning id`;
    const [techB] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgB!.id}, ${randomUUID()}, 'b@x.com', 'tech') returning id`;

    // Actor is from orgA, trying to change a user in orgB
    const ctx: Context = { ...principalCtx(orgA!.id, "owner"), principal: { userId: asUserId(ownerA!.id), orgId: asOrgId(orgA!.id), role: "owner" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberRole({ userId: techB!.id, role: "office" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ─── inviteMember / listInvites / revokeInvite ───────────────────────────

  it("inviteMember creates a pending invite", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Invite Org A') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'inv-owner@test.com', 'owner') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    const invite = await appRouter.createCaller(ctx).v1.identity.inviteMember({ email: "newtech@test.com", role: "tech" });
    expect(invite.status).toBe("pending");
    expect(invite.role).toBe("tech");
    expect(invite.email).toBe("newtech@test.com");

    const [row] = await admin<{ status: string; role: string }[]>`select status, role from org_invites where id = ${invite.id}`;
    expect(row!.status).toBe("pending");
    expect(row!.role).toBe("tech");
  });

  it("signup with invited email joins the inviting org with invited role and correct is_field_crew", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Invite Join Org') returning id`;
    createdOrgIds.push(org!.id);
    // Seed a pending invite for a tech role
    await admin`insert into org_invites (org_id, email, role, status) values (${org!.id}, 'jointest@test.com', 'tech', 'pending')`;

    // Fresh signup with the invited email — should join the inviting org
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "jointest@test.com", orgNameHint: "Should Be Ignored", name: "Join Tester" }));
    const result = await caller.v1.identity.signup({});
    // Do not push orgId — it's the pre-existing org
    expect(result.orgId).toBe(org!.id);
    expect(result.role).toBe("tech");

    const [u] = await admin<{ role: string; is_field_crew: boolean; org_id: string }[]>`select role, is_field_crew, org_id from users where auth_user_id = ${authUserId}`;
    expect(u!.org_id).toBe(org!.id);
    expect(u!.role).toBe("tech");
    expect(u!.is_field_crew).toBe(true); // tech is field crew

    // Invite should now be accepted
    const [inv] = await admin<{ status: string }[]>`select status from org_invites where org_id = ${org!.id} and lower(email) = 'jointest@test.com'`;
    expect(inv!.status).toBe("accepted");
  });

  it("office cannot invite an owner (FORBIDDEN)", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('PrivEsc Invite Org') returning id`;
    createdOrgIds.push(org!.id);
    const [officeUser] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'office-inv@test.com', 'office') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "office"), principal: { userId: asUserId(officeUser!.id), orgId: asOrgId(org!.id), role: "office" } };

    await expect(
      appRouter.createCaller(ctx).v1.identity.inviteMember({ email: "newowner@test.com", role: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "only an owner can invite an owner" });
  });

  it("revokeInvite makes the invite no longer join on signup", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('Revoke Invite Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'revoke-owner@test.com', 'owner') returning id`;
    const [inv] = await admin<{ id: string }[]>`insert into org_invites (org_id, email, role, status) values (${org!.id}, 'revokee@test.com', 'office', 'pending') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    await appRouter.createCaller(ctx).v1.identity.revokeInvite({ inviteId: inv!.id });

    const [row] = await admin<{ status: string }[]>`select status from org_invites where id = ${inv!.id}`;
    expect(row!.status).toBe("revoked");

    // Now signup with that email — should create a NEW org (no pending invite)
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "revokee@test.com", orgNameHint: "Brand New Org", name: null }));
    const result = await caller.v1.identity.signup({});
    createdOrgIds.push(result.orgId);
    expect(result.orgId).not.toBe(org!.id); // joined a new org, not the revoked inviter's org
    expect(result.role).toBe("owner"); // created their own org
  });

  it("listInvites and revokeInvite enforce cross-org isolation", async () => {
    const [orgA] = await admin<{ id: string }[]>`insert into orgs (name) values ('Iso Org A') returning id`;
    const [orgB] = await admin<{ id: string }[]>`insert into orgs (name) values ('Iso Org B') returning id`;
    createdOrgIds.push(orgA!.id, orgB!.id);

    const [ownerA] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgA!.id}, ${randomUUID()}, 'owner-a@iso.test', 'owner') returning id`;
    // Invite in orgB only
    const [invB] = await admin<{ id: string }[]>`insert into org_invites (org_id, email, role, status) values (${orgB!.id}, 'b-invitee@iso.test', 'tech', 'pending') returning id`;

    const ctxA: Context = { ...principalCtx(orgA!.id, "owner"), principal: { userId: asUserId(ownerA!.id), orgId: asOrgId(orgA!.id), role: "owner" } };

    // listInvites for orgA should NOT see orgB's invite
    const list = await appRouter.createCaller(ctxA).v1.identity.listInvites();
    expect(list.items.map((i) => i.id)).not.toContain(invB!.id);

    // revokeInvite of orgB's invite from orgA context → NOT_FOUND
    await expect(
      appRouter.createCaller(ctxA).v1.identity.revokeInvite({ inviteId: invB!.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("new owner signup sets is_field_crew = true", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "newowner-fc@test.com", orgNameHint: "FC Org", name: null }));
    const result = await caller.v1.identity.signup({});
    createdOrgIds.push(result.orgId);
    expect(result.role).toBe("owner");

    const [u] = await admin<{ is_field_crew: boolean }[]>`select is_field_crew from users where auth_user_id = ${authUserId}`;
    expect(u!.is_field_crew).toBe(true);
  });
});
