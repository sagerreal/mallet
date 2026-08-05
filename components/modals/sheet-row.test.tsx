// @vitest-environment jsdom
/**
 * components/modals/sheet-row.test.tsx
 *
 * The sheet grammar's one row, and the point of the `variant` prop: BOTH registers are the same
 * disclosure. The section register used to be a second component (tech-job-modal/counted-section)
 * whose copy had drifted — no aria-controls linking the head to its body, a 44px target instead of
 * the grammar's 52px, and no controlled mode. These tests are written against the behaviour, and
 * run against both registers, so the two cannot drift apart again.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SheetRow, type SheetRowVariant } from "./sheet-row";

const REGISTERS: SheetRowVariant[] = ["row", "section"];

describe.each(REGISTERS)("SheetRow — variant=%s", (variant) => {
  it("starts shut and renders none of its body", () => {
    render(
      <SheetRow variant={variant} label="Job notes" value={2} expandable>
        <p>Gate code 4411</p>
      </SheetRow>,
    );
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Gate code 4411")).toBeNull();
  });

  it("opens in flow on press", () => {
    render(
      <SheetRow variant={variant} label="Job notes" value={2} expandable>
        <p>Gate code 4411</p>
      </SheetRow>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Gate code 4411")).toBeTruthy();
  });

  // THE LINK. A disclosure button that names no body is a control pointing at nothing — the same
  // defect this branch fixed on the modal's own tablist.
  it("points aria-controls at the body it opened", () => {
    render(
      <SheetRow variant={variant} label="Job notes" value={2} expandable>
        <p>Gate code 4411</p>
      </SheetRow>,
    );
    const head = screen.getByRole("button");
    expect(head.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(head);
    const bodyId = head.getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)?.textContent).toContain("Gate code 4411");
  });

  it("opens on first render when asked to", () => {
    render(
      <SheetRow variant={variant} label="Job notes" value={2} expandable defaultOpen>
        <p>Gate code 4411</p>
      </SheetRow>,
    );
    expect(screen.getByText("Gate code 4411")).toBeTruthy();
  });

  // Controlled mode is how a primary action ("Add phone") opens its own target row.
  it("obeys a controlled open and reports every toggle instead of moving itself", () => {
    const onOpenChange = vi.fn();
    render(
      <SheetRow variant={variant} label="Job notes" value={2} expandable open={false} onOpenChange={onOpenChange}>
        <p>Gate code 4411</p>
      </SheetRow>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // The owner said shut, so it stays shut.
    expect(screen.queryByText("Gate code 4411")).toBeNull();
  });

  it("is a plain action row when it is not expandable — no aria-expanded, no body", () => {
    const onPress = vi.fn();
    render(<SheetRow variant={variant} label="Phone" value="Add" onPress={onPress} />);
    const head = screen.getByRole("button");
    expect(head.getAttribute("aria-expanded")).toBeNull();
    fireEvent.click(head);
    expect(onPress).toHaveBeenCalled();
  });

  it("renders the trailing qualifier between the value and the caret", () => {
    render(<SheetRow variant={variant} label="Found work" value={3} after={<span>· 1 awaiting OK</span>} expandable />);
    expect(screen.getByRole("button").textContent).toContain("· 1 awaiting OK");
  });
});

// The registers differ in ONE thing: the chrome they are drawn in.
describe("SheetRow — the registers", () => {
  it("draws the config row as a .sheet-row with a .sheet-acc body", () => {
    const { container } = render(
      <SheetRow label="Notes" value={2} expandable defaultOpen>
        <p>body</p>
      </SheetRow>,
    );
    expect(container.querySelector("button.sheet-row")).toBeTruthy();
    expect(container.querySelector(".sheet-acc")).toBeTruthy();
  });

  it("draws the section head as the field sheet's .fsec chapter, open-state on the wrapper", () => {
    const { container } = render(
      <SheetRow variant="section" label="Found work" value={2} expandable defaultOpen>
        <p>body</p>
      </SheetRow>,
    );
    expect(container.querySelector("button.fsec-h.tjf-h")).toBeTruthy();
    expect(container.querySelector(".fsec.tjf.open")).toBeTruthy();
  });
});
