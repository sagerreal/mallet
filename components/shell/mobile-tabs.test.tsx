// @vitest-environment jsdom
/**
 * components/shell/mobile-tabs.test.tsx
 *
 * The tab bar's center create button is the ONLY create path on a phone (the
 * sidebar is display:none below 760px and the topbar deliberately carries no "+").
 * These tests guard that contract: the button exists dead-center of the office tab
 * set, opens all four create actions in pipeline order as a sibling sheet (in-flow
 * grammar, not a popover inside the nav), and never renders for field techs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
const openModal = vi.fn();
const addInvoice = vi.fn(() => ({ id: "inv-9" }));
let role = "owner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ isLoading: false, data: { role } }),
}));
vi.mock("@/components/shell/use-nav-counts", () => ({
  useNavCounts: () => ({ customers: 3, jobs: 5 }),
}));
vi.mock("@/lib/store/app-store", () => ({
  useOpenModal: () => openModal,
  useAppStore: (select: (s: unknown) => unknown) =>
    typeof select === "function" ? select({ addInvoice, invoices: [] }) : 0,
}));
vi.mock("@/components/shell/shell-selectors", () => ({
  selectCustomerCount: () => 0,
  selectJobsCount: () => 0,
  selectMoneyCount: () => 0,
}));

import { MobileTabs } from "./mobile-tabs";

const CREATE_NAME = "Create — customer, quote, job, or invoice";
const openSheet = () => fireEvent.click(screen.getByRole("button", { name: CREATE_NAME }));

describe("MobileTabs center create button", () => {
  beforeEach(() => {
    push.mockClear();
    openModal.mockClear();
    role = "owner";
  });

  it("sits dead-center of the office tab set", () => {
    const { container } = render(<MobileTabs />);
    const nav = container.querySelector("#mobiletabs")!;
    const items = Array.from(nav.children);
    expect(items).toHaveLength(5); // Office · Customers · [+] · Jobs · Money — dead center
    expect(items[2]!.getAttribute("aria-label")).toBe(CREATE_NAME);
  });

  it("stays closed until asked, then expands all four create actions in pipeline order", () => {
    render(<MobileTabs />);
    expect(screen.queryByRole("button", { name: "New job" })).toBeNull();
    openSheet();
    for (const label of ["New customer", "New quote", "New job", "New invoice"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("renders the sheet as a SIBLING of the nav, not a popover inside it", () => {
    const { container } = render(<MobileTabs />);
    openSheet();
    const nav = container.querySelector("#mobiletabs")!;
    const sheet = container.querySelector(".mobnewmenu")!;
    expect(sheet).not.toBeNull();
    expect(nav.contains(sheet)).toBe(false);
  });

  it("marks expanded state for assistive tech", () => {
    render(<MobileTabs />);
    const trigger = screen.getByRole("button", { name: CREATE_NAME });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    openSheet();
    expect(screen.getByRole("button", { name: CREATE_NAME }).getAttribute("aria-expanded")).toBe("true");
  });

  it("routes to the composer for a new quote and closes the sheet", () => {
    render(<MobileTabs />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "New quote" }));
    expect(push).toHaveBeenCalledWith("/composer");
    expect(screen.queryByRole("button", { name: "New quote" })).toBeNull();
  });

  it("opens the new-customer modal and closes the sheet", () => {
    render(<MobileTabs />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "New customer" }));
    expect(openModal).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New customer" })).toBeNull();
  });

  it("never renders a create button for field techs", () => {
    role = "tech";
    render(<MobileTabs />);
    expect(screen.queryByRole("button", { name: CREATE_NAME })).toBeNull();
  });
});
