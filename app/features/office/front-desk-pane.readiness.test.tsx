// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The switch may not turn on a front desk that cannot answer — WITHOUT deadlocking the screen.
 *
 * The first cut used `disabled`, and Owen hit the trap within minutes: a disabled control takes no
 * focus, so clicking it never blurred the service-address field above it. The typed address stayed
 * an uncommitted draft, readiness never became true, and the switch could never enable. Typing the
 * missing detail and then reaching for the switch — the entire purpose of this screen — was the one
 * sequence that could not work. He reloaded, lost the address, and only the radius had saved.
 *
 * So: the control stays enabled, the click lands (committing the address on blur), and readiness is
 * computed from the LIVE store rather than the server's last snapshot.
 */
interface Store {
  toggles: { frontDesk: boolean };
  booking: Record<string, unknown>;
  setToggle: (k: string, v: boolean) => void;
}
let store: Store;
const setToggle = vi.fn();
const setBookingArea = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(store),
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { twilioNumber: "+15550100" } }),
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { get: { useQuery: () => ({ data: undefined, isFetched: true }) } } } },
}));

import { FrontDeskPane } from "./front-desk-pane";

const OPEN_HOURS = {
  wdOpen: 8, wdClose: 17,
  monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17,
  thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0,
  sunOpen: 0, sunClose: 0,
};
const NO_ORIGIN = { cities: "", radiusMi: 25, originAddress: "" };

/** A booking config that is READY unless an override takes something away. */
const booking = (over: Record<string, unknown> = {}) => ({
  services: [{ name: "Drain cleaning", lane: "flat", price: 189, triggers: "" }],
  hours: OPEN_HOURS,
  area: { cities: "", radiusMi: 25, originAddress: "2100 Rheem Drive, Pleasanton CA" },
  notServices: "",
  serviceFee: 0,
  feeCredited: false,
  deferKeywords: "",
  emergencyTransferNumber: null,
  ...over,
});

const setupRender = (over: Partial<Store> = {}) => {
  store = { toggles: { frontDesk: false }, booking: booking(), setToggle, setBookingArea, ...over } as Store;
  return render(<FrontDeskPane />);
};

const setup = (over: Partial<Store> = {}) => {
  setupRender(over);
  return screen.getByLabelText("Front Desk on/off") as HTMLInputElement;
};

beforeEach(() => vi.clearAllMocks());

describe("FrontDeskPane — the readiness gate on the switch", () => {
  it("NEVER uses `disabled` — that is what deadlocked the screen", () => {
    // The regression test for Owen's report. A disabled control takes no focus, so the click that
    // reaches for it cannot blur the address field, and the address is what would have unblocked it.
    const input = setup({ booking: booking({ area: NO_ORIGIN }) });
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not switch on while a detail is missing", () => {
    const input = setup({ booking: booking({ area: NO_ORIGIN }) });
    fireEvent.click(input);
    expect(setToggle).not.toHaveBeenCalled();
  });

  it("names the missing piece instead of just refusing", () => {
    setup({ booking: booking({ area: NO_ORIGIN }) });
    expect(screen.getByText(/Add your service area to turn this on/)).toBeTruthy();
  });

  it("reads the LIVE store, so a just-typed service area counts immediately", () => {
    // The second half of the bug: readiness came from the server's last settings fetch, so the
    // screen kept saying "not ready" about a field the user had already filled in.
    const input = setup({ booking: booking() });
    expect(input.getAttribute("aria-disabled")).toBe("false");
    expect(screen.queryByText(/to turn this on/)).toBeNull();
  });

  it("joins several missing pieces into one sentence", () => {
    setup({ booking: booking({ area: NO_ORIGIN, services: [] }) });
    expect(screen.getByText(/your service area and a bookable service/)).toBeTruthy();
  });

  it("says 'Not set up yet' rather than implying calls are being handled", () => {
    setup({ booking: booking({ area: NO_ORIGIN }) });
    expect(screen.getByText("Not set up yet")).toBeTruthy();
  });

  it("switches on once every detail is there", () => {
    const input = setup({ booking: booking() });
    fireEvent.click(input);
    expect(setToggle).toHaveBeenCalledWith("frontDesk", true);
  });

  it("NEVER blocks switching OFF, even for a shop that is on while unready", () => {
    // Three live orgs are on-and-unready. Blocking here would trap them answering badly.
    const input = setup({ toggles: { frontDesk: true }, booking: booking({ area: NO_ORIGIN }) });
    expect(input.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(input);
    expect(setToggle).toHaveBeenCalledWith("frontDesk", false);
  });
});

/**
 * The office address must survive the two ways it was being lost.
 *
 * Owen's report — "I reloaded the page and only the service radius saved" — is one screen with two
 * separate defects on it, both making a saved address look unsaved:
 *
 *   1. The draft only ever committed on blur or on picking a suggestion. Typing a full address and
 *      pressing Enter did nothing at all.
 *   2. `useState` seeded the draft at MOUNT, and this pane mounts before settings hydrate (the
 *      shimmer is an early return placed after every hook). The store then filled in with the real
 *      address and the box went on rendering "". The radius, which reads the store directly, kept
 *      its value — which is exactly the asymmetry he described.
 */
describe("FrontDeskPane — the office address", () => {
  // The address lives inside the collapsed "Service area" rule row — open it, as a user would.
  const openArea = () => fireEvent.click(screen.getByText("Service area"));
  const addr = () => screen.getByLabelText("Office address") as HTMLInputElement;

  it("commits on Enter, not only on blur", () => {
    setup({ booking: booking({ area: NO_ORIGIN }) });
    openArea();
    fireEvent.change(addr(), { target: { value: "2100 Rheem Drive, Pleasanton CA" } });
    fireEvent.keyDown(addr(), { key: "Enter" });
    expect(setBookingArea).toHaveBeenCalledWith("originAddress", "2100 Rheem Drive, Pleasanton CA");
  });

  it("still commits on blur", () => {
    setup({ booking: booking({ area: NO_ORIGIN }) });
    openArea();
    fireEvent.change(addr(), { target: { value: "9 Main St" } });
    fireEvent.blur(addr());
    expect(setBookingArea).toHaveBeenCalledWith("originAddress", "9 Main St");
  });

  it("shows an address that hydrates AFTER mount", () => {
    // The reload case. Mount empty (pre-hydration), then let the store fill in.
    const { rerender } = setupRender({ booking: booking({ area: NO_ORIGIN }) });
    openArea();
    expect(addr().value).toBe("");

    store = { ...store, booking: booking() };
    rerender(<FrontDeskPane />);
    expect(addr().value).toBe("2100 Rheem Drive, Pleasanton CA");
  });

  it("does not clobber what is being typed", () => {
    // The sync must fire on a STORE change, never on every render — otherwise it eats keystrokes.
    const { rerender } = setupRender({ booking: booking() });
    openArea();
    fireEvent.change(addr(), { target: { value: "2100 Rheem Dr" } });
    rerender(<FrontDeskPane />);
    expect(addr().value).toBe("2100 Rheem Dr");
  });
});
