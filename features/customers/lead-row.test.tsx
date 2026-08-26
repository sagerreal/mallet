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

/**
 * The Tags cell. It replaced the single-value Source pill, which had become unreachable anyway
 * (the column picker is gone and `source` was not in DEFAULT_COLS).
 */
describe("LeadRow — the Tags cell", () => {
  const rowWithTags = (tags: string[] | undefined) => {
    const l = { ...lead, tags } as unknown as Lead;
    render(
      <table><tbody>
        <LeadRow lead={l} visibleCols={["tags"]} onOpen={vi.fn()} />
      </tbody></table>,
    );
  };

  it("renders one pill per tag", () => {
    rowWithTags(["Google", "Repeat customer"]);
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Repeat customer")).toBeTruthy();
  });

  it("keeps the chosen order", () => {
    rowWithTags(["Yelp", "Angi"]);
    const pills = Array.from(document.querySelectorAll(".pill.src")).map((n) => n.textContent);
    expect(pills).toEqual(["Yelp", "Angi"]);
  });

  /** An empty pill would read as a tag whose name failed to load. */
  it("shows the table's em-dash for an untagged customer, not an empty pill", () => {
    rowWithTags([]);
    expect(screen.getByText("—")).toBeTruthy();
    expect(document.querySelector(".pill.src")).toBeNull();
  });

  /** Defensive: a store row hydrated by an older path may predate the field. */
  it("survives a lead with no tags field at all", () => {
    rowWithTags(undefined);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
