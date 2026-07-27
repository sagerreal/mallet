// @vitest-environment jsdom
/**
 * components/shell/topbar.test.tsx
 *
 * The "+ New" create menu lives in the sidebar, and the sidebar is `display:none`
 * below 760px — so on a phone the ONLY way to create a customer, quote, job or
 * invoice disappeared entirely. The topbar is the one piece of chrome present at
 * every breakpoint, so it carries the create action on mobile.
 *
 * The structural assertion here is the important one: the panel must render as a
 * SIBLING after <header>, not inside it. That is what makes it expand in-flow and
 * push the page down, rather than float over the content as a popover.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
const openModal = vi.fn();
const addInvoice = vi.fn(() => ({ id: "inv-77" }));

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

vi.mock("@/lib/store/app-store", () => ({
  useOpenModal: () => openModal,
  useAppStore: (select: (s: unknown) => unknown) => select({ addInvoice }),
}));

import { Topbar } from "./topbar";

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "New" }));
};

describe("Topbar create menu", () => {
  beforeEach(() => {
    push.mockClear();
    openModal.mockClear();
    addInvoice.mockClear();
  });

  it("offers a New trigger, so the create path survives when the sidebar is hidden", () => {
    render(<Topbar />);
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("keeps the menu closed until asked", () => {
    render(<Topbar />);
    expect(screen.queryByRole("button", { name: "New job" })).toBeNull();
  });

  it("expands all four create actions in pipeline order", () => {
    render(<Topbar />);
    openMenu();
    const labels = ["New customer", "New quote", "New job", "New invoice"];
    for (const label of labels) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("expands BELOW the header rather than floating over the page", () => {
    const { container } = render(<Topbar />);
    openMenu();
    const header = container.querySelector("header.topbar");
    const panel = container.querySelector(".topnewmenu");
    expect(header).not.toBeNull();
    expect(panel).not.toBeNull();
    // In-flow, anchored, flush — not a popover parked inside the bar.
    expect(header!.contains(panel!)).toBe(false);
    expect(header!.nextElementSibling).toBe(panel);
  });

  it("marks the trigger's expanded state for assistive tech", () => {
    render(<Topbar />);
    const trigger = screen.getByRole("button", { name: "New" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    openMenu();
    expect(screen.getByRole("button", { name: "New" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("routes to the composer for a new quote and closes", () => {
    render(<Topbar />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "New quote" }));
    expect(push).toHaveBeenCalledWith("/composer");
    expect(screen.queryByRole("button", { name: "New quote" })).toBeNull();
  });

  it("opens the new-customer modal and closes", () => {
    render(<Topbar />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "New customer" }));
    expect(openModal).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New customer" })).toBeNull();
  });

  it("still renders the existing topbar controls", () => {
    render(<Topbar />);
    expect(screen.getByTitle("Light / dark")).toBeTruthy();
    expect(screen.getByTitle("Notifications")).toBeTruthy();
  });
});
