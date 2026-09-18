import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, isOk } from "@mallet/shared/types";
import type { NormalizedGeometry } from "../domain/normalized-geometry";
import { RoomCapture } from "../domain/room-capture";
import type { RoomCaptureWithQuantities, MeasurementRepository } from "../domain/measurement-repository";
import type { PaintingQuantity } from "../domain/derive-painting";
import { SetWallOverrideUseCase } from "./set-wall-override";

// ── The room ────────────────────────────────────────────────────────────────
// Two rectangular walls, y-up: 4 m × 2.4 m (103.3 sq ft) and 3 m × 2.4 m (77.5 sq ft).
// Derived walls_sqft = round1(sum of unrounded areas) = 180.8.
const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB = asJobId("33333333-3333-3333-3333-333333333333");
const CAPTURE = "44444444-4444-4444-4444-444444444444";
const P = (x: number, y: number, z: number) => ({ x, y, z });
const GEOMETRY: NormalizedGeometry = {
  floorPolygon: { vertices: [P(0, 0, 0), P(4, 0, 0), P(4, 0, 3), P(0, 0, 3)] },
  walls: [
    { polygon: { vertices: [P(0, 0, 0), P(4, 0, 0), P(4, 2.4, 0), P(0, 2.4, 0)] } },
    { polygon: { vertices: [P(4, 0, 0), P(4, 0, 3), P(4, 2.4, 3), P(4, 2.4, 0)] } },
  ],
  openings: [],
  ceiling: null,
};

const NOW = new Date("2026-08-18T20:00:00Z");

function makeCapture(overrides: Record<number, number> = {}): RoomCapture {
  const r = RoomCapture.create({
    id: CAPTURE,
    orgId: ORG,
    jobId: JOB,
    roomName: "Bathroom",
    source: "roomplan_v1",
    rawPayload: null,
    geometry: GEOMETRY,
    wallOverrides: overrides,
    capturedAt: NOW,
    supersededById: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const wallsQuantity = (value: number | null, status: string): PaintingQuantity =>
  ({ kind: "walls_sqft", value, derivedValue: 180.8, status, heightIn: null }) as PaintingQuantity;

class FakeRepo {
  capture: RoomCaptureWithQuantities | null;
  patchReturnsNull = false;
  savedOverrides: Record<number, number> | null = null;
  savedQuantity: { value: number | null; status: string } | null = null;
  constructor(capture: RoomCaptureWithQuantities | null) {
    this.capture = capture;
  }
  async getCapture() {
    return this.capture;
  }
  async patchWallOverride(_id: string, wallIndex: number, sqft: number | null) {
    if (this.patchReturnsNull) return null;
    const current: Record<number, number> = { ...((this.capture?.capture as RoomCapture | undefined)?.wallOverrides ?? {}) };
    if (sqft === null) delete current[wallIndex];
    else current[wallIndex] = sqft;
    this.savedOverrides = current;
    return current;
  }
  async setQuantity(_id: string, _kind: string, patch: { value: number | null; status: string }) {
    this.savedQuantity = patch;
    return 1;
  }
}

const useCase = (repo: FakeRepo) =>
  new SetWallOverrideUseCase(repo as unknown as MeasurementRepository);

describe("SetWallOverrideUseCase", () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo({
      capture: makeCapture(),
      quantities: [wallsQuantity(180.8, "derived")],
      deductions: [],
    } as unknown as RoomCaptureWithQuantities);
  });

  // THE POINT: the painter's number for ONE wall, the scanner's for the rest, and the total
  // is their sum — never a second total typed over the top with the per-wall story lost.
  it("stores the override and recomputes walls_sqft as (edited wall) + (measured walls)", async () => {
    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: 110 }, ORG);

    expect(isOk(r)).toBe(true);
    expect(repo.savedOverrides).toEqual({ 0: 110 });
    // 110 (edited wall 1) + 77.5 (measured wall 2) = 187.5
    expect(repo.savedQuantity).toEqual({ value: 187.5, status: "override" });
  });

  it("clearing the last override restores the scanner's total, derived again", async () => {
    repo.capture = {
      capture: makeCapture({ 0: 110 }),
      quantities: [wallsQuantity(187.5, "override")],
    } as unknown as RoomCaptureWithQuantities;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: null }, ORG);

    expect(isOk(r)).toBe(true);
    expect(repo.savedOverrides).toEqual({});
    expect(repo.savedQuantity).toEqual({ value: 180.8, status: "derived" });
  });

  // A failed scan is EXACTLY the room a painter edits — its walls_sqft was needs_confirm with
  // no derived number. Clearing the edit must put that state back, not invent "derived: null".
  it("clearing on a failed-scan room restores needs_confirm, not a fake derived", async () => {
    repo.capture = {
      capture: makeCapture({ 0: 110 }),
      quantities: [{ kind: "walls_sqft", value: 187.5, derivedValue: null, status: "override", heightIn: null }],
    } as unknown as RoomCaptureWithQuantities;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: null }, ORG);

    expect(isOk(r)).toBe(true);
    expect(repo.savedQuantity).toEqual({ value: null, status: "needs_confirm" });
  });

  // THE REAL SCAN THAT TAUGHT US: 14 of 15 walls lost. One edited wall must not publish a
  // confident total for a room that is mostly unmeasured — the edit is SAVED, the total stays
  // an open question until every lost wall has the painter's answer.
  it("keeps the total needs_confirm while any lost wall is unanswered", async () => {
    const lostWallGeometry: NormalizedGeometry = {
      ...GEOMETRY,
      walls: [GEOMETRY.walls[0]!, { polygon: { vertices: [] } }],
    };
    const cap = RoomCapture.create({ ...makeCapture().props, geometry: lostWallGeometry });
    if (!cap.ok) throw new Error("fixture");
    repo.capture = {
      capture: cap.value,
      quantities: [{ kind: "walls_sqft", value: null, derivedValue: null, status: "needs_confirm", heightIn: null }],
    } as unknown as RoomCaptureWithQuantities;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: 110 }, ORG);

    expect(isOk(r)).toBe(true);
    expect(repo.savedOverrides).toEqual({ 0: 110 });
    expect(repo.savedQuantity).toEqual({ value: null, status: "needs_confirm" });
  });

  it("publishes the override total the moment the LAST lost wall gets its answer", async () => {
    const lostWallGeometry: NormalizedGeometry = {
      ...GEOMETRY,
      walls: [GEOMETRY.walls[0]!, { polygon: { vertices: [] } }],
    };
    const cap = RoomCapture.create({
      ...makeCapture().props,
      geometry: lostWallGeometry,
      wallOverrides: { 0: 110 },
    });
    if (!cap.ok) throw new Error("fixture");
    repo.capture = {
      capture: cap.value,
      quantities: [{ kind: "walls_sqft", value: null, derivedValue: null, status: "needs_confirm", heightIn: null }],
    } as unknown as RoomCaptureWithQuantities;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 1, sqft: 40 }, ORG);

    expect(isOk(r)).toBe(true);
    expect(repo.savedQuantity).toEqual({ value: 150, status: "override" });
  });

  it("refuses loudly when the capture was re-scanned out from under the edit", async () => {
    repo.patchReturnsNull = true;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: 110 }, ORG);

    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.message).toContain("re-scanned");
  });

  it("refuses a wall this capture does not have", async () => {
    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 7, sqft: 50 }, ORG);

    expect(isOk(r)).toBe(false);
    expect(repo.savedOverrides).toBeNull();
  });

  it("refuses a zero or negative area — an unpainted wall is a deduction, not a 0 sq ft wall", async () => {
    for (const sqft of [0, -5]) {
      const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft }, ORG);
      expect(isOk(r)).toBe(false);
    }
  });

  it("refuses a manual room — no walls to point at", async () => {
    const manual = RoomCapture.create({
      ...makeCapture().props,
      source: "manual",
      geometry: null,
      wallOverrides: {},
    });
    if (!manual.ok) throw new Error("fixture");
    repo.capture = { capture: manual.value, quantities: [] } as unknown as unknown as RoomCaptureWithQuantities;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: 50 }, ORG);

    expect(isOk(r)).toBe(false);
  });

  it("says so when the capture is gone", async () => {
    repo.capture = null;

    const r = await useCase(repo).exec({ captureId: CAPTURE, wallIndex: 0, sqft: 50 }, ORG);

    expect(isOk(r)).toBe(false);
  });
});
