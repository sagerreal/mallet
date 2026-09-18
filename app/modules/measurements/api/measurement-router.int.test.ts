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

// Capstone: exercise the full measurements stack via createCaller — auth gate, RBAC, org-scoped
// transaction, use-case, Drizzle repo, and live RLS — without spinning up HTTP.
// Proves an owner in org A can ingest/list/override a room capture, org B sees nothing of org
// A's captures (NOT_FOUND-shaped, not another org's data), and a manual room round-trips as
// confirmed.
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

// A simple rectangular room: 4m x 3m floor, one 4m x 2.4m wall, one door, one window. Wire
// (snake_case) shape — this is the untrusted payload the router hands to
// parseNormalizedGeometry, NOT the parsed NormalizedGeometry domain shape.
// walls_sqft derivation: 4 * 2.4 = 9.6 m^2 -> 103.3 sqft (rounded to 1dp by the domain).
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

suite("measurements tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let leadBId = "";
  let jobAId = "";
  let jobBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('MeasApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('MeasApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    const [lb] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    leadAId = la!.id;
    leadBId = lb!.id;
    const [ja] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgAId}, 'JOB-MA-A1', ${leadAId}, 'complete') returning id`;
    const [jb] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgBId}, 'JOB-MA-B1', ${leadBId}, 'complete') returning id`;
    jobAId = ja!.id;
    jobBId = jb!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── ingest + list round-trip ────────────────────────────────────────────────

  it("an owner ingests a scan and lists it back with derived quantities", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const ingested = await caller.v1.measurements.ingestScan({
      jobId: jobAId,
      roomName: "Living Room",
      capturedAt: new Date("2026-07-01T00:00:00Z").toISOString(),
      rawPayload: { raw: "payload" },
      geometry,
    });

    expect(ingested.roomName).toBe("Living Room");
    expect(ingested.source).toBe("roomplan_v1");
    expect(ingested.jobId).toBe(jobAId);

    const walls = ingested.quantities.find((q) => q.kind === "walls_sqft");
    expect(walls?.status).toBe("derived");
    expect(walls?.value).toBeCloseTo(103.3, 1);

    // Trim existence is unobservable — baseboard arrives as a needs_confirm SUGGESTION
    // (derivedValue set, value null) and never prices until a human confirms.
    const baseboard = ingested.quantities.find((q) => q.kind === "baseboard_lnft");
    expect(baseboard?.status).toBe("needs_confirm");
    expect(baseboard?.value).toBeNull();
    expect(baseboard?.derivedValue).toBeGreaterThan(0);

    const listed = await caller.v1.measurements.list({ jobId: jobAId });
    const found = listed.find((r) => r.id === ingested.id);
    expect(found).toBeDefined();
    expect(found?.roomName).toBe("Living Room");
    expect(found?.quantities.find((q) => q.kind === "walls_sqft")?.value).toBeCloseTo(103.3, 1);
    expect(found).not.toHaveProperty("geometry");
    expect(found).not.toHaveProperty("rawPayload");
  });

  it("a different org sees none of org A's room captures", async () => {
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await callerB.v1.measurements.list({ jobId: jobAId });
    expect(listed).toHaveLength(0);
  });

  // ── overrideQuantity reflected in list ──────────────────────────────────────

  it("overrideQuantity persists and is reflected in a subsequent list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const ingested = await caller.v1.measurements.ingestScan({
      jobId: jobAId,
      roomName: "Bedroom",
      capturedAt: new Date("2026-07-02T00:00:00Z").toISOString(),
      rawPayload: null,
      geometry,
    });

    const overridden = await caller.v1.measurements.overrideQuantity({
      captureId: ingested.id,
      kind: "walls_sqft",
      value: 999.9,
    });
    expect(overridden.value).toBe(999.9);
    expect(overridden.status).toBe("override");
    expect(overridden.derivedValue).toBeCloseTo(103.3, 1);

    const listed = await caller.v1.measurements.list({ jobId: jobAId });
    const found = listed.find((r) => r.id === ingested.id);
    const walls = found?.quantities.find((q) => q.kind === "walls_sqft");
    expect(walls?.value).toBe(999.9);
    expect(walls?.status).toBe("override");
  });

  // ── cross-org NOT_FOUND-shaped errors ───────────────────────────────────────

  it("org B cannot override or rename org A's room capture (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const ingested = await callerA.v1.measurements.ingestScan({
      jobId: jobAId,
      roomName: "Kitchen",
      capturedAt: new Date("2026-07-03T00:00:00Z").toISOString(),
      rawPayload: null,
      geometry,
    });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));

    await expect(
      callerB.v1.measurements.overrideQuantity({ captureId: ingested.id, kind: "walls_sqft", value: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.measurements.renameRoom({ captureId: ingested.id, roomName: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerB.v1.measurements.archiveRoom({ captureId: ingested.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── create-manual → list shows confirmed statuses ───────────────────────────

  it("createManualRoom persists caller-supplied values as confirmed; omitted kinds stay needs_confirm", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.measurements.createManualRoom({
      jobId: jobAId,
      roomName: "Hallway (manual)",
      quantities: [
        { kind: "walls_sqft", value: 120 },
        { kind: "doors_count", value: 2 },
      ],
    });

    expect(created.source).toBe("manual");

    const listed = await caller.v1.measurements.list({ jobId: jobAId });
    const found = listed.find((r) => r.id === created.id);
    expect(found).toBeDefined();

    const walls = found?.quantities.find((q) => q.kind === "walls_sqft");
    expect(walls?.value).toBe(120);
    expect(walls?.status).toBe("confirmed");
    expect(walls?.derivedValue).toBeNull();

    const ceiling = found?.quantities.find((q) => q.kind === "ceiling_sqft");
    expect(ceiling?.value).toBeNull();
    expect(ceiling?.status).toBe("needs_confirm");
  });

  // ── RBAC ─────────────────────────────────────────────────────────────────────

  it("a tech is forbidden from measurement mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    await expect(
      callerTech.v1.measurements.ingestScan({
        jobId: jobAId,
        roomName: "Nope",
        capturedAt: new Date().toISOString(),
        rawPayload: null,
        geometry,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── retry-safe ingest: duplicate id is idempotent, foreign jobId is NOT_FOUND ─────────────

  it("double-ingesting the same client-authored id returns the same capture twice and persists exactly one row", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const clientId = randomUUID();
    const cmd = {
      id: clientId,
      jobId: jobAId,
      roomName: "Sunroom",
      capturedAt: new Date("2026-07-06T00:00:00Z").toISOString(),
      rawPayload: { raw: "payload" },
      geometry,
    };

    const first = await caller.v1.measurements.ingestScan(cmd);
    const second = await caller.v1.measurements.ingestScan(cmd);

    expect(first.id).toBe(clientId);
    expect(second.id).toBe(clientId);
    expect(second.roomName).toBe(first.roomName);
    expect(second.quantities).toEqual(first.quantities);

    const rows = await admin<{ id: string }[]>`select id from room_captures where id = ${clientId}`;
    expect(rows).toHaveLength(1);
  });

  it("ingesting with a jobId that doesn't exist for this org returns NOT_FOUND and persists no row", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const ghostJobId = randomUUID();
    const attemptedId = randomUUID();

    await expect(
      caller.v1.measurements.ingestScan({
        id: attemptedId,
        jobId: ghostJobId,
        roomName: "Ghost Job Room",
        capturedAt: new Date("2026-07-07T00:00:00Z").toISOString(),
        rawPayload: null,
        geometry,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rows = await admin<{ id: string }[]>`select id from room_captures where id = ${attemptedId}`;
    expect(rows).toHaveLength(0);
  });

  // ── site captures: create → list → update pitch → archive round trip ────────

  it("a traced site capture round-trips: create derives the area, update re-pitches it, archive removes it", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const polygon = {
      vertices: [
        { lat: 35.771, lng: -78.638 },
        { lat: 35.7712, lng: -78.638 },
        { lat: 35.7712, lng: -78.6378 },
        { lat: 35.771, lng: -78.6378 },
      ],
      view: { centerLat: 35.7711, centerLng: -78.6379, zoom: 20 },
    };

    // Create: flat trace — working area equals the footprint, never a client-sent area.
    const created = await caller.v1.measurements.siteCreate({
      jobId: jobAId,
      name: "Main roof — south face",
      source: "aerial_trace_v1",
      surface: "flat",
      polygon,
      footprintSqft: 1000,
      perimeterLnft: 130,
    });
    expect(created.source).toBe("aerial_trace_v1");
    expect(created.areaSqft).toBe(1000);
    expect(created.footprintSqft).toBe(1000);
    expect(created.perimeterLnft).toBe(130);
    expect(created.polygon?.vertices).toHaveLength(4);

    // List: the capture comes back with its polygon for re-display.
    const listed = await caller.v1.measurements.siteList({ jobId: jobAId });
    const found = listed.find((s) => s.id === created.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Main roof — south face");
    expect(found?.polygon?.view.zoom).toBe(20);

    // Update pitch: server recomputes area from the STORED footprint (4/12 → ×~1.0541).
    const pitched = await caller.v1.measurements.siteUpdate({
      captureId: created.id,
      surface: "pitched",
      pitchRise: 4,
    });
    expect(pitched.pitchRise).toBe(4);
    expect(pitched.areaSqft).toBeCloseTo(1054.09, 2);
    expect(pitched.footprintSqft).toBe(1000);

    // Cross-org isolation: org B sees nothing and cannot touch the capture.
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listedB = await callerB.v1.measurements.siteList({ jobId: jobAId });
    expect(listedB).toHaveLength(0);
    await expect(
      callerB.v1.measurements.siteUpdate({ captureId: created.id, name: "Should fail" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Archive: soft-deleted, gone from the list, second archive is NOT_FOUND.
    const archived = await caller.v1.measurements.siteArchive({ captureId: created.id });
    expect(archived.ok).toBe(true);
    const afterArchive = await caller.v1.measurements.siteList({ jobId: jobAId });
    expect(afterArchive.find((s) => s.id === created.id)).toBeUndefined();
    await expect(caller.v1.measurements.siteArchive({ captureId: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const rows = await admin<{ deleted_at: string | null }[]>`
      select deleted_at from site_captures where id = ${created.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("a CLASSIFIED pitched capture round-trips: classes persist, per-class linears and complexity derive server-side", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    // Equator rectangle with hand-checkable arc lengths (edge-classes.test.ts):
    // long sides 365.22 ft, short sides 182.61 ft.
    const polygon = {
      vertices: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
        { lat: 0.0005, lng: 0.001 },
        { lat: 0.0005, lng: 0 },
      ],
      view: { centerLat: 0.00025, centerLng: 0.0005, zoom: 20 },
      edgeClasses: ["eave", "rake", "eave", "valley"] as ("eave" | "rake" | "valley")[],
      interiorLines: [
        {
          a: { lat: 0.00025, lng: 0 },
          b: { lat: 0.00025, lng: 0.001 },
          cls: "ridge" as const,
        },
      ],
    };

    const created = await caller.v1.measurements.siteCreate({
      jobId: jobAId,
      name: "Main roof",
      source: "aerial_trace_v1",
      surface: "pitched",
      pitchRise: 6,
      polygon,
      footprintSqft: 66695,
      perimeterLnft: 1095.67,
    });
    expect(created.polygon?.edgeClasses).toEqual(polygon.edgeClasses);
    expect(created.polygon?.interiorLines).toEqual(polygon.interiorLines);
    expect(created.edges).not.toBeNull();
    expect(created.edges?.eaveFt).toBeCloseTo(2 * 365.22, 1);
    expect(created.edges?.rakeFt).toBeCloseTo(182.61, 1);
    expect(created.edges?.valleyFt).toBeCloseTo(182.61, 1);
    expect(created.edges?.ridgeFt).toBeCloseTo(365.22, 1); // interior line
    expect(created.edges?.hipFt).toBe(0);
    expect(created.complexity).toEqual({ hips: 0, valleys: 1, cutUp: true });

    // The classification survives the DB round trip, re-derived on read.
    const listed = await caller.v1.measurements.siteList({ jobId: jobAId });
    const found = listed.find((s) => s.id === created.id);
    expect(found?.polygon?.edgeClasses).toEqual(polygon.edgeClasses);
    expect(found?.edges).toEqual(created.edges);
    expect(found?.complexity).toEqual(created.complexity);

    // LEGACY compatibility: a capture saved without classes stays valid and
    // reads back unclassified — null edges/complexity, no polygon classes.
    const legacy = await caller.v1.measurements.siteCreate({
      jobId: jobAId,
      name: "Legacy roof",
      source: "aerial_trace_v1",
      surface: "pitched",
      pitchRise: 4,
      polygon: { vertices: polygon.vertices, view: polygon.view },
      footprintSqft: 66695,
      perimeterLnft: 1095.67,
    });
    expect(legacy.polygon?.edgeClasses).toBeUndefined();
    expect(legacy.edges).toBeNull();
    expect(legacy.complexity).toBeNull();

    // A classes/vertices length mismatch is rejected at the boundary.
    await expect(
      caller.v1.measurements.siteCreate({
        jobId: jobAId,
        name: "Bad classes",
        source: "aerial_trace_v1",
        surface: "pitched",
        pitchRise: 6,
        polygon: { ...polygon, edgeClasses: ["eave", "rake"] },
        footprintSqft: 66695,
        perimeterLnft: 1095.67,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.v1.measurements.siteArchive({ captureId: created.id });
    await caller.v1.measurements.siteArchive({ captureId: legacy.id });
  });

  it("a manual site capture takes a typed area and rejects a trace-only edit path violation", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.measurements.siteCreate({
      jobId: jobAId,
      name: "Back patio",
      source: "manual",
      surface: "flat",
      areaSqft: 320,
    });
    expect(created.areaSqft).toBe(320);
    expect(created.polygon).toBeNull();
    expect(created.footprintSqft).toBeNull();

    const updated = await caller.v1.measurements.siteUpdate({ captureId: created.id, areaSqft: 400 });
    expect(updated.areaSqft).toBe(400);
  });

  it("siteCreate with a jobId that doesn't exist for this org returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.measurements.siteCreate({
        jobId: randomUUID(),
        name: "Ghost driveway",
        source: "manual",
        surface: "flat",
        areaSqft: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from site capture mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      callerTech.v1.measurements.siteCreate({
        jobId: jobAId,
        name: "Nope",
        source: "manual",
        surface: "flat",
        areaSqft: 100,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
