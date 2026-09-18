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
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";
import { scopedEstimateVisit, isScopedNeedsQuote } from "@/features/pipeline/pipeline-utils";
import type { Lead } from "@/lib/store/types";

// v1.field.setVisitNotes — the tech scope write (estimating part 3). The critical unlock this
// endpoint provides: a tech-scoped walkthrough must light up the office pipeline's Quoting
// column "quote it ›" card with ZERO pipeline changes. That read path keys on
// scopedEstimateVisit(leadId, jobs) finding a visit with scopeNotes on a kind:"estimate" job —
// so the last test here maps the returned jobDTO through the SAME dto-mapper the client uses
// and asserts the pipeline predicate fires.
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

suite("v1.field.setVisitNotes — the tech scope write (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let techAId = "";
  let techBId = "";
  let ownerUserId = "";
  let leadId = "";
  let estJobId = ""; // kind:"estimate" job assigned to techA
  let visitId = "";
  let doneJobId = ""; // terminal job assigned to techA
  let doneVisitId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Scope Write Org ' || gen_random_uuid()) returning id`;
    orgId = org!.id;

    const [tA] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techA@scope.test', 'tech') returning id`;
    techAId = tA!.id;
    const [tB] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techB@scope.test', 'tech') returning id`;
    techBId = tB!.id;
    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'owner@scope.test', 'owner') returning id`;
    ownerUserId = ow!.id;

    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, stage) values (${orgId}, 'Scope Customer', 'new') returning id`;
    leadId = lead!.id;

    // The walkthrough: a kind:"estimate" job with a scheduled visit assigned to techA. The svc
    // deliberately holds a TRADE NAME — this is the exact shape the AI front desk writes, which
    // used to render as regular work because every predicate read svc instead of kind.
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, kind, svc, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-SCOPE-1', 'scheduled', 0, 'estimate', 'Water heater repair', ${techAId})
      returning id`;
    estJobId = j!.id;
    const [v] = await admin<{ id: string }[]>`
      insert into job_visits (org_id, job_id, assignee_user_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${orgId}, ${estJobId}, ${techAId}, current_date, '09:00', 60, 'pending')
      returning id`;
    visitId = v!.id;

    // A closed job — the scope must be office-corrected once the job is terminal.
    const [dj] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-SCOPE-2', 'complete', 0, ${techAId})
      returning id`;
    doneJobId = dj!.id;
    const [dv] = await admin<{ id: string }[]>`
      insert into job_visits (org_id, job_id, assignee_user_id, scheduled_date, scheduled_start, duration_minutes, status)
      values (${orgId}, ${doneJobId}, ${techAId}, current_date, '13:00', 60, 'complete')
      returning id`;
    doneVisitId = dv!.id;
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from time_entries where org_id = ${orgId}`;
      // job_visits.assignee FK onto users has no cascade — clear visits (then jobs)
      // before the org delete cascades into users.
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from jobs where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("an UNASSIGNED tech is refused (FORBIDDEN) and writes nothing", async () => {
    const caller = appRouter.createCaller(ctxFor(techBId, orgId, "tech"));
    await expect(
      caller.v1.field.setVisitNotes({ jobId: estJobId, visitId, notes: "not my job" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [row] = await admin<{ notes: string | null }[]>`
      select notes from job_visits where id = ${visitId}`;
    expect(row?.notes).toBeNull();

    // And with no scope written the lead is NOT in the Quoting column's SQL view.
    const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
    const quoting = await office.v1.customers.list({ view: "quoting", limit: 50 });
    expect(quoting.items.some((l) => l.id === leadId)).toBe(false);
  });

  it("the ASSIGNED tech writes the visit's scope notes and gets the refreshed job back", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const dto = await caller.v1.field.setVisitNotes({
      jobId: estJobId,
      visitId,
      notes: "  40 ft of baseboard, two doors, attic access is tight  ",
    });
    const visit = dto.visits.find((v) => v.id === visitId);
    expect(visit?.notes).toBe("40 ft of baseboard, two doors, attic access is tight");
    const [row] = await admin<{ notes: string | null }[]>`
      select notes from job_visits where id = ${visitId}`;
    expect(row?.notes).toBe("40 ft of baseboard, two doors, attic access is tight");
  });

  it("the tech's scope write lights up the office pipeline's quote-it card (end-to-end read path)", async () => {
    // The office reads the SAME job through v1.jobs / the store's dto-mapper — assert the
    // pipeline predicates fire on the mapped store shape, exactly as /pipeline derives them.
    const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
    const dto = await office.v1.jobs.get({ jobId: estJobId });
    const storeJob = dtoJobToStoreJob(dto);
    expect(storeJob.kind).toBe("estimate");

    const scoped = scopedEstimateVisit(storeJob.leadId, [storeJob]);
    expect(scoped?.id).toBe(visitId);
    expect(scoped?.scopeNotes).toBe("40 ft of baseboard, two doors, attic access is tight");

    // No estimate exists for this lead yet → the lead is "scoped, needs a quote".
    const lead = { id: leadId, stage: "New" } as Lead;
    expect(isScopedNeedsQuote(lead, [], [storeJob])).toBe(true);

    // …and the Quoting column's SERVER-side set (leadViewCondition "quoting") now contains the
    // lead — the board's column membership is decided in SQL, so this is the half that actually
    // puts the card on the office screen.
    const quoting = await office.v1.customers.list({ view: "quoting", limit: 50 });
    expect(quoting.items.some((l) => l.id === leadId)).toBe(true);
  });

  it("the office role passes the same endpoint (anyRole, no assignment needed)", async () => {
    const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
    const dto = await office.v1.field.setVisitNotes({
      jobId: estJobId,
      visitId,
      notes: "office correction",
    });
    expect(dto.visits.find((v) => v.id === visitId)?.notes).toBe("office correction");
  });

  it("an empty write clears the scope back to NULL — un-scoping is derived too", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const dto = await caller.v1.field.setVisitNotes({ jobId: estJobId, visitId, notes: "   " });
    expect(dto.visits.find((v) => v.id === visitId)?.notes).toBeNull();
    const [row] = await admin<{ notes: string | null }[]>`
      select notes from job_visits where id = ${visitId}`;
    expect(row?.notes).toBeNull();
  });

  it("a closed job refuses the write with the standard closed-job message", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    await expect(
      caller.v1.field.setVisitNotes({ jobId: doneJobId, visitId: doneVisitId, notes: "too late" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
