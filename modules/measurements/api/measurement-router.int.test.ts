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

    const baseboard = ingested.quantities.find((q) => q.kind === "baseboard_lnft");
    expect(baseboard?.status).toBe("derived");
    expect(baseboard?.value).toBeGreaterThan(0);

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
});
