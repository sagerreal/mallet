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

describe("LeadRow — the phone cell", () => {
  const withPhone = (phone: string) =>
    render(
      <table><tbody>
        <LeadRow
          lead={{ ...lead, phone } as unknown as Lead}
          visibleCols={["phone"]}
          onOpen={vi.fn()}
        />
      </tbody></table>,
    );

  it("formats the stored E.164 number the way every other surface does", () => {
    // The column rendered lead.phone raw, so the list showed "+15105550199" while the customer
    // sheet, the job sheet and the thread header all showed "(510) 555-0199".
    withPhone("+15105550199");
    expect(screen.getByText("(510) 555-0199")).toBeTruthy();
  });

  it("leaves an unparseable number alone rather than mangling it", () => {
    withPhone("ext. 4021");
    expect(screen.getByText("ext. 4021")).toBeTruthy();
  });

  it("still shows the em dash when there is no number", () => {
    withPhone("");
    expect(screen.getByText("—")).toBeTruthy();
  });
});
