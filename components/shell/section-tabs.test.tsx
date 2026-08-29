// @vitest-environment jsdom
/**
 * components/shell/section-tabs.test.tsx
 * The Money branch: "Getting paid" (default) and "Orders" (?tab=orders) — added
 * alongside Customers/Jobs, mirroring the Jobs branch's ?tab= grammar exactly.
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
  it("shows Money's two tabs when inside /money", () => {
    setup("/money");
    render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Getting paid/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Orders/ })).toBeTruthy();
  });

  it("marks Orders active on ?tab=orders and Getting paid active with no tab", () => {
    setup("/money");
    const { rerender } = render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Getting paid/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Orders/ }).getAttribute("aria-current")).toBeNull();

    setup("/money", "orders");
    rerender(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Orders/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Getting paid/ }).getAttribute("aria-current")).toBeNull();
  });

  it("Orders' href carries the ?tab=orders param", () => {
    setup("/money");
    render(<SectionTabs />);
    expect(screen.getByRole("link", { name: /Orders/ }).getAttribute("href")).toBe("/money?tab=orders");
    expect(screen.getByRole("link", { name: /Getting paid/ }).getAttribute("href")).toBe("/money");
  });

  it("renders nothing outside a section with sub-views", () => {
    setup("/settings");
    const { container } = render(<SectionTabs />);
    expect(container.firstChild).toBeNull();
  });
});
