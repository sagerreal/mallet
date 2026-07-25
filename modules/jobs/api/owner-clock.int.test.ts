import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import type { PhotoStorageGateway } from "../domain/photo-storage-gateway";

// WHOSE taps produce hours. Its own file because the sibling field-router suite closes the shared
// DB pool in its teardown, and two suites sharing that pool in one file race it.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (userId: string, orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
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
    signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },
  },
});

// Owen: "shouldn't taps produce time for owners as well? I think that's dumb."
//
// He was right, and the plan said so: in a 1-3 technician shop the owner IS usually a working
// technician, so half the jobs are theirs. Recording none of that time left job costing unable to
// answer the only question it exists for.
//
// The gate is now ASSIGNMENT, not role. Whoever the work belongs to gets the hours; whoever is
// merely moving somebody else's visit is dispatching, and dispatching records nothing.
suite("whose taps produce hours (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let ownerId = "";
  let techId = "";
  let ownerJobId = "";
  let techJobId = "";

  const hoursFor = async (userId: string) =>
    admin<{ kind: string; job_id: string | null }[]>`
      select kind, job_id from time_entries
      where org_id = ${orgId} and tech_user_id = ${userId} and deleted_at is null`;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('OwnerClock ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'owner@ownerclock.test', 'owner', true) returning id`;
    ownerId = ow!.id;
    const [tc] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'tech@ownerclock.test', 'tech', true) returning id`;
    techId = tc!.id;
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Owner Clock Customer') returning id`;
    // The owner-operator's OWN job, and a job that belongs to the technician.
    const [j1] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${lead!.id}, 'JOB-OWN-01', 'scheduled', 0, ${ownerId}) returning id`;
    ownerJobId = j1!.id;
    const [j2] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${lead!.id}, 'JOB-TECH-01', 'scheduled', 0, ${techId}) returning id`;
    techJobId = j2!.id;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("an owner-operator working their OWN job records job time", async () => {
    const caller = appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));
    await caller.v1.field.start({ jobId: ownerJobId });

    const hours = await hoursFor(ownerId);
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ kind: "job", job_id: ownerJobId });
  });

  it("an owner moving a TECHNICIAN's job records nothing — that is dispatching, not work", async () => {
    const caller = appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));
    await caller.v1.field.start({ jobId: techJobId });

    // Still only the owner's own job from the previous test; the technician's job added nothing.
    const hours = await hoursFor(ownerId);
    expect(hours.filter((h) => h.job_id === techJobId)).toHaveLength(0);
  });

  it("does not file the technician's work against the technician either, when an owner moved it", async () => {
    // The hours belong to whoever DID the work, and nobody has claimed this visit yet.
    expect(await hoursFor(techId)).toHaveLength(0);
  });

  it("a technician working their own job still records job time", async () => {
    // A FRESH job: the technician's other one was already moved to in_progress by the owner's
    // dispatch above, and this asserts the ordinary path rather than a recovery.
    const [lead] = await admin<{ id: string }[]>`
      select id from leads where org_id = ${orgId} limit 1`;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${lead!.id}, 'JOB-TECH-02', 'scheduled', 0, ${techId}) returning id`;

    const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
    await caller.v1.field.start({ jobId: j!.id });

    const hours = await hoursFor(techId);
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ kind: "job", job_id: j!.id });
  });

  // Worth stating, because it is the documented cost of refusing to invent hours: job ATTRIBUTION
  // comes from the arrival tap. A technician who taps only Done still gets paid (the day clock
  // bounds the day) but that work lands as unattributed `shop` time, because nothing in the system
  // knows which job they were on. Guessing would be worse than a gap in a report.
  it("Done alone cannot invent job time — attribution comes from arriving", async () => {
    const [lead] = await admin<{ id: string }[]>`
      select id from leads where org_id = ${orgId} limit 1`;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${lead!.id}, 'JOB-TECH-03', 'in_progress', 0, ${techId}) returning id`;
    const [other] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'never-tapped@ownerclock.test', 'tech', true) returning id`;
    await admin`update jobs set assignee_user_id = ${other!.id} where id = ${j!.id}`;

    const caller = appRouter.createCaller(ctxFor(other!.id, orgId, "tech"));
    await caller.v1.field.complete({ jobId: j!.id });

    expect(await hoursFor(other!.id)).toHaveLength(0);
  });
});
