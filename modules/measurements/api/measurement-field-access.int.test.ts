import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Estimating part 3 opened room capture to the FIELD: ingest + room CRUD are anyRole with the
// same assignment gate the field router uses. These tests prove the new boundary end-to-end:
//   • a tech ASSIGNED to the job can ingest a scan / add a manual room / list / rename / archive
//   • an UNASSIGNED tech is FORBIDDEN on every one of those
//   • quantity confirm/override and the site-tracer surface remain office-only (FORBIDDEN for
//     any tech, assigned or not) — resolving numbers into the record is desk work.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
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

// Same rectangular-room wire payload the router capstone test uses.
const geometry = {
  floor_polygon: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
  },
  walls: [
    { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 0 }] } },
  ],
  openings: [
    { kind: "door", width: 0.9, height: 2.0, wall_index: 0 },
    { kind: "window", width: 1.2, height: 1.0, wall_index: 0 },
  ],
  ceiling: { area: 12, is_vaulted: false, wall_top_spread: 0, provenance: "roomplan" },
};

suite("v1.measurements — field (tech) access boundary (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let assignedTechId = "";
  let otherTechId = "";
  let leadId = "";
  let jobId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('MeasField Org ' || gen_random_uuid()) returning id`;
    orgId = org!.id;
    const [tA] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'assigned@measfield.test', 'tech') returning id`;
    assignedTechId = tA!.id;
    const [tB] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'other@measfield.test', 'tech') returning id`;
    otherTechId = tB!.id;
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'MeasField Customer') returning id`;
    leadId = lead!.id;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, svc, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-MF-1', 'scheduled', 0, 'estimate', ${assignedTechId})
      returning id`;
    jobId = j!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("an ASSIGNED tech ingests a scan and lists it back", async () => {
    const caller = appRouter.createCaller(ctxFor(assignedTechId, orgId, "tech"));
    const ingested = await caller.v1.measurements.ingestScan({
      jobId,
      roomName: "Kitchen",
      capturedAt: new Date("2026-08-01T00:00:00Z").toISOString(),
      rawPayload: { raw: "payload" },
      geometry,
    });
    expect(ingested.jobId).toBe(jobId);
    expect(ingested.roomName).toBe("Kitchen");

    const listed = await caller.v1.measurements.list({ jobId });
    expect(listed.some((r) => r.id === ingested.id)).toBe(true);
  });

  it("an ASSIGNED tech can rename and archive a room they captured", async () => {
    const caller = appRouter.createCaller(ctxFor(assignedTechId, orgId, "tech"));
    const room = await caller.v1.measurements.createManualRoom({
      jobId,
      roomName: "Hall",
      quantities: [{ kind: "walls_sqft", value: 120 }],
    });
    const renamed = await caller.v1.measurements.renameRoom({ captureId: room.id, roomName: "Hallway" });
    expect(renamed.roomName).toBe("Hallway");
    const archived = await caller.v1.measurements.archiveRoom({ captureId: room.id });
    expect(archived.ok).toBe(true);
  });

  it("an UNASSIGNED tech is FORBIDDEN on ingest, create, list, rename and archive", async () => {
    const stranger = appRouter.createCaller(ctxFor(otherTechId, orgId, "tech"));
    await expect(
      stranger.v1.measurements.ingestScan({
        jobId,
        roomName: "Nope",
        capturedAt: new Date().toISOString(),
        rawPayload: {},
        geometry,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      stranger.v1.measurements.createManualRoom({ jobId, roomName: "Nope", quantities: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stranger.v1.measurements.list({ jobId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Capture-scoped procedures resolve the capture → job first, then refuse.
    const owner = appRouter.createCaller(ctxFor(assignedTechId, orgId, "tech"));
    const room = await owner.v1.measurements.createManualRoom({
      jobId,
      roomName: "Guard room",
      quantities: [],
    });
    await expect(
      stranger.v1.measurements.renameRoom({ captureId: room.id, roomName: "Mine now" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      stranger.v1.measurements.archiveRoom({ captureId: room.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quantity confirm/override stay OFFICE-only — even the assigned tech is refused", async () => {
    const caller = appRouter.createCaller(ctxFor(assignedTechId, orgId, "tech"));
    const room = await caller.v1.measurements.createManualRoom({
      jobId,
      roomName: "Office-only checks",
      quantities: [{ kind: "walls_sqft", value: 100 }],
    });
    await expect(
      caller.v1.measurements.overrideQuantity({ captureId: room.id, kind: "walls_sqft", value: 110 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.v1.measurements.confirmQuantity({ captureId: room.id, kind: "walls_sqft", value: 100 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the site-tracer surface stays OFFICE-only for techs", async () => {
    const caller = appRouter.createCaller(ctxFor(assignedTechId, orgId, "tech"));
    await expect(caller.v1.measurements.siteList({ jobId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.v1.measurements.siteCreate({
        jobId,
        name: "Roof",
        source: "manual",
        surface: "flat",
        areaSqft: 900,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
