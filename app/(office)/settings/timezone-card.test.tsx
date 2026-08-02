// @vitest-environment jsdom
// app/(office)/settings/timezone-card.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The timezone is DERIVED from a ZIP prefix table, and twelve states straddle a line. A shop on
 * the wrong side of one needs to fix it in a click — which is why the derived value is shown at
 * signup rather than applied silently, and why this control has to exist at all. Before this,
 * nothing in the app could change org_settings.timezone.
 */

const updateConfig = vi.fn();
const invalidate = vi.fn();

// Mutable so a single test (the loading-gate one) can flip the query to "unsettled" without a
// second vi.mock factory — vi.mock is hoisted, so the mock body can only read this at call time.
let queryResult: { data: { config: { timezone: string } } | undefined; isFetched: boolean } = {
  data: { config: { timezone: "America/Los_Angeles" } },
  isFetched: true,
};

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      settings: {
        get: { useQuery: () => queryResult },
        updateConfig: { useMutation: () => ({ mutate: updateConfig, isPending: false }) },
      },
    },
    useUtils: () => ({ v1: { settings: { get: { invalidate } } } }),
  },
}));

import { TimezoneCard } from "./timezone-card";

describe("the timezone control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResult = { data: { config: { timezone: "America/Los_Angeles" } }, isFetched: true };
  });

  it("does not present a default zone as confirmed while the real value is still loading", () => {
    queryResult = { data: undefined, isFetched: false };
    render(<TimezoneCard />);
    // Before the derived default leaked through, an Eastern-zone org would flash "Pacific time"
    // as a live, selectable, apparently-confirmed value — the exact "confident wrong answer
    // nobody was asked to check" failure this control exists to prevent.
    expect(screen.queryByDisplayValue("Pacific time")).toBeNull();
    expect(screen.queryByLabelText("Time zone")).toBeNull();
  });

  it("shows the zone the shop is currently on, in words", () => {
    render(<TimezoneCard />);
    expect(screen.getByDisplayValue("Pacific time")).toBeTruthy();
  });

  it("saves a corrected zone as an IANA name", () => {
    render(<TimezoneCard />);
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/New_York" } });
    expect(updateConfig).toHaveBeenCalledWith(
      { timezone: "America/New_York" },
      expect.anything(),
    );
  });

  it("names what the setting affects — an abstract 'time zone' means nothing on its own", () => {
    render(<TimezoneCard />);
    expect(screen.getByText(/front desk/i)).toBeTruthy();
  });
});
