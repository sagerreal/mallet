// @vitest-environment jsdom
/**
 * app/(office)/composer/pricing-card.test.tsx
 *
 * The Pricing fields are percentages the server holds as basis points, and it refuses a discount
 * or deposit outside 0–10000 bps. A box that accepts 150 hands the save path a payload the
 * server will reject — so the bound belongs on the input, where the number is still being typed.
 * Tax has no upper bound in the domain and keeps only its floor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricingCard } from "./pricing-card";
import { INITIAL_STATE } from "./composer-state";

const onUpdate = vi.fn();
const open = { ...INITIAL_STATE, priceOpen: true };

beforeEach(() => onUpdate.mockClear());

describe("PricingCard — percentage bounds", () => {
  it("clamps a discount over 100 to 100", () => {
    render(<PricingCard state={open} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Discount %"), { target: { value: "150" } });
    expect(onUpdate).toHaveBeenCalledWith({ pricing: { disc: 100, dep: 0, tax: 0 } });
  });

  it("clamps a deposit over 100 to 100", () => {
    render(<PricingCard state={open} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Deposit required %"), { target: { value: "150" } });
    expect(onUpdate).toHaveBeenCalledWith({ pricing: { disc: 0, dep: 100, tax: 0 } });
  });

  it("keeps an in-range percentage exactly as typed", () => {
    render(<PricingCard state={open} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Discount %"), { target: { value: "12.5" } });
    expect(onUpdate).toHaveBeenCalledWith({ pricing: { disc: 12.5, dep: 0, tax: 0 } });
  });

  it("tells the browser the bound too, so the stepper and validation agree", () => {
    render(<PricingCard state={open} onUpdate={onUpdate} />);
    expect(screen.getByLabelText("Discount %").getAttribute("max")).toBe("100");
    expect(screen.getByLabelText("Deposit required %").getAttribute("max")).toBe("100");
    // Sales tax rates are unbounded in the domain — no cap invented here.
    expect(screen.getByLabelText("Tax %").getAttribute("max")).toBeNull();
  });
});
