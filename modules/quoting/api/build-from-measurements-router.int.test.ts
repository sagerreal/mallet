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

// Capstone for BuildFromMeasurementsUseCase: real org, a pricebook with measured-by services, a
// job with a manually-measured room → v1.quoting.buildFromMeasurements produces the correct seed
// lines and gaps through the whole stack (RBAC, tenant tx, live RLS, real Drizzle repos).
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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("v1.quoting.buildFromMeasurements (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('BuildFromMeasurements A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('BuildFromMeasurements B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("job absent returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.quoting.buildFromMeasurements({ jobId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("builds seed lines for kinds with a priced service and gaps for kinds without one", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    // Two measured-by services (walls, doors); ceiling/baseboard/crown/windows are left
    // unpriced on purpose so they surface as gaps.
    const wallsService = await caller.v1.pricebook.service.create({
      name: "Paint walls",
      unitPriceCents: 250,
      costCents: 90,
      measuredBy: "walls_sqft",
      position: 1,
    });
    await caller.v1.pricebook.service.create({
      name: "Paint walls (premium)",
      unitPriceCents: 500,
      costCents: 200,
      measuredBy: "walls_sqft",
      position: 9, // higher position — should lose to wallsService
    });
    const doorsService = await caller.v1.pricebook.service.create({
      name: "Paint door",
      unitPriceCents: 4_500,
      costCents: 1_200,
      measuredBy: "doors_count",
      position: 1,
    });

    const job = await caller.v1.jobs.create({ leadId: leadAId, title: "Living room repaint" });

    // Supply a value for every kind so the room has nothing left needs_confirm (isolates the
    // gaps/seed-line assertions from the separate hasUnconfirmed law, covered in the unit tests).
    await caller.v1.measurements.createManualRoom({
      jobId: job.id,
      roomName: "Living Room",
      quantities: [
        { kind: "walls_sqft", value: 240 },
        { kind: "ceiling_sqft", value: 120 },
        { kind: "baseboard_lnft", value: 60 },
        { kind: "crown_lnft", value: 60 },
        { kind: "doors_count", value: 2 },
        { kind: "windows_count", value: 3 },
      ],
    });

    const result = await caller.v1.quoting.buildFromMeasurements({ jobId: job.id });

    expect(result.leadId).toBe(leadAId);
    expect(result.unconfirmedRooms).toEqual([]);

    expect(result.seedLines).toHaveLength(2);
    const wallsLine = result.seedLines.find((l) => l.measuredKind === "walls_sqft");
    expect(wallsLine).toMatchObject({
      description: "Living Room — Paint walls",
      quantity: 240,
      rateCents: wallsService.unitPriceCents,
      costCents: wallsService.costCents,
      roomName: "Living Room",
    });
    const doorsLine = result.seedLines.find((l) => l.measuredKind === "doors_count");
    expect(doorsLine).toMatchObject({
      description: "Living Room — Paint door",
      quantity: 2,
      rateCents: doorsService.unitPriceCents,
      costCents: doorsService.costCents,
      roomName: "Living Room",
    });

    const gapKinds = result.gaps.map((g) => g.kind).sort();
    expect(gapKinds).toEqual(["baseboard_lnft", "ceiling_sqft", "crown_lnft", "windows_count"].sort());
    expect(result.gaps.find((g) => g.kind === "ceiling_sqft")?.label).toBe("Ceiling");
  });

  it("a different org's job is not found (tenant isolation)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const job = await callerA.v1.jobs.create({ leadId: leadAId, title: "Org A job" });

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.quoting.buildFromMeasurements({ jobId: job.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      caller.v1.quoting.buildFromMeasurements({ jobId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
