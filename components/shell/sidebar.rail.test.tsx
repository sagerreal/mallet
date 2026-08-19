// @vitest-environment jsdom
/**
 * components/shell/sidebar.rail.test.tsx
 *
 * The sidebar rail: 248px of navigation on an 820pt iPad was 30% of the screen — and exactly
 * the width the Money table's PAID/DUE columns were missing when they clipped. Narrow
 * viewports start collapsed; an explicit toggle is remembered; the two controls that need the
 * full width (the + New menu, the account menu) expand the rail first instead of opening a
 * dropdown inside a 64px column.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role: "owner", name: "Dana", orgName: "Cedarline" }, isLoading: false }),
}));
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ jobs: [], leads: [], invoices: [], tasks: [], estimates: [] }),
}));
vi.mock("@/components/shell/new-menu", () => ({ NewMenu: () => <div data-testid="new-menu" /> }));
vi.mock("@/components/shell/nav-pending", () => ({ NavPending: () => null }));
vi.mock("@/components/shell/use-nav-counts", () => ({
  // The REAL return shape (jobs/customers/money/messages) — a mock with invented keys makes
  // every badge silently untested.
  useNavCounts: () => ({ jobs: 3, customers: 12, money: 2, messages: 0 }),
}));
vi.mock("@/features/auth/hooks", () => ({ signOut: vi.fn() }));

import { Sidebar } from "./sidebar";

const initialMe = { role: "owner", name: "Dana", orgName: "Cedarline" } as never;

function setViewport(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

/** jsdom's localStorage here lacks .clear — give each test its own tiny real store. */
function freshStorage() {
  const bag = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => void bag.set(k, String(v)),
      removeItem: (k: string) => void bag.delete(k),
    },
  });
}

describe("Sidebar rail", () => {
  beforeEach(() => {
    freshStorage();
  });

  it("starts collapsed on a narrow viewport — the iPad default", async () => {
    setViewport(true);
    const { container } = render(<Sidebar initialMe={initialMe} />);

    await waitFor(() => expect(container.querySelector("aside.sidebar.rail")).toBeTruthy());
  });

  it("stays expanded on a wide viewport", async () => {
    setViewport(false);
    const { container } = render(<Sidebar initialMe={initialMe} />);

    await waitFor(() =>
      expect(container.querySelector("aside.sidebar:not(.rail)")).toBeTruthy(),
    );
  });

  it("remembers an explicit choice over the viewport default", async () => {
    window.localStorage.setItem("mallet.nav.rail", "0");
    setViewport(true);
    const { container } = render(<Sidebar initialMe={initialMe} />);

    await waitFor(() =>
      expect(container.querySelector("aside.sidebar:not(.rail)")).toBeTruthy(),
    );
  });

  it("the toggle collapses, persists, and announces itself", async () => {
    setViewport(false);
    const { container } = render(<Sidebar initialMe={initialMe} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));

    expect(container.querySelector("aside.sidebar.rail")).toBeTruthy();
    expect(window.localStorage.getItem("mallet.nav.rail")).toBe("1");
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeTruthy();
  });

  it("in the rail, + New expands first — a 64px column cannot host the dropdown", async () => {
    setViewport(true);
    const { container } = render(<Sidebar initialMe={initialMe} />);
    await waitFor(() => expect(container.querySelector("aside.sidebar.rail")).toBeTruthy());
    expect(screen.queryByTestId("new-menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation to create" }));

    expect(container.querySelector("aside.sidebar.rail")).toBeNull();
    expect(screen.getByTestId("new-menu")).toBeTruthy();
  });

  it("in the rail, the account row expands instead of opening its menu", async () => {
    setViewport(true);
    const { container } = render(<Sidebar initialMe={initialMe} />);
    await waitFor(() => expect(container.querySelector("aside.sidebar.rail")).toBeTruthy());

    fireEvent.click(container.querySelector(".sideacct") as HTMLElement);

    expect(container.querySelector("aside.sidebar.rail")).toBeNull();
    expect(container.querySelector(".acct-menu")).toBeNull();
  });
});
