// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BrandingCard } from "./branding-card";

const updateBrand = vi.fn();
let brand = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };

// useAppStore selector is called with (sel) => sel(storeState).
// We expose a setter so the hydration re-sync test can push a new brand value.
let storeState = { brand, updateBrand };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));

// FoldCard uses useState(defaultOpen) which controls the open/close class.
// Rendering BrandingCard with defaultOpen renders the fbody; no extra setup needed.
vi.mock("./fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div data-testid="foldcard">
      <div className="fhead"><h3>{title}</h3>{summary && <span className="fsum">{summary}</span>}</div>
      <div className="fbody">{children}</div>
    </div>
  ),
}));

describe("BrandingCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brand = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };
    storeState = { brand, updateBrand };
  });

  it("renders the hydrated brand (name + tagline), not SAMPLE_BRAND", () => {
    render(<BrandingCard />);
    expect(screen.getByDisplayValue("Rivera Plumbing")).toBeTruthy();
    expect(screen.getByDisplayValue("Licensed")).toBeTruthy();
    // The prototype placeholder must NOT appear.
    expect(screen.queryByDisplayValue("My Business")).toBeNull();
  });

  it("editing a field and saving calls updateBrand with the patch", () => {
    render(<BrandingCard />);
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Rivera Plumbing Co" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateBrand).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rivera Plumbing Co" }),
    );
  });

  it("does not save a blank business name", () => {
    render(<BrandingCard />);
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateBrand).not.toHaveBeenCalled();
  });

  it("re-syncs draft from the store when brand hydrates (not dirty)", () => {
    // Mount with the placeholder brand first.
    const placeholder = { name: "My Business", tagline: "", site: "", color: "#6B7280", initials: "MB" };
    storeState = { brand: placeholder, updateBrand };
    const { rerender } = render(<BrandingCard />);
    expect(screen.getByDisplayValue("My Business")).toBeTruthy();

    // Simulate BrandHydrator resolving: update storeState and re-render.
    const hydrated = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };
    storeState = { brand: hydrated, updateBrand };
    act(() => { rerender(<BrandingCard />); });

    expect(screen.getByDisplayValue("Rivera Plumbing")).toBeTruthy();
    expect(screen.queryByDisplayValue("My Business")).toBeNull();
  });

  it("does not overwrite user edits when the store brand changes (dirty guard)", () => {
    render(<BrandingCard />);
    // User edits the name field — marks dirty.
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "User Typed Name" } });

    // Store brand changes (simulates optimistic reconcile from a concurrent save).
    const reconciledBrand = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };
    storeState = { brand: reconciledBrand, updateBrand };
    act(() => {});

    // Draft should NOT have been replaced.
    expect(screen.getByDisplayValue("User Typed Name")).toBeTruthy();
  });
});
