// @vitest-environment jsdom
/**
 * components/modals/room-scan-view.test.tsx
 *
 * "can you make it so that I can actually click and view the scan… it shows the walls and their
 * measurements and is clickable" — the dollhouse, drawn from the capture's own wall polygons.
 * Tap a wall, get ITS line: the same string the breakdown and the deduction picker print,
 * plus the doors/windows the scanner saw on that wall.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RoomWall } from "@/lib/store/types";

let queryState: Record<string, unknown> = {};
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { measurements: { roomGeometry: { useQuery: () => queryState } } } },
}));

import { RoomScanView } from "./room-scan-view";

const P = (x: number, y: number, z: number) => ({ x, y, z });
const GEOMETRY = {
  captureId: "c1",
  floor: [P(0, 0, 0), P(4, 0, 0), P(4, 0, 3), P(0, 0, 3)],
  walls: [
    { index: 0, vertices: [P(0, 0, 0), P(4, 0, 0), P(4, 2.4, 0), P(0, 2.4, 0)] },
    { index: 1, vertices: [P(4, 0, 0), P(4, 0, 3), P(4, 2.4, 3), P(4, 2.4, 0)] },
  ],
  openings: [
    { kind: "door", wallIndex: 0 },
    { kind: "window", wallIndex: 0 },
    { kind: "window", wallIndex: 0 },
  ],
};
const WALLS: RoomWall[] = [
  { index: 0, widthFt: 13.1, heightFt: 7.9, sqft: 103.5 },
  { index: 1, widthFt: 9.8, heightFt: 7.9, sqft: 77.4 },
];

describe("RoomScanView", () => {
  beforeEach(() => {
    queryState = { data: GEOMETRY, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("draws every wall as a tappable control named for its wall", () => {
    render(<RoomScanView captureId="c1" walls={WALLS} />);

    expect(screen.getByRole("button", { name: "Wall 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wall 2" })).toBeTruthy();
  });

  it("starts with an instruction, not a guess about which wall matters", () => {
    render(<RoomScanView captureId="c1" walls={WALLS} />);

    expect(screen.getByText(/Tap a wall/)).toBeTruthy();
  });

  it("tapping a wall shows that wall's line — the same string every other surface prints", () => {
    render(<RoomScanView captureId="c1" walls={WALLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Wall 2" }));

    expect(screen.getByText(/Wall 2 · 9' 10" × 7' 11" · 77\.4 sq ft/)).toBeTruthy();
  });

  it("names the openings the scanner saw on the tapped wall", () => {
    render(<RoomScanView captureId="c1" walls={WALLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Wall 1" }));

    expect(screen.getByText(/1 door · 2 windows/)).toBeTruthy();
  });

  it("says it is loading while the geometry is in flight", () => {
    queryState = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    render(<RoomScanView captureId="c1" walls={WALLS} />);

    expect(screen.getByText(/Loading the scan/)).toBeTruthy();
  });

  it("names the failure and offers a retry — never a blank pane", () => {
    const refetch = vi.fn();
    queryState = { data: undefined, isLoading: false, isError: true, refetch };
    render(<RoomScanView captureId="c1" walls={WALLS} />);

    expect(screen.getByText(/Couldn't load the scan/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
