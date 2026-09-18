// @vitest-environment jsdom
/**
 * The bug this fixes: a painter scanned a bathroom, saw "1 room measured", and had no way to
 * open it, correct a number, record the tile, or delete a room scanned by mistake.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeasuredRoomsList } from "./measured-rooms-list";
import type { RoomCard } from "@/lib/store/types";

const room = (over: Partial<RoomCard> = {}): RoomCard => ({
  id: "r1",
  jobId: "j1",
  roomName: "Bathroom",
  source: "roomplan_v1",
  capturedAt: "2026-08-14T00:00:00.000Z",
  quantities: [{ kind: "walls_sqft", value: 142, derivedValue: 142, status: "derived", heightIn: null }],
  deductions: [],
  walls: [],
  openings: [],
  netWallsSqft: 142,
  ...over,
});

describe("MeasuredRoomsList", () => {
  it("renders nothing when no room has been measured", () => {
    const { container } = render(<MeasuredRoomsList rooms={[]} onOpenRoom={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("names each measured room", () => {
    render(
      <MeasuredRoomsList
        rooms={[room(), room({ id: "r2", roomName: "Kitchen" })]}
        onOpenRoom={vi.fn()}
      />,
    );
    expect(screen.getByText("Bathroom")).toBeTruthy();
    expect(screen.getByText("Kitchen")).toBeTruthy();
  });

  // THE FIX: every room is a way into its own card, where the numbers, deductions,
  // rename, re-scan and delete all already lived.
  it("opens the room card for the room that was tapped", () => {
    const onOpenRoom = vi.fn();
    render(<MeasuredRoomsList rooms={[room(), room({ id: "r2", roomName: "Kitchen" })]} onOpenRoom={onOpenRoom} />);
    fireEvent.click(screen.getByRole("button", { name: /Kitchen/ }));
    expect(onOpenRoom).toHaveBeenCalledWith("r2");
  });

  it("shows the wall area an estimate would price", () => {
    render(<MeasuredRoomsList rooms={[room()]} onOpenRoom={vi.fn()} />);
    expect(screen.getByText("142.0 sq ft walls")).toBeTruthy();
  });

  // A room carrying deductions must not advertise its gross, or this list disagrees with the
  // quote it feeds.
  it("shows the NET and says so when something is not painted", () => {
    render(
      <MeasuredRoomsList
        rooms={[
          room({
            netWallsSqft: 56,
            deductions: [{ id: "d1", reason: "Tile", kind: "band", wallIndexes: [0], heightM: 1.2, sqft: 86 }],
          }),
        ]}
        onOpenRoom={vi.fn()}
      />,
    );
    expect(screen.getByText("56.0 sq ft walls net")).toBeTruthy();
    expect(screen.queryByText(/142/)).toBeNull();
  });

  // An unreadable scan comes back needs_confirm with a null value. "0.0 sq ft" would read as a
  // measured room with no walls.
  it("says a number is needed rather than printing zero", () => {
    render(
      <MeasuredRoomsList
        rooms={[
          room({
            quantities: [{ kind: "walls_sqft", value: null, derivedValue: null, status: "needs_confirm", heightIn: null }],
            netWallsSqft: null,
          }),
        ]}
        onOpenRoom={vi.fn()}
      />,
    );
    expect(screen.getByText("needs a number")).toBeTruthy();
    expect(screen.queryByText(/0\.0 sq ft/)).toBeNull();
  });
});
