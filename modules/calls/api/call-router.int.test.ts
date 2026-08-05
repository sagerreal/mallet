import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock, ok } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The calls module against the LIVE schema and real RLS.
 *
 * This file exists because of a specific outage: `modules/calls` shipped with no integration test,
 * so nothing in the pre-merge gate ever ran its SQL. The feature deployed 33 minutes before its
 * migration was applied, and the first person to press Call got
 * `Failed query: select "callback_number" from "users" …` rendered in the UI.
 *
 * Every `place` test below executes that exact select. If a migration this module depends on has
 * not been applied, these fail loudly here instead of quietly in production.
 */

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// myDay takes the caller's own local day as absolute instants (there is no org timezone column).
const TODAY = (() => {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
})();

const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
const createdOrgIds: string[] = [];

// The provider is faked: these tests prove OUR side of the contract (rows, tenancy, refusals).
// Placing a real call would ring a real phone.
const originated: { callId: string; agentNumber: string; fromNumber: string }[] = [];
const fakeOriginator = {
  originate: async (cmd: { callId: string; agentNumber: string; fromNumber: string }) => {
    originated.push(cmd);
    return ok({ providerCallSid: `CA${randomUUID().replace(/-/g, "").slice(0, 30)}` });
  },
};

const fakeTokenIssuer = {
  issue: (userId: string, now: Date) => ({
    token: `fake-jwt-for-${userId}`,
    identity: `user-${userId}`,
    expiresAt: new Date(now.getTime() + 600_000),
  }),
};

const stubDeps = {
  authProvider: { authenticate: async () => { throw new Error("unused"); } },
  apiKeyAuthenticator: { authenticate: async () => null },
  tokenVerifier: { verify: async () => null },
  bus: new InMemoryEventBus(),
  clock: systemClock,
  ids: uuidGenerator,
  callOriginator: fakeOriginator,
  voiceTokenIssuer: fakeTokenIssuer,
  paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
} as unknown as Context["deps"];

const ctxFor = (orgId: string, userId: string, role: Role = "owner"): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: stubDeps,
});

// orgs.twilio_number is uniquely indexed (one shop, one line), so every seeded shop mints its own
// rather than borrowing a real provisioned number.
let lineSeq = 0;
const nextBusinessLine = () => `+1959555${String(1000 + lineSeq++).slice(0, 4)}`;

/** An org with a provisioned business line, one owner, and one lead with a phone. */
async function seedShop(name: string, opts: { businessLine?: string | null } = {}) {
  const line = opts.businessLine === undefined ? nextBusinessLine() : opts.businessLine;
  const [org] = await admin<{ id: string }[]>`
    insert into orgs (name, twilio_number) values (${name}, ${line}) returning id`;
  createdOrgIds.push(org!.id);
  const [user] = await admin<{ id: string }[]>`
    insert into users (org_id, auth_user_id, email, role)
    values (${org!.id}, ${randomUUID()}, ${`${randomUUID()}@e2e.test`}, 'owner') returning id`;
  const [lead] = await admin<{ id: string }[]>`
    insert into leads (org_id, name, phone_e164) values (${org!.id}, 'Dana Alvarez', '+19415550134') returning id`;
  return { orgId: org!.id, userId: user!.id, leadId: lead!.id, line };
}

/** A technician in the shop, optionally holding a job for one of its customers. */
async function seedTech(orgId: string, opts: { onJobFor?: string } = {}) {
  const [tech] = await admin<{ id: string }[]>`
    insert into users (org_id, auth_user_id, email, role)
    values (${orgId}, ${randomUUID()}, ${`${randomUUID()}@e2e.test`}, 'tech') returning id`;
  if (opts.onJobFor) {
    await admin`
      insert into jobs (org_id, num, lead_id, assignee_user_id, status)
      values (${orgId}, ${`JOB-${randomUUID().slice(0, 8)}`}, ${opts.onJobFor}, ${tech!.id}, 'scheduled')`;
  }
  return tech!.id;
}

suite("v1.calls (live RLS)", () => {
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await admin`delete from outbound_calls where org_id = ${id}`;
      await admin`delete from jobs where org_id = ${id}`;
      await admin`delete from leads where org_id = ${id}`;
      await admin`delete from users where org_id = ${id}`;
      await admin`delete from orgs where id = ${id}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("refuses, without dialling, when the caller has no callback number on file", async () => {
    const shop = await seedShop("Calls NoNumber Org");
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));

    await expect(caller.v1.calls.place({ leadId: shop.leadId })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const rows = await admin`select id from outbound_calls where org_id = ${shop.orgId}`;
    expect(rows).toHaveLength(0);
  });

  it("remembers a supplied number and writes the call row before dialling", async () => {
    const shop = await seedShop("Calls Place Org");
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));

    const dto = await caller.v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" });

    expect(dto.status).toBe("dialing");
    expect(dto.toNumber).toBe("+19415550134");
    expect(dto.fromNumber).toBe(shop.line);
    // The DTO must not carry staff PII or the provider handle.
    expect(Object.keys(dto)).not.toContain("agentNumber");
    expect(Object.keys(dto)).not.toContain("providerCallSid");

    const [user] = await admin<{ callback_number: string }[]>`
      select callback_number from users where id = ${shop.userId}`;
    expect(user!.callback_number).toBe("+17813850591");

    const rows = await admin`select id from outbound_calls where org_id = ${shop.orgId}`;
    expect(rows).toHaveLength(1);
  });

  it("refuses when the shop has no business line to call from", async () => {
    const shop = await seedShop("Calls NoLine Org", { businessLine: null });
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));

    await expect(
      caller.v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("setCallbackNumber stores, normalises and clears — for the caller only", async () => {
    const shop = await seedShop("Calls Settings Org");
    const [colleague] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${shop.orgId}, ${randomUUID()}, ${`${randomUUID()}@e2e.test`}, 'office') returning id`;
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));

    const saved = await caller.v1.calls.setCallbackNumber({ callbackNumber: "781-385-0591" });
    expect(saved.callbackNumber).toBe("+17813850591");

    // The colleague's row is untouched — the user id comes from the principal, never from input.
    const [other] = await admin<{ callback_number: string | null }[]>`
      select callback_number from users where id = ${colleague!.id}`;
    expect(other!.callback_number).toBeNull();

    const cleared = await caller.v1.calls.setCallbackNumber({ callbackNumber: null });
    expect(cleared.callbackNumber).toBeNull();
    const [mine] = await admin<{ callback_number: string | null }[]>`
      select callback_number from users where id = ${shop.userId}`;
    expect(mine!.callback_number).toBeNull();
  });

  it("setCallbackNumber rejects a number that place would later refuse", async () => {
    const shop = await seedShop("Calls BadNumber Org");
    await expect(
      appRouter.createCaller(ctxFor(shop.orgId, shop.userId)).v1.calls.setCallbackNumber({ callbackNumber: "12" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("get reads a call back for its own org and is invisible to another", async () => {
    const shop = await seedShop("Calls Get Org");
    const stranger = await seedShop("Calls Stranger Org");
    const placed = await appRouter
      .createCaller(ctxFor(shop.orgId, shop.userId))
      .v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" });

    const read = await appRouter.createCaller(ctxFor(shop.orgId, shop.userId)).v1.calls.get({ callId: placed.id });
    expect(read.id).toBe(placed.id);

    await expect(
      appRouter.createCaller(ctxFor(stranger.orgId, stranger.userId)).v1.calls.get({ callId: placed.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // A technician's reach is their own work. The field shell only ever shows the customers on
  // their own jobs, and the API must not reach further than the UI does — otherwise widening the
  // role turns the field app into an org-wide dialler on the shop's caller ID and the shop's bill.
  it("a tech can call a customer who is on a job of theirs", async () => {
    const shop = await seedShop("Calls Tech Allowed Org");
    const techId = await seedTech(shop.orgId, { onJobFor: shop.leadId });
    const caller = appRouter.createCaller(ctxFor(shop.orgId, techId, "tech"));

    const dto = await caller.v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" });
    expect(dto.status).toBe("dialing");
  });

  it("a tech cannot call a customer who is not on any job of theirs", async () => {
    const shop = await seedShop("Calls Tech Denied Org");
    const techId = await seedTech(shop.orgId); // no job

    await expect(
      appRouter
        .createCaller(ctxFor(shop.orgId, techId, "tech"))
        .v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a tech cannot read or log against a colleague's call", async () => {
    const shop = await seedShop("Calls Tech Foreign Org");
    const techId = await seedTech(shop.orgId, { onJobFor: shop.leadId });
    const ownersCall = await appRouter
      .createCaller(ctxFor(shop.orgId, shop.userId))
      .v1.calls.place({ leadId: shop.leadId, agentNumber: "(781) 385-0591" });

    const techCaller = appRouter.createCaller(ctxFor(shop.orgId, techId, "tech"));
    await expect(techCaller.v1.calls.get({ callId: ownersCall.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      techCaller.v1.calls.logOutcome({ callId: ownersCall.id, outcome: "Connected", notes: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech owns their own callback number", async () => {
    const shop = await seedShop("Calls Tech Number Org");
    const techId = await seedTech(shop.orgId);
    const caller = appRouter.createCaller(ctxFor(shop.orgId, techId, "tech"));

    expect((await caller.v1.calls.setCallbackNumber({ callbackNumber: "781-385-0591" })).callbackNumber)
      .toBe("+17813850591");
    expect((await caller.v1.identity.me()).callbackNumber).toBe("+17813850591");
  });

  it("myDay carries the customers behind a tech's jobs, and nobody else's", async () => {
    const shop = await seedShop("Calls MyDay Org");
    const techId = await seedTech(shop.orgId, { onJobFor: shop.leadId });
    const [other] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164) values (${shop.orgId}, 'Not Theirs', '+19415550999') returning id`;

    const day = await appRouter.createCaller(ctxFor(shop.orgId, techId, "tech")).v1.field.myDay(TODAY);

    expect(day.customers.map((c) => c.id)).toEqual([shop.leadId]);
    expect(day.customers[0]!.phone).toBe("+19415550134");
    expect(day.customers.map((c) => c.id)).not.toContain(other!.id);
  });

  // The browser transport, against the real schema: no number is stored, nothing is originated,
  // and the row is a reservation the client's own device then dials with.
  it("a browser call needs no callback number and asks the provider for nothing", async () => {
    const shop = await seedShop("Calls Browser Org");
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));
    const before = originated.length;

    const dto = await caller.v1.calls.place({ leadId: shop.leadId, transport: "browser" });

    expect(dto.transport).toBe("browser");
    expect(dto.status).toBe("queued");
    expect(originated).toHaveLength(before);

    const [row] = await admin<{ agent_number: string | null; transport: string }[]>`
      select agent_number, transport from outbound_calls where id = ${dto.id}`;
    expect(row!.agent_number).toBeNull();
    expect(row!.transport).toBe("browser");

    const [user] = await admin<{ callback_number: string | null }[]>`
      select callback_number from users where id = ${shop.userId}`;
    expect(user!.callback_number).toBeNull();
  });

  it("mints a browser token scoped to the caller", async () => {
    const shop = await seedShop("Calls Token Org");
    const issued = await appRouter.createCaller(ctxFor(shop.orgId, shop.userId)).v1.calls.browserToken();
    expect(issued.identity).toBe(`user-${shop.userId}`);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());
  });

  // Browser calling degrading is NOT a failure — the phone bridge is a complete feature — but a
  // client asking for something the account cannot do must be told so, not silently downgraded.
  it("refuses browser calling cleanly when it is not configured for the account", async () => {
    const shop = await seedShop("Calls NoToken Org");
    const noIssuer: Context = {
      ...ctxFor(shop.orgId, shop.userId),
      deps: { ...stubDeps, voiceTokenIssuer: null } as unknown as Context["deps"],
    };
    await expect(appRouter.createCaller(noIssuer).v1.calls.browserToken()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      appRouter.createCaller(noIssuer).v1.calls.place({ leadId: shop.leadId, transport: "browser" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("the me DTO carries the caller's own callback number", async () => {
    const shop = await seedShop("Calls Me Org");
    const caller = appRouter.createCaller(ctxFor(shop.orgId, shop.userId));

    expect((await caller.v1.identity.me()).callbackNumber).toBeNull();
    await caller.v1.calls.setCallbackNumber({ callbackNumber: "(781) 385-0591" });
    expect((await caller.v1.identity.me()).callbackNumber).toBe("+17813850591");
  });

  it("updateMe returns the org's real business line, not a hard-coded null", async () => {
    const shop = await seedShop("Calls UpdateMe Org");
    const result = await appRouter.createCaller(ctxFor(shop.orgId, shop.userId)).v1.identity.updateMe({ name: "Mike Rivera" });
    expect(result.name).toBe("Mike Rivera");
    expect(result.twilioNumber).toBe(shop.line);
  });
});
