// @vitest-environment jsdom
/**
 * app/(office)/settings/service-row.test.tsx
 *
 * Guards the Priced-by control (measurement-rates phase 3, task 2): the org-level
 * measurementEstimating gate must keep the editor byte-identical to today when off
 * (zero-diff discipline — structure assertion, not just "text absent"), and on ->
 * show a Priced-by select whose choice both updates the price field's unit label
 * and commits measuredBy (Flat commits null).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServiceRow } from "./service-row";
import type { Service, Category } from "@/lib/store/types";

const categories: Category[] = [];

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc-1",
    categoryId: null,
    code: null,
    name: "Repaint living room walls",
    unitPrice: 1.1,
    cost: 0,
    laborHours: null,
    taxable: false,
    warrantyText: null,
    imageUrl: null,
    isAddon: false,
    active: true,
    position: 0,
    measuredBy: null,
    ...overrides,
  };
}

function openRow() {
  fireEvent.click(screen.getByRole("button", { name: /Repaint living room walls/ }));
}

describe("ServiceRow — Priced-by control (gated on measurementEstimating)", () => {
  it("toggle off: renders no Priced-by control at all (structure assertion)", () => {
    render(
      <ServiceRow
        service={makeService()}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={false}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    expect(screen.queryByText("Priced by")).toBeNull();
    // The C-shape editor's default fields are unaffected — Name and Price still there.
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Price")).toBeTruthy();
  });

  it("toggle on: shows the Priced-by control, default Flat", () => {
    render(
      <ServiceRow
        service={makeService()}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    expect(screen.getByText("Priced by")).toBeTruthy();
    expect(screen.getByLabelText("Priced by")).toBeTruthy();
    // Flat -> flat "$" label on the price field.
    expect(screen.getByText("$")).toBeTruthy();
  });

  it("selecting a measured kind updates the price label and commits measuredBy", () => {
    const onUpdate = vi.fn();
    render(
      <ServiceRow
        service={makeService()}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={onUpdate}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    fireEvent.click(screen.getByLabelText("Priced by"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Walls (per sq ft)" }));

    expect(onUpdate).toHaveBeenCalledWith("svc-1", { measuredBy: "walls_sqft" });
  });

  it("shows '$ per sq ft' / '$ per ln ft' / '$ each' labels for the matching kinds", () => {
    const { unmount: unmount1 } = render(
      <ServiceRow
        service={makeService({ measuredBy: "ceiling_sqft" })}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    expect(screen.getAllByText("per sq ft").length).toBeGreaterThan(0);
    unmount1();

    const { unmount: unmount2 } = render(
      <ServiceRow
        service={makeService({ measuredBy: "crown_lnft" })}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    expect(screen.getAllByText("per ln ft").length).toBeGreaterThan(0);
    unmount2();

    render(
      <ServiceRow
        service={makeService({ measuredBy: "doors_count" })}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    expect(screen.getAllByText("each").length).toBeGreaterThan(0);
  });

  it("selecting Flat on a measured service commits measuredBy: null", () => {
    const onUpdate = vi.fn();
    render(
      <ServiceRow
        service={makeService({ measuredBy: "windows_count" })}
        categories={categories}
        canSeeCost={false}
        measurementEstimating={true}
        onUpdate={onUpdate}
        onArchive={vi.fn()}
      />,
    );
    openRow();
    fireEvent.click(screen.getByLabelText("Priced by"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Flat" }));

    expect(onUpdate).toHaveBeenCalledWith("svc-1", { measuredBy: null });
  });
});
