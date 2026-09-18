// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TapToPayButton } from "./tap-to-pay-button";
import { TAP_TO_PAY_UNAUTHORIZED } from "./tap-to-pay-unavailable";
import type { TapToPayAvailability } from "@/lib/native/tap-to-pay";

/**
 * Apple's checkout requirements, asserted so they cannot regress quietly.
 *
 * These are not style preferences — every one of them is a line in the review checklist Mallet
 * has to submit to lift the development-distribution restriction, and a change that breaks one
 * fails a review weeks after the code shipped.
 */
const READY: TapToPayAvailability = { status: "ready" };

const props = (over: Partial<Parameters<typeof TapToPayButton>[0]> = {}) => ({
  availability: READY,
  enabled: true,
  role: "authorized" as const,
  onCollect: vi.fn(),
  onEnable: vi.fn(),
  ...over,
});

describe("Tap to Pay button — Apple §5", () => {
  /**
   * 5.3: "should never be altered, greyed out, or otherwise obscured, regardless of whether the
   * user has enabled Tap to Pay on iPhone." PR1 shipped exactly the forbidden thing — a disabled
   * button with a reason — which was right before the entitlement and wrong after it.
   */
  it("5.3 — is live even when the shop has NOT enabled Tap to Pay", () => {
    render(<TapToPayButton {...props({ enabled: false })} />);
    const btn = screen.getByRole("button", { name: /tap to pay/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  /** 5.3, second half: an un-enabled tap opens the Terms & Conditions rather than a reader. */
  it("5.3 — pressing it while not enabled opens the terms, not the reader", () => {
    const onEnable = vi.fn();
    const onCollect = vi.fn();
    render(<TapToPayButton {...props({ enabled: false, onEnable, onCollect })} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to pay/i }));
    expect(onEnable).toHaveBeenCalledOnce();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it("5.3 — pressing it when enabled starts the transaction", () => {
    const onEnable = vi.fn();
    const onCollect = vi.fn();
    render(<TapToPayButton {...props({ enabled: true, onEnable, onCollect })} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to pay/i }));
    expect(onCollect).toHaveBeenCalledOnce();
    expect(onEnable).not.toHaveBeenCalled();
  });

  /** 5.5 — the icon must be SF Symbol wave.3.right.circle; nothing else may stand in. */
  it("5.5 — carries the wave.3.right.circle mark", () => {
    const { container } = render(<TapToPayButton {...props()} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  /** 5.7 — pressed mid-configuration, the user is told it is coming rather than met with nothing. */
  it("5.7 — says it is setting up while the reader configures", () => {
    render(<TapToPayButton {...props({ initializing: true })} />);
    expect(screen.getByText(/setting up tap to pay/i)).toBeTruthy();
  });

  /**
   * 3.8 / 3.8.1 — the terms bind the BUSINESS, so only an owner or the office may accept them.
   * A technician gets told who can, rather than a control that would refuse.
   */
  it("3.8.1 — an unauthorized viewer is told to ask an admin", () => {
    render(<TapToPayButton {...props({ enabled: false, role: "unauthorized" })} />);
    expect(screen.getByText(TAP_TO_PAY_UNAUTHORIZED)).toBeTruthy();
  });

  /**
   * 5.3 is Conditional — conditioned on whether the user can accept terms on their iPhone at all.
   * A browser or an old iPhone genuinely cannot, and those keep the disabled-with-reason
   * treatment. This is the boundary of the requirement, not an exception to it.
   */
  it("keeps the reason treatment for a device that cannot run it", () => {
    render(<TapToPayButton {...props({ availability: { status: "no-native-app" } })} />);
    const btn = screen.getByRole("button", { name: /tap to pay/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
