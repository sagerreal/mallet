// @vitest-environment jsdom
/**
 * app/(office)/settings/payments-card.test.tsx
 *
 * The card that tells a shop whether it can take money.
 *
 * It used to key its headline on `detailsSubmitted` — the shop finished Stripe's form — and print
 * "Connected ✓" on that alone, with the fact that matters demoted to a grey sub-line reading "Card
 * charges pending". Summit Plumbing sat in exactly that state: the office believed payments were
 * live, and every customer opening an invoice was told to "contact us directly" instead of paying.
 *
 * Finishing a form is not the same as being able to charge a card, and this card must never again
 * say otherwise.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

interface Status {
  hasAccount: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

let statusData: Status | undefined;
const refreshMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { settings: { payments: { status: { invalidate } } } } }),
    v1: {
      settings: {
        payments: {
          status: { useQuery: () => ({ data: statusData, isLoading: false }) },
          beginOnboarding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          refresh: { useMutation: () => ({ mutate: refreshMutate, isPending: false }) },
        },
      },
    },
  },
}));

import { PaymentsCard } from "./payments-card";

const VERIFYING: Status = {
  hasAccount: true,
  detailsSubmitted: true,
  chargesEnabled: false,
  payoutsEnabled: false,
};
const LIVE: Status = {
  hasAccount: true,
  detailsSubmitted: true,
  chargesEnabled: true,
  payoutsEnabled: true,
};

describe("PaymentsCard — the headline tracks whether money can move", () => {
  beforeEach(() => {
    refreshMutate.mockClear();
    invalidate.mockClear();
    statusData = undefined;
  });

  it("does NOT claim Connected while Stripe has not enabled charges", () => {
    statusData = VERIFYING;
    render(<PaymentsCard />);

    expect(screen.queryByText("Connected ✓")).toBeNull();
  });

  it("says plainly that customers cannot pay yet", () => {
    statusData = VERIFYING;
    render(<PaymentsCard />);

    expect(screen.getByText(/customers can.t pay yet/i)).toBeTruthy();
  });

  it("says Connected only once charges are actually enabled", () => {
    statusData = LIVE;
    render(<PaymentsCard />);

    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("offers a way to re-check, because nothing else ever writes the flag back", () => {
    // The only caller of refresh was the ?connect=return redirect, which is unreachable once the
    // card renders a connected state with no button. So a shop whose charges were enabled hours
    // later stayed stuck forever.
    statusData = VERIFYING;
    render(<PaymentsCard />);

    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(refreshMutate).toHaveBeenCalled();
  });

  it("still offers the re-check once live, so payouts pending can resolve too", () => {
    statusData = { ...LIVE, payoutsEnabled: false };
    render(<PaymentsCard />);

    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
  });

  it("shows the not-connected state when there is no account at all", () => {
    statusData = { hasAccount: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false };
    render(<PaymentsCard />);

    expect(screen.queryByText("Connected ✓")).toBeNull();
    expect(screen.queryByText(/customers can.t pay yet/i)).toBeNull();
  });
});
