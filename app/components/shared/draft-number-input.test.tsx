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

  // onSettle — for fields whose commit is EXPENSIVE (a server write), not just a store update.
  it("settles once on blur, not once per keystroke", () => {
    const onSettle = vi.fn();
    render(<DraftNumberInput value={89} onCommit={() => {}} onSettle={onSettle} aria-label="Fee" />);
    const input = screen.getByLabelText("Fee") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "125" } });
    expect(onSettle).not.toHaveBeenCalled(); // $1 and $12 are NOT the shop's fee

    fireEvent.blur(input);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(125);
  });

  it("does not settle a box that was merely cleared", () => {
    // Select-all + delete is an ordinary "let me retype this" gesture, not a decision to charge $0.
    const onSettle = vi.fn();
    render(<DraftNumberInput value={89} onCommit={() => {}} onSettle={onSettle} aria-label="Fee" />);
    const input = screen.getByLabelText("Fee") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onSettle).not.toHaveBeenCalled();
    expect(input.value).toBe("89"); // the canonical value comes back
  });

  it("still settles a deliberate zero", () => {
    // A free diagnostic IS a real setting — it just has to be typed, not left blank.
    const onSettle = vi.fn();
    render(<DraftNumberInput value={89} onCommit={() => {}} onSettle={onSettle} aria-label="Fee" />);
    const input = screen.getByLabelText("Fee") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    expect(onSettle).toHaveBeenCalledWith(0);
  });

  it("does not settle when nothing was typed at all", () => {
    const onSettle = vi.fn();
    render(<DraftNumberInput value={89} onCommit={() => {}} onSettle={onSettle} aria-label="Fee" />);
    const input = screen.getByLabelText("Fee") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onSettle).not.toHaveBeenCalled();
  });
});