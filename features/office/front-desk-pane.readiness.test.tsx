// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The switch may not turn a front desk on that cannot answer.
 *
 * It was a plain checkbox: `setToggle("frontDesk", e.target.checked)` with nothing in the way. One
 * live shop is switched on with no service area — its AI answers real customers on the shop's own
 * number knowing nothing about where it works.
 *
 * Verified here rather than in the browser because the interesting state (unready AND off) needs a
 * shop that does not exist in the shared test database, and manufacturing one by editing live rows
 * is worse than a test.
 */
interface Store {
  toggles: { frontDesk: boolean };
  frontDeskReady: boolean;
  frontDeskMissing: readonly string[];
  booking: Record<string, unknown>;
  setToggle: () => void;
}
let store: Store;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(store),
}));
vi.mock("@/features/identity/hooks", () => ({
  // A shop whose number has landed — the readiness copy must not depend on the number's state.
  useMe: () => ({ data: { twilioNumber: "+15550100" } }),
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { get: { useQuery: () => ({ data: undefined, isFetched: true }) } } } },
}));

import { FrontDeskPane } from "./front-desk-pane";

const setup = (over: Partial<Store> = {}) => {
  store = {
    toggles: { frontDesk: false },
    frontDeskReady: true,
    frontDeskMissing: [],
    // Enough of BookingCfg for the pane to render — the readiness copy is the subject, not these.
    booking: {
      services: [],
      hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { originAddress: "", radiusMiles: 25 },
      serviceFee: 0,
      feeCredited: false,
      notServices: "",
      deferKeywords: "",
      emergencyTransferNumber: null,
    },
    setToggle: vi.fn(),
    ...over,
  } as Store;
  render(<FrontDeskPane />);
  return screen.getByLabelText("Front Desk on/off") as HTMLInputElement;
};

beforeEach(() => vi.clearAllMocks());

describe("FrontDeskPane — the readiness gate on the switch", () => {
  it("disables the switch when the shop is off and not ready", () => {
    const input = setup({ frontDeskReady: false, frontDeskMissing: ["serviceArea"] });
    expect(input.disabled).toBe(true);
  });

  it("names the missing piece instead of just refusing", () => {
    setup({ frontDeskReady: false, frontDeskMissing: ["serviceArea"] });
    expect(screen.getByText(/Add your service area to turn this on/)).toBeTruthy();
  });

  it("joins several missing pieces into one sentence", () => {
    setup({ frontDeskReady: false, frontDeskMissing: ["serviceArea", "services"] });
    expect(screen.getByText(/your service area and a bookable service/)).toBeTruthy();
  });

  it("says 'Not set up yet' rather than implying calls are being handled", () => {
    // "Off — calls go to voicemail" would be a lie about a shop that never finished setup.
    setup({ frontDeskReady: false, frontDeskMissing: ["serviceArea"] });
    expect(screen.getByText("Not set up yet")).toBeTruthy();
  });

  it("NEVER disables the switch for a shop that is already on but unready", () => {
    // The live state of two orgs. Disabling here would trap them answering badly with no way to
    // stop — the one action they most need.
    const input = setup({
      toggles: { frontDesk: true },
      frontDeskReady: false,
      frontDeskMissing: ["serviceArea"],
    });
    expect(input.disabled).toBe(false);
  });

  it("leaves the switch alone once the shop is ready", () => {
    const input = setup({ frontDeskReady: true, frontDeskMissing: [] });
    expect(input.disabled).toBe(false);
    expect(screen.queryByText(/to turn this on/)).toBeNull();
  });
});
