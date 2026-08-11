// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftNumberInput } from "./draft-number-input";

// The controlled parse-on-keystroke pattern re-rendered parseFloat(value) after every key:
// "13." lost its dot, "0.5" collapsed to "", and a swallowed decimal turned "2.0" into 20 —
// a 20% sales tax the user never set, stored on a real invoice (INV-1864).
describe("DraftNumberInput", () => {
  it("keeps the trailing decimal point on screen while committing the parsed value", () => {
    const onCommit = vi.fn();
    render(<DraftNumberInput value={0} onCommit={onCommit} aria-label="Discount percent" />);
    const input = screen.getByLabelText("Discount percent") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "13." } });

    expect(input.value).toBe("13.");
    expect(onCommit).toHaveBeenLastCalledWith(13);
  });

  it("lets a sub-1 decimal be typed without collapsing to empty", () => {
    const onCommit = vi.fn();
    render(<DraftNumberInput value={0} onCommit={onCommit} aria-label="Discount percent" />);
    const input = screen.getByLabelText("Discount percent") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0." } });
    fireEvent.change(input, { target: { value: "0.5" } });

    expect(input.value).toBe("0.5");
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
  });

  it("shows the canonical value again on blur, formatted when asked", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<DraftNumberInput value={10.4} decimals={2} onCommit={onCommit} aria-label="Amount due" />);
    const input = screen.getByLabelText("Amount due") as HTMLInputElement;

    expect(input.value).toBe("10.40");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    expect(onCommit).toHaveBeenLastCalledWith(12);
    // The parent reconciles the committed value; blur hands the display back to it.
    rerender(<DraftNumberInput value={12} decimals={2} onCommit={onCommit} aria-label="Amount due" />);
    fireEvent.blur(input);

    expect(input.value).toBe("12.00");
  });

  it("renders empty for zero so the placeholder can speak", () => {
    render(<DraftNumberInput value={0} onCommit={() => {}} placeholder="0" aria-label="X" />);
    expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("");
  });
});
