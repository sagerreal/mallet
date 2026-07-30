// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Lead } from "@/lib/store/types";
import { LeadRow } from "./lead-row";

const lead = { id: "L1", name: "Ada Lovelace", phone: "", source: "", stage: "New customer", age: 3, archived: true } as unknown as Lead;

const renderRow = (onRestore?: (id: string) => void) => {
  const onOpen = vi.fn();
  render(
    <table><tbody>
      <LeadRow lead={lead} visibleCols={["name"]} onOpen={onOpen} onRestore={onRestore} />
    </tbody></table>,
  );
  return { onOpen };
};

describe("LeadRow — archived restore (moved from the retired Settings Archive tab)", () => {
  it("renders a Restore cell when onRestore is provided, and restoring does NOT open the lead", () => {
    const onRestore = vi.fn();
    const { onOpen } = renderRow(onRestore);
    fireEvent.click(screen.getByRole("button", { name: "Restore Ada Lovelace" }));
    expect(onRestore).toHaveBeenCalledWith("L1");
    expect(onOpen).not.toHaveBeenCalled(); // stopPropagation — row click stays separate
  });

  it("renders no Restore cell on the normal (active) view", () => {
    renderRow(undefined);
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });
});
