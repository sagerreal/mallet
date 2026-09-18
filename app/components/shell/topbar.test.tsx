// @vitest-environment jsdom
/**
 * components/shell/topbar.test.tsx
 *
 * The topbar is chrome only: breadcrumb, back affordance, theme, notifications.
 * The CREATE action deliberately does NOT live here — it moved to the tab bar's
 * center button (mobile-tabs.test.tsx guards that contract) after the corner "+"
 * proved too small for the app's key action. The absence assertion below keeps a
 * second create surface from quietly growing back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();

// jsdom here exposes a `localStorage` global that is not a Storage instance, so the
// theme read in Topbar throws on mount. Give it a working one — this is a harness
// gap, not a product concern.
const themeStore = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => themeStore.get(key) ?? null,
  setItem: (key: string, value: string) => void themeStore.set(key, value),
  removeItem: (key: string) => void themeStore.delete(key),
  clear: () => themeStore.clear(),
});

let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => mockPathname,
}));

import { Topbar } from "./topbar";

/** The crumb reads "<section>›<label>" — assert the whole trail, not one word of it. */
const crumbText = () => document.getElementById("crumb")!.textContent;

describe("Topbar", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
  });

  it("renders the breadcrumb and the standing controls", () => {
    render(<Topbar />);
    expect(screen.getByText("Office")).toBeTruthy();
    // No notifications bell, and no light/dark toggle (cut Aug 2026 — the app commits to its
    // one look). A corner icon that does nothing for the work teaches people not to trust the
    // icons that do.
    expect(screen.queryByTitle("Notifications")).toBeNull();
    expect(screen.queryByTitle("Light / dark")).toBeNull();
  });

  it("carries the More overflow (phone-only via CSS) so dropping the More tab lost no reach", () => {
    render(<Topbar />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(push).toHaveBeenCalledWith("/more");
  });

  it("carries NO create trigger — creation lives in the tab bar's center button", () => {
    render(<Topbar />);
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });
});

/**
 * The breadcrumb used to open with a hardcoded "Customer" on EVERY office route, so Money read
 * "Customer › Money" and Settings "Customer › Settings" — the crumb named the wrong part of the
 * app on eleven of its thirteen entries. The sections below are the sidebar's own groups.
 */
describe("Topbar breadcrumb — the section is the sidebar's group", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["/dashboard", "Office›Today"],
    ["/frontdesk", "Office›Front Desk"],
    ["/pricebook", "Office›Pricebook"],
    ["/customers", "Customers"],
    ["/quotes", "Customers›Quotes"],
    ["/tasks", "Customers›Tasks"],
    ["/money", "Money"],
    ["/settings", "Settings"],
    ["/jobs", "Jobs"],
  ];

  for (const [path, expected] of cases) {
    it(`reads "${expected}" on ${path}`, () => {
      mockPathname = path;
      render(<Topbar />);
      expect(crumbText()).toBe(expected);
    });
  }

  it("never calls a page a Customer page unless it is one", () => {
    // The four that were most obviously wrong: none of them lives under Customers.
    for (const path of ["/dashboard", "/jobs", "/money", "/settings"]) {
      mockPathname = path;
      const { unmount } = render(<Topbar />);
      expect(crumbText()).not.toContain("Customer");
      unmount();
    }
  });

  it("puts the field More page under Field — it was 'Customer › Home'", () => {
    mockPathname = "/account";
    render(<Topbar />);
    expect(crumbText()).toBe("Field›More");
  });

  it("inherits the parent crumb on a nested route", () => {
    mockPathname = "/jobs/abc-123";
    render(<Topbar />);
    expect(crumbText()).toBe("Jobs");
  });
});
