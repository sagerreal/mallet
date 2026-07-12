// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DurField, durToDrafts, commitDrafts } from "./dur-field";

// ── pure helpers ──────────────────────────────────────────────────────────────

describe("durToDrafts", () => {
  it("splits fractional hours into h/m strings", () => {
    expect(durToDrafts(2.5)).toEqual({ h: "2", m: "30" });
    expect(durToDrafts(0.25)).toEqual({ h: "0", m: "15" });
    expect(durToDrafts(3)).toEqual({ h: "3", m: "0" });
  });

  it("carries a rounded 60m into the hour (1.999 → 2h 0m)", () => {
    expect(durToDrafts(1.999)).toEqual({ h: "2", m: "0" });
  });

  it("treats NaN / zero / negatives as 0", () => {
    expect(durToDrafts(Number.NaN)).toEqual({ h: "0", m: "0" });
    expect(durToDrafts(0)).toEqual({ h: "0", m: "0" });
    expect(durToDrafts(-1)).toEqual({ h: "0", m: "0" });
  });
});

describe("commitDrafts", () => {
  it("parses plain drafts (2h 30m → 2.5)", () => {
    expect(commitDrafts("2", "30")).toEqual({ h: "2", m: "30", dur: 2.5 });
  });

  it("treats an empty hours draft as 0 — NOT a 15-minute snap", () => {
    expect(commitDrafts("", "30")).toEqual({ h: "0", m: "30", dur: 0.5 });
  });

  it("clamps both drafts empty up to the 15-minute floor", () => {
    expect(commitDrafts("", "")).toEqual({ h: "0", m: "15", dur: 0.25 });
  });

  it("clamps minutes to 0–59 and hours to 0–24", () => {
    expect(commitDrafts("1", "75").m).toBe("59");
    expect(commitDrafts("30", "0")).toEqual({ h: "24", m: "0", dur: 24 });
    expect(commitDrafts("-3", "0").dur).toBe(0.25);
  });

  it("clamps the total to 24h (24h + 30m → 24h 0m)", () => {
    expect(commitDrafts("24", "30")).toEqual({ h: "24", m: "0", dur: 24 });
  });

  it("treats garbage as the minimum (empty)", () => {
    expect(commitDrafts("abc", "xyz").dur).toBe(0.25);
  });
});

// ── component commit semantics ────────────────────────────────────────────────

const hoursInput = () => screen.getByLabelText("Length hours") as HTMLInputElement;
const minutesInput = () => screen.getByLabelText("Length minutes") as HTMLInputElement;

describe("DurField", () => {
  it("renders the duration split into h and m", () => {
    render(<DurField dur={2.5} onChange={vi.fn()} />);
    expect(hoursInput().value).toBe("2");
    expect(minutesInput().value).toBe("30");
  });

  it("does NOT call onChange while typing (drafts only, no mid-edit clamping)", () => {
    const onChange = vi.fn();
    render(<DurField dur={2} onChange={onChange} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.change(hoursInput(), { target: { value: "" } }); // cleared — old code snapped to 15m here
    fireEvent.change(hoursInput(), { target: { value: "1" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(hoursInput().value).toBe("1");
  });

  it("commits once on blur out of the group with the parsed value", () => {
    const onChange = vi.fn();
    render(<DurField dur={2} onChange={onChange} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.change(hoursInput(), { target: { value: "3" } });
    fireEvent.focusOut(hoursInput(), { relatedTarget: null });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("clearing hours then blurring commits 0h + minutes (not a 15-minute snap)", () => {
    const onChange = vi.fn();
    render(<DurField dur={2.5} onChange={onChange} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.change(hoursInput(), { target: { value: "" } });
    fireEvent.focusOut(hoursInput(), { relatedTarget: null });
    expect(onChange).toHaveBeenCalledWith(0.5); // 0h 30m
    expect(hoursInput().value).toBe("0"); // drafts resynced to the clamped value
  });

  it("moving focus from h to m does NOT commit (still inside the group)", () => {
    const onChange = vi.fn();
    render(<DurField dur={2} onChange={onChange} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.change(hoursInput(), { target: { value: "4" } });
    fireEvent.focusOut(hoursInput(), { relatedTarget: minutesInput() });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter commits the current drafts", () => {
    const onChange = vi.fn();
    render(<DurField dur={2} onChange={onChange} />);
    fireEvent.focusIn(minutesInput());
    fireEvent.change(minutesInput(), { target: { value: "45" } });
    fireEvent.keyDown(minutesInput(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2.75);
  });

  it("does not call onChange on blur when the value is unchanged", () => {
    const onChange = vi.fn();
    render(<DurField dur={2} onChange={onChange} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.focusOut(hoursInput(), { relatedTarget: null });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resyncs drafts from the prop when the group is not focused (reconcile path)", () => {
    const { rerender } = render(<DurField dur={2} onChange={vi.fn()} />);
    act(() => {
      rerender(<DurField dur={3.5} onChange={vi.fn()} />);
    });
    expect(hoursInput().value).toBe("3");
    expect(minutesInput().value).toBe("30");
  });

  it("does NOT stomp in-progress drafts when the prop changes while focused", () => {
    const { rerender } = render(<DurField dur={2} onChange={vi.fn()} />);
    fireEvent.focusIn(hoursInput());
    fireEvent.change(hoursInput(), { target: { value: "5" } });
    act(() => {
      rerender(<DurField dur={2} onChange={vi.fn()} />); // e.g. a server reconcile
    });
    expect(hoursInput().value).toBe("5"); // draft survives
  });
});
