// @vitest-environment jsdom
/**
 * components/modals/site-tracer/edge-class-bar.test.tsx
 *
 * The EDGES step's anchored bar, state by state: the five-class legend with
 * running totals (zero classes show label only), the Add a line / Cancel line
 * toggle with its staged hint copy, and Undo line enablement. Classifying
 * itself happens on the map — the pure transitions are covered in
 * lib/measure/edge-edit.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EdgeClassBar } from "./edge-class-bar";
import type { EdgeTotalsFt } from "@/lib/measure/edge-classes";

const TOTALS: EdgeTotalsFt = { eaveFt: 160.4, rakeFt: 99.6, ridgeFt: 40, hipFt: 0, valleyFt: 0 };

function renderBar(overrides: Partial<Parameters<typeof EdgeClassBar>[0]> = {}) {
  const props = {
    totals: TOTALS,
    addingLine: false,
    hasDraftPoint: false,
    canUndoLine: false,
    onToggleAddLine: vi.fn(),
    onUndoLine: vi.fn(),
    ...overrides,
  };
  render(<EdgeClassBar {...props} />);
  return props;
}

describe("EdgeClassBar", () => {
  it("shows every class in the legend, with totals only where feet exist", () => {
    renderBar();
    const bar = screen.getByRole("group", { name: "Roof edges" });
    expect(bar.textContent).toContain("Eaves160 ft");
    expect(bar.textContent).toContain("Rakes100 ft");
    expect(bar.textContent).toContain("Ridge40 ft");
    // Zero classes stay as color-key labels with no figure.
    expect(bar.textContent).toContain("Hips");
    expect(bar.textContent).toContain("Valleys");
    expect(bar.textContent).not.toContain("Hips0");
  });

  it("idle state: explains the tap-to-cycle affordance and offers Add a line", () => {
    renderBar();
    expect(screen.getByText(/Tap an edge to change what it is/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a line" })).toBeTruthy();
  });

  it("armed state: flips to Cancel line and asks for the start point", () => {
    const props = renderBar({ addingLine: true });
    expect(screen.getByText(/Tap the map where the line starts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel line" }));
    expect(props.onToggleAddLine).toHaveBeenCalledTimes(1);
  });

  it("half-placed state: asks for the end point", () => {
    renderBar({ addingLine: true, hasDraftPoint: true });
    expect(screen.getByText(/Tap the map where the line ends/)).toBeTruthy();
  });

  it("Undo line is disabled until there is something to undo", () => {
    const props = renderBar({ canUndoLine: false });
    const undo = screen.getByRole("button", { name: "Undo line" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(props.onUndoLine).not.toHaveBeenCalled();
  });

  it("Undo line fires when enabled", () => {
    const props = renderBar({ canUndoLine: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo line" }));
    expect(props.onUndoLine).toHaveBeenCalledTimes(1);
  });
});
