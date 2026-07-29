import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk, isErr } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "./room-capture";
import type { NormalizedGeometry } from "./normalized-geometry";

const geometry: NormalizedGeometry = {
  floorPolygon: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
  },
  walls: [],
  openings: [],
  ceiling: null,
};

const baseProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: "33333333-3333-3333-3333-333333333333",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  jobId: asJobId("44444444-4444-4444-4444-444444444444"),
  roomName: "Living Room",
  source: "roomplan_v1",
  rawPayload: { foo: "bar" },
  geometry,
  capturedAt: new Date("2026-07-01T00:00:00Z"),
  supersededById: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
  ...overrides,
});

describe("RoomCapture.create", () => {
  it("accepts a valid roomplan_v1 capture", () => {
    const r = RoomCapture.create(baseProps());
    expect(isOk(r)).toBe(true);
  });

  it("accepts a valid manual capture with no geometry and no raw payload", () => {
    const r = RoomCapture.create(baseProps({ source: "manual", geometry: null, rawPayload: null }));
    expect(isOk(r)).toBe(true);
  });

  it("trims the room name", () => {
    const r = RoomCapture.create(baseProps({ roomName: "  Kitchen  " }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.roomName).toBe("Kitchen");
  });

  it("rejects an empty room name", () => {
    const r = RoomCapture.create(baseProps({ roomName: "   " }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("roomName");
  });

  it("rejects a room name over 80 characters", () => {
    const r = RoomCapture.create(baseProps({ roomName: "x".repeat(81) }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("roomName");
  });

  it("accepts a room name exactly 80 characters", () => {
    const r = RoomCapture.create(baseProps({ roomName: "x".repeat(80) }));
    expect(isOk(r)).toBe(true);
  });

  it("rejects an invalid source", () => {
    const r = RoomCapture.create(baseProps({ source: "lidar" as unknown as "manual" }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("source");
  });

  it("rejects a raw payload over 512 KB serialized", () => {
    const bigPayload = { blob: "x".repeat(512 * 1024 + 1) };
    const r = RoomCapture.create(baseProps({ rawPayload: bigPayload }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("rawPayload");
  });

  it("accepts a raw payload right at the 512 KB boundary", () => {
    // Build a payload whose JSON serialization is exactly at the cap.
    const overhead = JSON.stringify({ blob: "" }).length;
    const target = 512 * 1024 - overhead;
    const payload = { blob: "x".repeat(target) };
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBe(512 * 1024);
    const r = RoomCapture.create(baseProps({ rawPayload: payload }));
    expect(isOk(r)).toBe(true);
  });

  it("rejects a roomplan_v1 capture with no geometry", () => {
    const r = RoomCapture.create(baseProps({ source: "roomplan_v1", geometry: null }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("geometry");
  });

  it("rejects a manual capture that carries geometry", () => {
    const r = RoomCapture.create(baseProps({ source: "manual", geometry, rawPayload: null }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("geometry");
  });

  it("treats an undefined raw payload the same as null (valid for a manual capture)", () => {
    const r = RoomCapture.create(
      baseProps({ source: "manual", geometry: null, rawPayload: undefined as unknown as null }),
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.rawPayload).toBeNull();
  });

  it("returns a validation error (never throws) for a circular raw payload", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => RoomCapture.create(baseProps({ rawPayload: circular }))).not.toThrow();
    const r = RoomCapture.create(baseProps({ rawPayload: circular }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("rawPayload");
  });
});
