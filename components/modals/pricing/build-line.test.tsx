// @vitest-environment jsdom
/**
 * components/modals/pricing/build-line.test.tsx
 *
 * LineRow is where a technician types the number the customer pays, on a phone, on site. The
 * contract under test is narrow and entirely about that field: an unpriced line shows an EMPTY
 * box, and what the tech types is what they see.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LineRow } from "./build-line";

const customLine = { kind: "custom" as const, d: "random item", amt: 0 };

describe("LineRow — the price field", () => {
  /**
   * The bug this locks: the field was seeded with the NUMBER 0, so it rendered "0". Typing a
   * price after it left "010" in the box. React does not renormalise a number input's string
   * when the numeric value is unchanged — that is deliberate, so "1." stays typable — so the
   * stray zero survived every render while the total read $10.
   */
  it("is empty when the line has no price, not a literal zero", () => {
    render(<LineRow line={customLine} onSet={vi.fn()} onRemove={vi.fn()} />);
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("");
  });

  it("shows a priced line's own number", () => {
    render(<LineRow line={{ ...customLine, amt: 10 }} onSet={vi.fn()} onRemove={vi.fn()} />);
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("10");
  });

  it("reports what was typed", () => {
    const onSet = vi.fn();
    render(<LineRow line={customLine} onSet={onSet} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "10" } });
    expect(onSet).toHaveBeenCalledWith({ amt: 10 });
  });

  // A price is never negative, and clearing the box means unpriced rather than NaN.
  it("floors a negative at zero and reads an empty box as zero", () => {
    const onSet = vi.fn();
    render(<LineRow line={customLine} onSet={onSet} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "-5" } });
    expect(onSet).toHaveBeenCalledWith({ amt: 0 });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "" } });
    expect(onSet).toHaveBeenLastCalledWith({ amt: 0 });
  });
});

describe("LineRow — time & materials", () => {
  const tmLine = { kind: "tm" as const, d: "Drain snake", h: 0, rate: 0 };

  it("leaves hours empty rather than showing a zero to type after", () => {
    render(<LineRow line={tmLine} onSet={vi.fn()} onRemove={vi.fn()} />);
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("");
  });

  // Labour is billed in quarter hours; anything between rounds to the nearest one.
  it("rounds hours to the quarter", () => {
    const onSet = vi.fn();
    render(<LineRow line={tmLine} onSet={onSet} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "1.3" } });
    expect(onSet).toHaveBeenCalledWith({ h: 1.25 });
  });
});
