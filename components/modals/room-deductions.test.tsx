// @vitest-environment jsdom
/**
 * The "Not painted" section. The claims worth guarding are the product ones: the painter never
 * types a measurement, a manual room gets no dead control, and an unanswerable deduction never
 * renders as zero.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoomDeductions, type RoomDeductionsProps } from "./room-deductions";
import type { RoomCard } from "@/lib/store/types";

const walls = [
  { index: 0, widthFt: 10, heightFt: 8, sqft: 80 },
  { index: 1, widthFt: 5, heightFt: 8, sqft: 40 },
];

const room = (over: Partial<RoomCard> = {}): RoomCard => ({
  id: "r1",
  jobId: "j1",
  roomName: "Bathroom",
  source: "roomplan_v1",
  capturedAt: "2026-08-14T00:00:00.000Z",
  quantities: [{ kind: "walls_sqft", value: 142, derivedValue: 142, status: "derived" }],
  deductions: [],
  walls,
  netWallsSqft: 142,
  ...over,
});

type AddFn = RoomDeductionsProps["onAdd"];
type RemoveFn = RoomDeductionsProps["onRemove"];

let onAdd: Mock<AddFn>;
let onRemove: Mock<RemoveFn>;

beforeEach(() => {
  onAdd = vi.fn<AddFn>().mockResolvedValue(undefined);
  onRemove = vi.fn<RemoveFn>().mockResolvedValue(undefined);
});

const mount = (r: RoomCard = room(), readOnly = false) =>
  render(<RoomDeductions room={r} readOnly={readOnly} onAdd={onAdd} onRemove={onRemove} />);

describe("RoomDeductions", () => {
  it("shows the net — the number an estimate actually prices from", () => {
    mount(room({ netWallsSqft: 56 }));
    expect(screen.getByText("56.0")).toBeTruthy();
  });

  // A manual room has no geometry: no walls to point at, nothing to derive. A visible control
  // that could only ever record zero is a dead control.
  it("renders nothing at all for a manual room", () => {
    const { container } = mount(room({ source: "manual", walls: [] }));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the scan produced no walls", () => {
    const { container } = mount(room({ walls: [] }));
    expect(container.firstChild).toBeNull();
  });

  it("lists a recorded deduction with its reason and what it took off", () => {
    mount(
      room({
        deductions: [
          { id: "d1", reason: "Tile wainscot", kind: "band", wallIndexes: [0, 1], heightM: 1.2192, sqft: 86 },
        ],
      }),
    );
    expect(screen.getByText("Tile wainscot")).toBeTruthy();
    expect(screen.getByText("−86.0")).toBeTruthy();
    expect(screen.getByText(/2 walls/)).toBeTruthy();
  });

  // Null is not zero. A band with no height cannot be answered yet, and "0.0" would read as
  // "nothing is tiled" on a room that is.
  it("shows an unanswerable deduction as a dash, never as zero", () => {
    mount(
      room({
        deductions: [{ id: "d1", reason: "Tile", kind: "band", wallIndexes: [0], heightM: null, sqft: null }],
      }),
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("−0.0")).toBeNull();
  });

  it("hides the add control for a tech, who cannot write quantities", () => {
    mount(room(), true);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  describe("the add form", () => {
    const openForm = () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    };

    // THE WHOLE POINT: every wall's size comes off the scan, so the painter reads rather
    // than measures.
    it("lists each wall with the size the scan already measured", () => {
      openForm();
      expect(screen.getByText(/Wall 1 · 10' 0" × 8' 0" · 80.0 sq ft/)).toBeTruthy();
      expect(screen.getByText(/Wall 2 · 5' 0" × 8' 0" · 40.0 sq ft/)).toBeTruthy();
    });

    it("previews the area live as walls are tapped, using the scan's own widths", () => {
      openForm();
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      // 80 sqft wall, 8ft tall, 4ft band → half → 40.0
      expect(screen.getByText("−40.0 sq ft")).toBeTruthy();
      fireEvent.click(screen.getByLabelText(/Wall 2/));
      // + 40 sqft wall at half → 20 → 60.0
      expect(screen.getByText("−60.0 sq ft")).toBeTruthy();
    });

    it("takes the whole wall when 'Whole wall' is chosen", () => {
      openForm();
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      fireEvent.click(screen.getByRole("button", { name: "Whole wall" }));
      expect(screen.getByText("−80.0 sq ft")).toBeTruthy();
    });

    it("fills the reason from a preset, so that is a tap too", () => {
      openForm();
      fireEvent.click(screen.getByRole("button", { name: "Tile wainscot" }));
      expect((screen.getByLabelText("What is it") as HTMLInputElement).value).toBe("Tile wainscot");
    });

    it("will not save without a reason — an unexplained deduction is what this replaces", () => {
      openForm();
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      expect(screen.getByRole("button", { name: "Add" }).getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("will not save without a wall", () => {
      openForm();
      fireEvent.change(screen.getByLabelText("What is it"), { target: { value: "Tile" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("sends the walls and the height in FEET — never an area", async () => {
      openForm();
      fireEvent.change(screen.getByLabelText("What is it"), { target: { value: "Tile wainscot" } });
      fireEvent.click(screen.getByLabelText(/Wall 2/));
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      fireEvent.click(screen.getByRole("button", { name: "6 ft" }));
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(onAdd).toHaveBeenCalled());
      expect(onAdd).toHaveBeenCalledWith({
        reason: "Tile wainscot",
        kind: "band",
        wallIndexes: [0, 1], // sorted, whatever order they were tapped
        heightFt: 6,
      });
    });

    it("sends a whole-wall deduction with no height", async () => {
      openForm();
      fireEvent.change(screen.getByLabelText("What is it"), { target: { value: "Shower surround" } });
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      fireEvent.click(screen.getByRole("button", { name: "Whole wall" }));
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(onAdd).toHaveBeenCalled());
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "whole_wall", heightFt: null }),
      );
    });

    // A deduction that silently failed to save changes what the job costs.
    it("says so when the save fails, and keeps the form open to retry", async () => {
      onAdd.mockRejectedValue(new Error("network"));
      openForm();
      fireEvent.change(screen.getByLabelText("What is it"), { target: { value: "Tile" } });
      fireEvent.click(screen.getByLabelText(/Wall 1/));
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.getByRole("alert").textContent).toMatch(/didn't save/i);
      expect(screen.getByLabelText("What is it")).toBeTruthy();
    });
  });

  it("removes a deduction, putting the wall area back", async () => {
    mount(
      room({
        deductions: [{ id: "d1", reason: "Tile", kind: "band", wallIndexes: [0], heightM: 1.2, sqft: 40 }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Tile" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("d1"));
  });
});
