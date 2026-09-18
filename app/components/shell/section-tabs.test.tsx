// @vitest-environment jsdom
/**
 * components/shell/section-tabs.test.tsx
 * The Money branch: ONE tab, "Purchase orders" (?tab=orders) — the base /money view (no ?tab=)
 * is the invoices ledger and carries no tab of its own; "Getting paid" was removed (Owen: just
 * keep invoices under Money, call orders purchase orders).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/money";
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { tasks: unknown[]; estimates: unknown[]; jobs: unknown[] }) => unknown) =>
    sel({ tasks: [], estimates: [], jobs: [] }),
}));
vi.mock("@/components/shell/use-nav-counts", () => ({
  useNavCounts: () => ({ customers: 0, jobs: 0, money: 0, messages: 0 }),
}));

import { SectionTabs } from "./section-tabs";

function setup(path: string, tab?: string) {
  pathname = path;
  searchParams = new URLSearchParams(tab ? { tab } : {});
}

describe("SectionTabs — Money", () => {
  it("shows Money's one tab when inside /money", () => {
    setup("/money");
    render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Purchase orders/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Getting paid/ })).toBeNull();
  });

  it("marks Purchase orders active on ?tab=orders, and unselected with no tab", () => {
    setup("/money");
    const { rerender } = render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Purchase orders/ }).getAttribute("aria-current")).toBeNull();

    setup("/money", "orders");
    rerender(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Purchase orders/ }).getAttribute("aria-current")).toBe("page");
  });

  it("Purchase orders' href carries the ?tab=orders param", () => {
    setup("/money");
    render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Purchase orders/ }).getAttribute("href")).toBe("/money?tab=orders");
  });

  it("renders nothing outside a section with sub-views", () => {
    setup("/settings");
    const { container } = render(<SectionTabs />);
    expect(container.firstChild).toBeNull();
  });
});
