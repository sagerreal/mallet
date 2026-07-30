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
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard",
}));

import { Topbar } from "./topbar";

describe("Topbar", () => {
  it("renders the breadcrumb and the standing controls", () => {
    render(<Topbar />);
    expect(screen.getByText("Office")).toBeTruthy();
    expect(screen.getByTitle("Light / dark")).toBeTruthy();
    expect(screen.getByTitle("Notifications")).toBeTruthy();
  });

  it("carries NO create trigger — creation lives in the tab bar's center button", () => {
    render(<Topbar />);
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });
});
