// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrandingCard } from "./branding-card";

const updateBrand = vi.fn();
let brand = { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#9C5B34", initials: "RP" };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { brand: typeof brand; updateBrand: typeof updateBrand }) => unknown) =>
    sel({ brand, updateBrand }),
}));

describe("BrandingCard", () => {
  beforeEach(() => { vi.clearAllMocks(); });

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
});
