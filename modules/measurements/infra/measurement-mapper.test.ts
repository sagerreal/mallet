import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { toDomainCapture, type RoomCaptureRow } from "./measurement-mapper";

// toDomainCapture is a pure row -> domain seam (no IO) — the mapper's own contract comment
// documents the asymmetry this exercises: it throws on corrupt geometry, which is exactly what
// lets getCapture fail loudly while drizzle-measurement-repository.ts's listByJob catches this
// throw per-row to skip-and-log instead of failing the whole list.
const baseRow: RoomCaptureRow = {
  id: randomUUID(),
  orgId: randomUUID(),
  jobId: randomUUID(),
  roomName: "Living Room",
  source: "manual",
  rawPayload: null,
  geometry: null,
  capturedAt: new Date("2026-07-01T00:00:00Z"),
  supersededById: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
};

describe("toDomainCapture", () => {
  it("maps a healthy row (null geometry) to a domain RoomCapture", () => {
    const capture = toDomainCapture(baseRow);
    expect(capture.props.id).toBe(baseRow.id);
    expect(capture.props.roomName).toBe("Living Room");
    expect(capture.props.geometry).toBeNull();
  });

  it("throws on a row whose geometry jsonb fails schema parsing", () => {
    const corruptRow: RoomCaptureRow = {
      ...baseRow,
      geometry: { walls: "not-an-array" } as unknown as RoomCaptureRow["geometry"],
    };
    expect(() => toDomainCapture(corruptRow)).toThrow(/corrupt room_capture/);
  });

  it("throws on a row whose props fail domain validation (invalid source)", () => {
    const corruptRow: RoomCaptureRow = {
      ...baseRow,
      source: "not_a_real_source",
    };
    expect(() => toDomainCapture(corruptRow)).toThrow(/corrupt room_capture/);
  });
});
