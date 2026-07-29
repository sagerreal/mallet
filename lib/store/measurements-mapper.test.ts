import { describe, it, expect } from "vitest";
import { roomCaptureDtoToStore } from "./measurements-mapper";

describe("roomCaptureDtoToStore", () => {
  it("maps a full DTO to a RoomCard 1:1", () => {
    const dto = {
      id: "room-1",
      jobId: "job-1",
      roomName: "Kitchen",
      source: "roomplan_v1" as const,
      capturedAt: "2026-07-01T00:00:00.000Z",
      quantities: [
        { kind: "walls_sqft" as const, value: 120, derivedValue: 118, status: "derived" as const },
        { kind: "doors_count" as const, value: null, derivedValue: 2, status: "needs_confirm" as const },
      ],
    };

    expect(roomCaptureDtoToStore(dto)).toEqual({
      id: "room-1",
      jobId: "job-1",
      roomName: "Kitchen",
      source: "roomplan_v1",
      capturedAt: "2026-07-01T00:00:00.000Z",
      quantities: [
        { kind: "walls_sqft", value: 120, derivedValue: 118, status: "derived" },
        { kind: "doors_count", value: null, derivedValue: 2, status: "needs_confirm" },
      ],
    });
  });

  it("does not mutate the input quantities array (defensive copy)", () => {
    const quantities = [
      { kind: "walls_sqft" as const, value: 1, derivedValue: 1, status: "confirmed" as const },
    ];
    const dto = {
      id: "r",
      jobId: "j",
      roomName: "R",
      source: "manual" as const,
      capturedAt: "now",
      quantities,
    };
    const result = roomCaptureDtoToStore(dto);
    expect(result.quantities).not.toBe(quantities);
  });
});
