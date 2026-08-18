// @vitest-environment jsdom
/**
 * components/modals/wall-breakdown.test.tsx
 *
 * "I scan a room and I just see the total square feet" — Owen, prepping the Garrett demo. The
 * per-wall areas were ALREADY computed server-side and already on the phone (the deduction picker
 * lists them); the room card just never showed the working. This is the working: one line per
 * wall, dims × area, then the measured total the lines add to. A total you can audit is the trust
 * feature Garrett's whole email was about ("the salesperson reviews the numbers").
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WallBreakdown, wallLabel } from "./wall-breakdown";
import type { RoomWall } from "@/lib/store/types";

const wall = (index: number, over: Partial<RoomWall> = {}): RoomWall => ({
  index,
  widthFt: 12.3,
  heightFt: 8,
  sqft: 98.4,
  ...over,
});

describe("WallBreakdown — the working behind the walls total", () => {
  it("prints one line per wall, in wall order, dims and area", () => {
    render(<WallBreakdown walls={[wall(0), wall(1, { widthFt: 6.5, sqft: 52 })]} totalSqft={150.4} />);

    expect(screen.getByText(/Wall 1 · 12' 4" × 8' 0" · 98\.4 sq ft/)).toBeTruthy();
    expect(screen.getByText(/Wall 2 · 6' 6" × 8' 0" · 52\.0 sq ft/)).toBeTruthy();
  });

  it("ends with the measured total the walls add to", () => {
    render(<WallBreakdown walls={[wall(0)]} totalSqft={98.4} />);

    expect(screen.getByText(/Measured total · 98\.4 sq ft/)).toBeTruthy();
  });

  // Owen's first real scan: 14 of 15 walls came back empty from RoomPlan, and the total went to
  // needs_confirm with no visible reason. The breakdown is where that FINALLY becomes legible —
  // a 0×0 wall says it didn't capture instead of printing "0' 0" × 0' 0" · 0.0 sq ft" as if a
  // zero-size wall were a measurement.
  // A lost wall can also come back COLLAPSED — collinear vertices with a real-looking span.
  // "12' 0\" × 0' 0\" · 0.0 sq ft" printed as a measurement is the exact contradiction this
  // surface exists to remove: zero area is no wall, whatever the spans say.
  it("names a collapsed wall (zero area, nonzero span) as not captured too", () => {
    render(
      <WallBreakdown
        walls={[wall(0), wall(1, { widthFt: 12, heightFt: 0, sqft: 0 })]}
        totalSqft={null}
      />,
    );

    expect(screen.getByText(/Wall 2 · didn't capture/)).toBeTruthy();
    expect(screen.queryByText(/12' 0"/)).toBeNull();
  });

  it("announces itself as a named list, with the total outside it", () => {
    render(<WallBreakdown walls={[wall(0), wall(1)]} totalSqft={196.8} />);

    const list = screen.getByRole("list", { name: "Wall breakdown" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText(/Measured total/).tagName).toBe("P");
  });

  it("names a wall the scanner failed to capture instead of printing 0 × 0", () => {
    render(
      <WallBreakdown
        walls={[wall(0), wall(1, { widthFt: 0, heightFt: 0, sqft: 0 })]}
        totalSqft={null}
      />,
    );

    expect(screen.getByText(/Wall 2 · didn't capture/)).toBeTruthy();
    expect(screen.queryByText(/0' 0"/)).toBeNull();
  });

  it("shows no total line when the total is unresolved — nothing honest to add to", () => {
    render(<WallBreakdown walls={[wall(0, { widthFt: 0, heightFt: 0, sqft: 0 })]} totalSqft={null} />);

    expect(screen.queryByText(/Measured total/)).toBeNull();
  });

  it("renders nothing at all for a room with no wall geometry (manual rooms)", () => {
    const { container } = render(<WallBreakdown walls={[]} totalSqft={120} />);

    expect(container.innerHTML).toBe("");
  });
});

describe("wallLabel — one string for a wall everywhere", () => {
  // The deduction picker has printed walls this way since #trim: if the breakdown said
  // "Wall 3 — 98 sqft" while the picker said "Wall 3 · 12' 4" × 8' 0" · 98.4 sq ft", the same
  // wall would read as two different facts one screen apart.
  it("prints feet-and-inches dims with a one-decimal area", () => {
    expect(wallLabel(wall(2, { widthFt: 10.5, heightFt: 9, sqft: 94.5 }))).toBe(
      `Wall 3 · 10' 6" × 9' 0" · 94.5 sq ft`,
    );
  });

  it("carries inch rounding over to the next foot instead of printing 12 inches", () => {
    expect(wallLabel(wall(0, { widthFt: 11.99, heightFt: 8 }))).toBe(
      `Wall 1 · 12' 0" × 8' 0" · 98.4 sq ft`,
    );
  });
});
