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
  // These tests exercise the fresh-org branch directly; production wires these from
  // SIGNUPS_OPEN (default false — Mallet is invite-only during the pilot).
  signupsOpen: true,
  inviteGate: new SignupStore(db),
  bus: new InMemoryEventBus(),
  clock: systemClock,
  ids: uuidGenerator,
  paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
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

  /**
   * The trade a shop picks at /welcome decides what its AI front desk can book.
   *
   * Before this, defaultBooking() handed EVERY org nine hard-coded residential plumbing services
   * with prices we invented — so a roofing shop's receptionist offered water heater repair, and
   * would have quoted "$99 drain cleaning" to a real caller on that shop's behalf.
   */
  /**
   * A NEW SHOP MUST LAND READY TO ANSWER.
   *
   * frontDeskReadiness wants three things: open hours, a bookable service and a service ORIGIN.
   * Hours are defaulted 8-17 and services come from the trade playbook, but nothing ever set the
   * origin — so every shop landed exactly one field short, with nothing on screen saying which.
   * Two shops that signed up in August are still switched off for precisely this reason.
   */
  it("seeds the service origin from the signup ZIP, so the shop is ready to switch on", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `origin-${authUserId}@e2e.test`, orgNameHint: "Origin Plumbing", name: null }),
    );
    const me = await caller.v1.identity.signup({ trade: "plumbing", postalCode: "02189" });
    createdOrgIds.push(me.orgId);

    const [row] = await admin<{ service_origin_address: string | null; booking: { services: unknown[] }; hours_mon_open: number; hours_mon_close: number }[]>`
      select service_origin_address, booking, hours_mon_open, hours_mon_close
        from org_settings where org_id = ${me.orgId}`;

    // The origin — the piece that was missing.
    expect(row!.service_origin_address).toBe("02189");
    // And the other two readiness inputs, so this test fails if either regresses.
    expect(row!.booking.services.length).toBeGreaterThan(0);
    expect(row!.hours_mon_close).toBeGreaterThan(row!.hours_mon_open);
  });

  it("leaves the origin unset when signup carried no ZIP, rather than inventing one", async () => {
    // A guessed service area silently declines real customers as out-of-area. Better unset: the
    // readiness gate then says so, and the check degrades to "book anyway".
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `nozip-${authUserId}@e2e.test`, orgNameHint: "No Zip Plumbing", name: null }),
    );
    const me = await caller.v1.identity.signup({ trade: "plumbing" });
    createdOrgIds.push(me.orgId);
    const [row] = await admin<{ service_origin_address: string | null }[]>`
      select service_origin_address from org_settings where org_id = ${me.orgId}`;
    expect(row!.service_origin_address).toBeNull();
  });

  it("seeds the front desk from the shop's OWN trade, not plumbing", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `roof-${authUserId}@e2e.test`, orgNameHint: "Something Roofing", name: null }),
    );
    const me = await caller.v1.identity.signup({ trade: "roofing", postalCode: "02189" });
    createdOrgIds.push(me.orgId);

    const [row] = await admin<{ trade: string; booking: { services: { name: string }[] } }[]>`
      select trade, booking from org_settings where org_id = ${me.orgId}`;
    expect(row!.trade).toBe("roofing");

    const names = row!.booking.services.map((s) => s.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.join(" ")).toMatch(/roof/i);
    // The specific regression: no plumbing anywhere near a roofer's front desk.
    expect(names.join(" ")).not.toMatch(/water heater|drain|sewer/i);
  });

  // Prices are the owner's, never ours. A seeded price would be quoted to a real caller by an
  // assistant speaking for the shop.
  it("seeds no prices with those services", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `hvac-${authUserId}@e2e.test`, orgNameHint: "Cold Air HVAC", name: null }),
    );
    const me = await caller.v1.identity.signup({ trade: "hvac" });
    createdOrgIds.push(me.orgId);

    const [row] = await admin<{ booking: { services: { price?: number; lane: string }[] } }[]>`
      select booking from org_settings where org_id = ${me.orgId}`;
    for (const svc of row!.booking.services) {
      expect(svc.price).toBeUndefined();
      expect(svc.lane).not.toBe("flat");
    }
  });

  /**
   * Whether the shop measures is DERIVED from its trade, never asked.
   *
   * It was a switch in Settings — in a card whose own copy said "a plumbing shop must never see
   * it" — so a shop was asked to decide something its trade already answered, and the two could
   * disagree. It gates the job modal's Measurements section.
   */
  it("turns measurement estimating on for a measured trade, and off for a service trade", async () => {
    const measured = randomUUID();
    const a = appRouter.createCaller(
      unmappedCtx({ authUserId: measured, email: `paint-${measured}@e2e.test`, orgNameHint: "Fresh Coat", name: null }),
    );
    const paintOrg = await a.v1.identity.signup({ trade: "painting" });
    createdOrgIds.push(paintOrg.orgId);

    const service = randomUUID();
    const b = appRouter.createCaller(
      unmappedCtx({ authUserId: service, email: `pipe-${service}@e2e.test`, orgNameHint: "Pipe Co", name: null }),
    );
    const plumbOrg = await b.v1.identity.signup({ trade: "plumbing" });
    createdOrgIds.push(plumbOrg.orgId);

    const [paint] = await admin<{ measurement_estimating: boolean }[]>`
      select measurement_estimating from org_settings where org_id = ${paintOrg.orgId}`;
    const [plumb] = await admin<{ measurement_estimating: boolean }[]>`
      select measurement_estimating from org_settings where org_id = ${plumbOrg.orgId}`;
    expect(paint!.measurement_estimating).toBe(true);
    expect(plumb!.measurement_estimating).toBe(false);
  });

  /**
   * "Other" means the shop would not name its trade, so we have nothing honest to seed. Empty is
   * also what keeps the front desk switched OFF — frontDeskReadiness needs a bookable service —
   * rather than answering with a list it cannot honour.
   */
  it("seeds nothing for Other, rather than guessing a trade", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `other-${authUserId}@e2e.test`, orgNameHint: "Mixed Trades", name: null }),
    );
    const me = await caller.v1.identity.signup({ trade: "other" });
    createdOrgIds.push(me.orgId);

    const [row] = await admin<{ booking: { services: unknown[] }; front_desk: boolean }[]>`
      select booking, front_desk from org_settings where org_id = ${me.orgId}`;
    expect(row!.booking.services).toEqual([]);
    expect(row!.front_desk).toBe(false);
  });

  /**
   * A signup that names no trade must not fall back to somebody else's services.
   *
   * With neither a trade nor a timezone to write, the first-run block does not run at all, so no
   * org_settings row is created yet — the row is written lazily on first read. Either outcome is
   * correct; what must never happen is services appearing from nowhere.
   */
  it("seeds nothing when no trade is given", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(
      unmappedCtx({ authUserId, email: `none-${authUserId}@e2e.test`, orgNameHint: "No Trade Co", name: null }),
    );
    const me = await caller.v1.identity.signup({});
    createdOrgIds.push(me.orgId);

    const [row] = await admin<{ booking: { services: unknown[] } }[]>`
      select booking from org_settings where org_id = ${me.orgId}`;
    expect(row?.booking.services ?? []).toEqual([]);
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

  it("a fresh owner signup with a timezone patches the brand-new org's org_settings row", async () => {
    const authUserId = randomUUID();
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "tz-owner@e2e.test", orgNameHint: "TZ Owner Org", name: null }));

    const result = await caller.v1.identity.signup({ postalCode: "02189", timezone: "America/New_York" });
    createdOrgIds.push(result.orgId);
    expect(result.role).toBe("owner");

    const [row] = await admin<{ timezone: string }[]>`select timezone from org_settings where org_id = ${result.orgId}`;
    expect(row!.timezone).toBe("America/New_York");
  });

  // CRITICAL: an invited joiner's ZIP must never overwrite an org's already-set timezone.
  // app_signup_create_org's `role: org_id` result covers BOTH "created a new org" and "joined an
  // existing one via a pending invite" — signup must only ever patch org_settings.timezone on the
  // former, and only when the org has no settings row yet (never re-patch a corrected value).
  it("an invited joiner's ZIP-derived timezone never overwrites the inviting org's existing timezone", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('TZ Invite Org') returning id`;
    createdOrgIds.push(org!.id);
    // Owner already corrected the timezone by hand (simulates the Settings control having been used).
    await admin`insert into org_settings (org_id, timezone, booking) values (${org!.id}, 'America/Denver', '{"services":[],"notServices":"","serviceFee":0,"feeCredited":false}'::jsonb)`;
    await admin`insert into org_invites (org_id, email, role, status) values (${org!.id}, 'tz-jointest@e2e.test', 'office', 'pending')`;

    const authUserId = randomUUID();
    // A different ZIP than the org's real one — this must NOT land in org_settings.
    const caller = appRouter.createCaller(unmappedCtx({ authUserId, email: "tz-jointest@e2e.test", orgNameHint: "Ignored", name: null }));
    const result = await caller.v1.identity.signup({ postalCode: "90001", timezone: "America/Los_Angeles" });

    expect(result.orgId).toBe(org!.id);
    expect(result.role).toBe("office");

    const [row] = await admin<{ timezone: string }[]>`select timezone from org_settings where org_id = ${org!.id}`;
    expect(row!.timezone).toBe("America/Denver");
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

  // ─── skillTags / setMemberSkillTags ──────────────────────────────────────

  it("members returns skillTags as [] for an untouched user", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags Default Org') returning id`;
    createdOrgIds.push(org!.id);
    await admin`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-default@test.com', 'tech')`;

    const list = await appRouter.createCaller(principalCtx(org!.id, "owner")).v1.identity.members();
    const member = list.items.find((m) => m.email === "sk-default@test.com");
    expect(member).toBeDefined();
    expect(member!.skillTags).toEqual([]);
  });

  it("setMemberSkillTags round-trip persists display casing", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags RoundTrip Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-owner@test.com', 'owner') returning id`;
    const [tech] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-tech@test.com', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    const result = await appRouter.createCaller(ctx).v1.identity.setMemberSkillTags({
      userId: tech!.id,
      skillTags: ["Gas", "Boiler"],
    });

    expect(result.skillTags).toEqual(["Gas", "Boiler"]);
    expect(result.id).toBe(tech!.id);

    // Verify persisted in DB
    const [row] = await admin<{ skill_tags: string[] }[]>`select skill_tags from users where id = ${tech!.id}`;
    expect(row!.skill_tags).toEqual(["Gas", "Boiler"]);

    // Verify members query returns the tags
    const list = await appRouter.createCaller(ctx).v1.identity.members();
    const member = list.items.find((m) => m.id === tech!.id);
    expect(member!.skillTags).toEqual(["Gas", "Boiler"]);
  });

  it("setMemberSkillTags dedupes case-insensitively, first occurrence wins", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags Dedupe Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-ded-owner@test.com', 'owner') returning id`;
    const [tech] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-ded-tech@test.com', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    const result = await appRouter.createCaller(ctx).v1.identity.setMemberSkillTags({
      userId: tech!.id,
      skillTags: ["Gas", " gas "],
    });

    // After Zod trim + dedupe: only "Gas" survives
    expect(result.skillTags).toHaveLength(1);
    expect(result.skillTags[0]).toBe("Gas");
  });

  it("setMemberSkillTags rejects 11 tags with validation error", async () => {
    const [org] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags Cap Org') returning id`;
    createdOrgIds.push(org!.id);
    const [owner] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-cap-owner@test.com', 'owner') returning id`;
    const [tech] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${org!.id}, ${randomUUID()}, 'sk-cap-tech@test.com', 'tech') returning id`;

    const ctx: Context = { ...principalCtx(org!.id, "owner"), principal: { userId: asUserId(owner!.id), orgId: asOrgId(org!.id), role: "owner" } };

    const elevenTags = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
    await expect(
      appRouter.createCaller(ctx).v1.identity.setMemberSkillTags({ userId: tech!.id, skillTags: elevenTags }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("setMemberSkillTags: org B cannot set org A's member (NOT_FOUND)", async () => {
    const [orgA] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags Iso OrgA') returning id`;
    const [orgB] = await admin<{ id: string }[]>`insert into orgs (name) values ('SkillTags Iso OrgB') returning id`;
    createdOrgIds.push(orgA!.id, orgB!.id);

    const [techA] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgA!.id}, ${randomUUID()}, 'sk-iso-a@test.com', 'tech') returning id`;
    const [ownerB] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgB!.id}, ${randomUUID()}, 'sk-iso-b@test.com', 'owner') returning id`;

    const ctxB: Context = { ...principalCtx(orgB!.id, "owner"), principal: { userId: asUserId(ownerB!.id), orgId: asOrgId(orgB!.id), role: "owner" } };

    await expect(
      appRouter.createCaller(ctxB).v1.identity.setMemberSkillTags({ userId: techA!.id, skillTags: ["Gas"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /**
   * The invite-only gate. With signups closed (the production default), a verified auth user
   * with no pending invite must NOT get a fresh org — the anon key is public, so anyone can
   * mint an auth user without ever seeing our UI; the gate has to hold here, not in the form.
   * A pending org_invites row is the one authorization that still opens the door.
   */
  describe("invite-only gate (signupsOpen: false)", () => {
    const closedCtx = (unmapped: VerifiedToken): Context => ({
      principal: null,
      unmapped,
      tx: null,
      deps: { ...stubDeps, signupsOpen: false } as Context["deps"],
    });

    it("refuses a fresh org for an uninvited email, and provisions nothing", async () => {
      const authUserId = randomUUID();
      const caller = appRouter.createCaller(
        closedCtx({ authUserId, email: `walkup-${authUserId}@e2e.test`, orgNameHint: "Walk-up Plumbing", name: null }),
      );
      await expect(caller.v1.identity.signup({})).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const rows = await admin`select 1 from users where auth_user_id = ${authUserId}`;
      expect(rows.length).toBe(0);
    });

    it("still joins an invited member — the pending invite row IS the authorization", async () => {
      const ownerAuth = randomUUID();
      const owner = appRouter.createCaller(
        unmappedCtx({ authUserId: ownerAuth, email: `own-${ownerAuth}@e2e.test`, orgNameHint: "Gate Test Plumbing", name: null }),
      );
      const org = await owner.v1.identity.signup({});
      createdOrgIds.push(org.orgId);

      const joinerEmail = `join-${randomUUID()}@e2e.test`;
      await admin`insert into org_invites (org_id, email, role) values (${org.orgId}, ${joinerEmail}, 'tech')`;

      const joinerAuth = randomUUID();
      const joiner = appRouter.createCaller(
        closedCtx({ authUserId: joinerAuth, email: joinerEmail, orgNameHint: null, name: null }),
      );
      const me = await joiner.v1.identity.signup({});
      expect(me.orgId).toBe(org.orgId);
      expect(me.role).toBe("tech");
    });
  });
});
