import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asJobId, isOk, type OrgId, type JobId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { RoomCapture } from "../domain/room-capture";
import { derivePaintingQuantities, type PaintingQuantity } from "../domain/derive-painting";
import type { NormalizedGeometry } from "../domain/normalized-geometry";
import { SupersedeTargetError } from "../domain/measurement-repository";
import { DrizzleMeasurementRepository } from "./drizzle-measurement-repository";

// Live RLS integration: proves the createCapture/supersede/listByJob/setQuantity contract
// against the real Supabase DB — jsonb geometry round-trip fidelity, the supersede chain,
// the immutable derivedValue on override, and cross-org invisibility (RLS + explicit filter).
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const geometry: NormalizedGeometry = {
  floorPolygon: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
  },
  walls: [
    { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 0 }] } },
    { polygon: { vertices: [{ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 4, y: 2.4, z: 3 }, { x: 4, y: 2.4, z: 0 }] } },
    { polygon: { vertices: [{ x: 4, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }, { x: 0, y: 2.4, z: 3 }, { x: 4, y: 2.4, z: 3 }] } },
    { polygon: { vertices: [{ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 3 }] } },
  ],
  openings: [
    { kind: "door", width: 0.9, height: 2.0, wallIndex: 0 },
    { kind: "window", width: 1.2, height: 1.0, wallIndex: 1 },
  ],
  ceiling: { area: 12, isVaulted: false, wallTopSpread: 0, provenance: "roomplan" },
};

const buildCapture = (
  orgId: OrgId,
  jobId: JobId,
  overrides: Partial<{ id: string; roomName: string; capturedAt: Date; supersededById: string | null }> = {},
): { capture: RoomCapture; quantities: PaintingQuantity[] } => {
  const now = overrides.capturedAt ?? new Date("2026-07-01T00:00:00Z");
  const r = RoomCapture.create({
    id: overrides.id ?? randomUUID(),
    orgId,
    jobId,
    roomName: overrides.roomName ?? "Living Room",
    source: "roomplan_v1",
    rawPayload: { raw: "payload", nested: { deep: [1, 2, 3] } },
    geometry,
    capturedAt: now,
    supersededById: overrides.supersededById ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return { capture: r.value, quantities: derivePaintingQuantities(geometry) };
};

suite("DrizzleMeasurementRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let jobAId = "";
  let jobA2Id = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('MeasRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('MeasRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    leadAId = la!.id;
    // jobs.lead_id is a composite FK on (org_id, lead_id) -> leads(org_id, id) — org B needs
    // its own lead, a lead from org A cannot satisfy org B's job FK.
    const [lb] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    const [ja] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgAId}, 'JOB-MR-A1', ${leadAId}, 'complete') returning id`;
    // A second job under org A — used to prove supersede refuses to chain a next-capture onto
    // an old capture that belongs to a different job.
    const [ja2] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgAId}, 'JOB-MR-A2', ${leadAId}, 'complete') returning id`;
    await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgBId}, 'JOB-MR-B1', ${lb!.id}, 'complete') returning id`;
    jobAId = ja!.id;
    jobA2Id = ja2!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("createCapture then listByJob round-trips the capture incl. byte-faithful jsonb geometry", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture, quantities } = buildCapture(orgA, jobA);

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(capture, quantities);
    });

    const list = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.listByJob(jobA);
    });

    expect(list).toHaveLength(1);
    const found = list[0]!;
    expect(found.capture.props.id).toBe(capture.props.id);
    expect(found.capture.props.roomName).toBe("Living Room");
    // Byte-faithful deep equality of the parsed geometry object round-tripped through jsonb.
    expect(found.capture.props.geometry).toEqual(geometry);
    expect(found.capture.props.rawPayload).toEqual({ raw: "payload", nested: { deep: [1, 2, 3] } });
    expect(found.quantities).toHaveLength(quantities.length);
    for (const q of quantities) {
      const stored = found.quantities.find((s) => s.kind === q.kind);
      expect(stored).toBeDefined();
      expect(stored!.value).toBe(q.value);
      expect(stored!.derivedValue).toBe(q.value);
      expect(stored!.status).toBe(q.status);
    }
  });

  it("supersede chain: the old capture drops out of listByJob, the new one appears", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture: first, quantities: q1 } = buildCapture(orgA, jobA, {
      roomName: "Bedroom",
      capturedAt: new Date("2026-07-02T00:00:00Z"),
    });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(first, q1);
    });

    const { capture: second, quantities: q2 } = buildCapture(orgA, jobA, {
      roomName: "Bedroom (re-scan)",
      capturedAt: new Date("2026-07-03T00:00:00Z"),
    });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.supersede(first.props.id, second, q2);
    });

    const list = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.listByJob(jobA);
    });

    const ids = list.map((r) => r.capture.props.id);
    expect(ids).toContain(second.props.id);
    expect(ids).not.toContain(first.props.id);

    // The old capture still exists (soft chain, not deleted) and points at the new one.
    const oldRow = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(first.props.id);
    });
    expect(oldRow?.capture.props.supersededById).toBe(second.props.id);
  });

  it("supersede with a nonexistent oldId throws and creates no new capture row", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture: next, quantities } = buildCapture(orgA, jobA, { roomName: "Ghost re-scan" });
    const ghostOldId = randomUUID();

    await expect(
      withTenant(orgA, async (tx) => {
        const repo = new DrizzleMeasurementRepository(tx, orgA);
        await repo.supersede(ghostOldId, next, quantities);
      }),
    ).rejects.toBeInstanceOf(SupersedeTargetError);

    const found = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(next.props.id);
    });
    expect(found).toBeNull();
  });

  it("supersede where next belongs to a different job than the old capture throws, creates nothing", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const jobA2 = asJobId(jobA2Id);
    const { capture: old, quantities: qOld } = buildCapture(orgA, jobA, { roomName: "Kitchen" });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(old, qOld);
    });

    // `next` is scoped to job A2 while `old` belongs to job A — a supersede must never cross jobs.
    const { capture: next, quantities: qNext } = buildCapture(orgA, jobA2, { roomName: "Kitchen re-scan" });

    await expect(
      withTenant(orgA, async (tx) => {
        const repo = new DrizzleMeasurementRepository(tx, orgA);
        await repo.supersede(old.props.id, next, qNext);
      }),
    ).rejects.toBeInstanceOf(SupersedeTargetError);

    const oldStillCurrent = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(old.props.id);
    });
    expect(oldStillCurrent?.capture.props.supersededById).toBeNull();

    const nextRow = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(next.props.id);
    });
    expect(nextRow).toBeNull();
  });

  it("listByJob returns current captures newest-first", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture: older, quantities: qo } = buildCapture(orgA, jobA, {
      roomName: "Hallway older",
      capturedAt: new Date("2026-07-04T00:00:00Z"),
    });
    const { capture: newer, quantities: qn } = buildCapture(orgA, jobA, {
      roomName: "Hallway newer",
      capturedAt: new Date("2026-07-05T00:00:00Z"),
    });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(older, qo);
      await repo.createCapture(newer, qn);
    });

    const list = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.listByJob(jobA);
    });

    const olderIdx = list.findIndex((r) => r.capture.props.id === older.props.id);
    const newerIdx = list.findIndex((r) => r.capture.props.id === newer.props.id);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("setQuantity overrides the working value but keeps derivedValue immutable", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture, quantities } = buildCapture(orgA, jobA, { roomName: "Office" });
    const wallsQuantity = quantities.find((q) => q.kind === "walls_sqft")!;

    const affected = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(capture, quantities);
      return repo.setQuantity(capture.props.id, "walls_sqft", { value: 999.9, status: "override" });
    });
    expect(affected).toBe(1);

    const after = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(capture.props.id);
    });

    const stored = after!.quantities.find((q) => q.kind === "walls_sqft")!;
    expect(stored.value).toBe(999.9);
    expect(stored.status).toBe("override");
    expect(stored.derivedValue).toBe(wallsQuantity.value);
  });

  it("setQuantity on a kind that doesn't exist for the capture returns 0 (no silent no-op)", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture, quantities } = buildCapture(orgA, jobA, { roomName: "Office 2" });

    const affected = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(capture, quantities);
      // "windows_count" exists on this capture; a nonexistent capture id can never match.
      return repo.setQuantity(randomUUID(), "windows_count", { value: 3, status: "confirmed" });
    });
    expect(affected).toBe(0);
  });

  it("renameRoom and archive mutate/soft-delete only within the owning org", async () => {
    const orgA = asOrgId(orgAId);
    const jobA = asJobId(jobAId);
    const { capture, quantities } = buildCapture(orgA, jobA, { roomName: "Den" });

    const renameAffected = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(capture, quantities);
      return repo.renameRoom(capture.props.id, "Den (renamed)");
    });
    expect(renameAffected).toBe(1);

    const renamed = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(capture.props.id);
    });
    expect(renamed?.capture.props.roomName).toBe("Den (renamed)");

    const archiveAffected = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.archive(capture.props.id);
    });
    expect(archiveAffected).toBe(1);

    const archived = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.getCapture(capture.props.id);
    });
    expect(archived).toBeNull();

    const listAfterArchive = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.listByJob(jobA);
    });
    expect(listAfterArchive.map((r) => r.capture.props.id)).not.toContain(capture.props.id);
  });

  it("cross-org invisibility: a capture created under org A is invisible under org B", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);
    const jobA = asJobId(jobAId);
    const { capture, quantities } = buildCapture(orgA, jobA, { roomName: "Org A only" });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(capture, quantities);
    });

    const fromOrgB = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgB);
      return repo.getCapture(capture.props.id);
    });
    expect(fromOrgB).toBeNull();

    const listFromOrgB = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgB);
      return repo.listByJob(jobA);
    });
    expect(listFromOrgB).toEqual([]);
  });

  it("listByJob skips a capture with corrupt geometry and returns only the healthy one; getCapture on the corrupt id throws", async () => {
    const orgA = asOrgId(orgAId);
    // A dedicated job, isolated from the other captures already accumulated on jobAId by the
    // earlier tests in this suite — so the length assertion below is unambiguous.
    const [jc] = await admin<{ id: string }[]>`insert into jobs (org_id, num, lead_id, status) values (${orgAId}, 'JOB-MR-CORRUPT', ${leadAId}, 'complete') returning id`;
    const jobCorruptId = jc!.id;
    const jobA = asJobId(jobCorruptId);
    const { capture: healthy, quantities } = buildCapture(orgA, jobA, { roomName: "Sunroom" });

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      await repo.createCapture(healthy, quantities);
    });

    // Bypass the domain/repository write path entirely — insert a deliberately-corrupt geometry
    // row (fails NormalizedGeometry's zod schema: `walls` must be an array) directly via the
    // admin client, the only way to get unparseable jsonb past `toWireGeometry` into the table.
    const corruptId = randomUUID();
    await admin`
      insert into room_captures (id, org_id, job_id, room_name, source, raw_payload, geometry, captured_at)
      values (
        ${corruptId}, ${orgAId}, ${jobCorruptId}, 'Corrupt Room', 'roomplan_v1',
        ${admin.json({ raw: "payload" })}, ${admin.json({ walls: "not-an-array" })}, now()
      )
    `;

    const list = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleMeasurementRepository(tx, orgA);
      return repo.listByJob(jobA);
    });

    expect(list).toHaveLength(1);
    expect(list[0]!.capture.props.id).toBe(healthy.props.id);
    expect(list.map((r) => r.capture.props.id)).not.toContain(corruptId);

    await expect(
      withTenant(orgA, async (tx) => {
        const repo = new DrizzleMeasurementRepository(tx, orgA);
        return repo.getCapture(corruptId);
      }),
    ).rejects.toThrow(/corrupt room_capture/);
  });
});
