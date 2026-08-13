// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoneyBandFilter, MONEY_BANDS, isMoneyBand } from "./money-band-filter";

/**
 * The Money ledger's only filter, and — since it came out of the Filters disclosure — the only
 * thing on the screen that says how much money is in each state.
 */
const COUNTS = { ready: 39, draft: 16, over: 240, partial: 0, sent: 1, paid: 588 };

const setup = (over: Partial<React.ComponentProps<typeof MoneyBandFilter>> = {}) => {
  const onBand = vi.fn();
  render(<MoneyBandFilter band="" counts={COUNTS} onBand={onBand} {...over} />);
  return { onBand };
};

describe("MoneyBandFilter", () => {
  it("leads with the two bands one person clears alone, then what the customer owes", () => {
    // Not INVOICE_VIEWS' order and not the invoice lifecycle's: the old dropdown ran
    // Unpaid → Part-paid → Overdue, which left Overdue fifth, sitting next to Paid.
    expect(MONEY_BANDS).toEqual(["ready", "draft", "over", "partial", "sent", "paid"]);
  });

  it("labels the chips with the same words the row pills use", () => {
    // A filter that says "Unpaid" over rows stamped "Sent" is two vocabularies for one idea.
    setup();
    const labels = screen
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").replace(/\s*\(\d+\)$/, "").trim());
    expect(labels).toEqual(["All", "Ready to bill", "Draft", "Overdue", "Part-paid", "Unpaid", "Paid"]);
  });

  it("puts the number on the chip — the whole point of replacing the dropdown", () => {
    setup();
    expect(screen.getByRole("button", { name: /^Overdue/ }).textContent).toContain("(240)");
    expect(screen.getByRole("button", { name: /^Ready to bill/ }).textContent).toContain("(39)");
  });

  it("shows a real zero, because zero overdue is worth knowing", () => {
    // Distinct from the in-flight case below: 0 is an answer, undefined is not one yet.
    setup();
    expect(screen.getByRole("button", { name: /^Part-paid/ }).textContent).toContain("(0)");
  });

  it("omits the count while a band is still in flight", () => {
    // A 0 that becomes 240 reads as data appearing from nowhere.
    setup({ counts: { draft: 16 } });
    expect(screen.getByRole("button", { name: /^Overdue/ }).textContent).not.toMatch(/\(/);
    expect(screen.getByRole("button", { name: /^Draft/ }).textContent).toContain("(16)");
  });

  it("marks the selected chip pressed and visually on", () => {
    setup({ band: "over" });
    const over = screen.getByRole("button", { name: /^Overdue/ });
    expect(over.getAttribute("aria-pressed")).toBe("true");
    expect(over.className.split(" ")).toContain("on");
    expect(screen.getByRole("button", { name: "All" }).className.split(" ")).not.toContain("on");
  });

  it("marks All pressed when nothing is filtered", () => {
    setup({ band: "" });
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reports null for All, so the ledger can hold one empty-string state", () => {
    const { onBand } = setup({ band: "over" });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onBand).toHaveBeenCalledWith(null);
  });

  it("clears back to All by re-clicking the active chip", () => {
    const { onBand } = setup({ band: "over" });
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(onBand).toHaveBeenCalledWith(null);
  });

  it("selects a band on first click", () => {
    const { onBand } = setup({ band: "" });
    fireEvent.click(screen.getByRole("button", { name: /^Ready to bill/ }));
    expect(onBand).toHaveBeenCalledWith("ready");
  });

  it("goes inert, not invisible, when the archived set owns the list", () => {
    setup({ disabled: true });
    expect(screen.getByRole("button", { name: /^Overdue/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "All" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("isMoneyBand", () => {
  it("accepts the jobs-side worklist and every invoice view", () => {
    for (const b of MONEY_BANDS) expect(isMoneyBand(b)).toBe(true);
  });

  it("rejects anything else, so a stray string never reaches the query", () => {
    expect(isMoneyBand("")).toBe(false);
    expect(isMoneyBand("archived")).toBe(false);
    expect(isMoneyBand("overdue")).toBe(false); // the label, not the key
  });
});
