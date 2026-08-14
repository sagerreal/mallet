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
      deductions: [
        {
          id: "d-1",
          reason: "Tile wainscot",
          kind: "band" as const,
          wallIndexes: [0, 2],
          heightM: 1.2,
          sqft: 96,
        },
      ],
      walls: [{ index: 0, widthFt: 10, heightFt: 8, sqft: 80 }],
      netWallsSqft: 24,
    };

    expect(roomCaptureDtoToStore(dto)).toEqual({
      id: "room-1",
      jobId: "job-1",
      roomName: "Kitchen",
      source: "roomplan_v1",
      capturedAt: "2026-07-01T00:00:00.000Z",
      deductions: [
        { id: "d-1", reason: "Tile wainscot", kind: "band", wallIndexes: [0, 2], heightM: 1.2, sqft: 96 },
      ],
      walls: [{ index: 0, widthFt: 10, heightFt: 8, sqft: 80 }],
      netWallsSqft: 24,
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
      deductions: [],
      walls: [],
      netWallsSqft: null,
    };
    const result = roomCaptureDtoToStore(dto);
    expect(result.quantities).not.toBe(quantities);
  });
});

/**
 * A rolling deploy puts new client code in front of an older server for a few minutes. That
 * response has no deductions/walls/netWallsSqft, and reading `.map` off undefined would take
 * down the entire room list — a hard crash instead of a soft, self-correcting gap.
 */
describe("roomCaptureDtoToStore — a response from an older server", () => {
  const legacy = {
    id: "room-1",
    jobId: "job-1",
    roomName: "Bathroom",
    source: "roomplan_v1" as const,
    capturedAt: "2026-08-14T00:00:00.000Z",
    quantities: [{ kind: "walls_sqft" as const, value: 142, derivedValue: 142, status: "derived" as const }],
  };

  it("degrades to none-recorded rather than throwing", () => {
    const room = roomCaptureDtoToStore(legacy);
    expect(room.deductions).toEqual([]);
    expect(room.walls).toEqual([]);
  });

  // Not 0: with no deductions field there is nothing to net against, and 0 would price the room
  // as fully deducted.
  it("leaves the net unanswered rather than inventing zero", () => {
    expect(roomCaptureDtoToStore(legacy).netWallsSqft).toBeNull();
  });

  it("still maps everything the older server DID send", () => {
    const room = roomCaptureDtoToStore(legacy);
    expect(room.roomName).toBe("Bathroom");
    expect(room.quantities).toHaveLength(1);
  });
});
