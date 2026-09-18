// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirstRunEmptyState, type EmptyStatePath } from "./first-run-empty-state";

const paths = (onAdd = vi.fn(), onImport = vi.fn()): EmptyStatePath[] => [
  {
    title: "Add one by hand",
    description: "Type in a name and number.",
    actionLabel: "+ Add a customer",
    onAction: onAdd,
    variant: "primary",
  },
  {
    title: "Import a spreadsheet",
    description: "Bring your list over from any CSV.",
    actionLabel: "Upload a CSV",
    onAction: onImport,
  },
];

describe("FirstRunEmptyState", () => {
  it("renders the heading, subtext, and every path's title/description/action", () => {
    render(
      <FirstRunEmptyState
        heading="No customers yet"
        subtext="Start from scratch, or bring your existing customers over."
        paths={paths()}
      />,
    );
    expect(screen.getByText("No customers yet")).toBeTruthy();
    expect(screen.getByText(/Start from scratch/)).toBeTruthy();
    expect(screen.getByText("Add one by hand")).toBeTruthy();
    expect(screen.getByText("Import a spreadsheet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add a customer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload a CSV" })).toBeTruthy();
  });

  it("fires only the clicked path's onAction (DI — no store coupling)", () => {
    const onAdd = vi.fn();
    const onImport = vi.fn();
    render(<FirstRunEmptyState heading="h" subtext="s" paths={paths(onAdd, onImport)} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add a customer" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Upload a CSV" }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("emphasizes the primary variant and leaves the rest ghost", () => {
    render(<FirstRunEmptyState heading="h" subtext="s" paths={paths()} />);
    expect(screen.getByRole("button", { name: "+ Add a customer" }).className).toContain("primary");
    expect(screen.getByRole("button", { name: "Upload a CSV" }).className).toContain("ghost");
  });
});
