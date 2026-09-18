// @vitest-environment jsdom
/**
 * app/(office)/composer/line-features.test.tsx
 *
 * The mock's remaining line features: the SIMPLE inspector (a hand-typed line edits its money
 * in the row, so the rail carries the qualitative facts), line type, duplicate, and the
 * attachments carry into the payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LineTable } from "./line-table";
import type { ComposerLine } from "./composer-state";
import { lineToPayload } from "./sub-items";

vi.mock("@/lib/store/upload-proposal-photo", () => ({
  uploadProposalPhoto: vi.fn(async () => "orgs/o1/proposal/abc.jpg"),
}));

const onLines = vi.fn();
beforeEach(() => {
  onLines.mockClear();
  cleanup();
});

const table = (lines: ComposerLine[]) =>
  render(<LineTable lines={lines} sections={[]} showCost={false} onLines={onLines} />);
const rail = () => screen.getByTestId("line-inspector");
const last = (): ComposerLine[] => onLines.mock.calls.at(-1)![0];
const select = (label: string) => fireEvent.click(screen.getByLabelText(label));

describe("the simple inspector", () => {
  it("carries no math rows for a hand-typed line — the row owns its money", () => {
    table([{ d: "Haul-away", q: 1, r: 240 }]);
    select("Description, line 1");
    expect(within(rail()).queryByText("Quantity")).toBeNull();
    expect(within(rail()).queryByText("Unit price")).toBeNull();
    expect(within(rail()).getByText("Scope")).toBeTruthy();
    expect(within(rail()).getByText("Attachments")).toBeTruthy();
    expect(within(rail()).getByText("On customer copy")).toBeTruthy();
  });

  it("keeps the math rows on a costed or expression-built line", () => {
    table([{ d: "Tear out", q: 100, r: 4.5, c: 2.1, unit: "LF" }]);
    select("Description, line 1");
    expect(within(rail()).getByText("Quantity")).toBeTruthy();
    expect(within(rail()).getByText("Margin")).toBeTruthy();
    expect(within(rail()).getByText("Attachments")).toBeTruthy();
  });
});

describe("line type", () => {
  it("tags the line from More details, and untags it", () => {
    table([{ d: "Line posts", q: 14, r: 24.3 }]);
    select("Description, line 1");
    fireEvent.click(within(rail()).getByText("More details").closest("button")!);
    fireEvent.change(within(rail()).getByLabelText("Line type"), { target: { value: "material" } });
    expect(last()[0]?.ltype).toBe("material");
    fireEvent.change(within(rail()).getByLabelText("Line type"), { target: { value: "" } });
    expect(last()[0]?.ltype).toBeUndefined();
  });
});

describe("duplicate", () => {
  it("copies a plain line right after itself", () => {
    table([{ d: "Walk gate", q: 1, r: 425 }, { d: "Stain", q: 100, r: 3.25 }]);
    select("Description, line 1");
    fireEvent.click(screen.getByText("More details").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate line" }));
    const next = last();
    expect(next.map((l) => l.d)).toEqual(["Walk gate", "Walk gate", "Stain"]);
  });

  it("copies an assembly WITH its parts, indexes remapped — never sharing money", () => {
    table([
      { d: "Fence", q: 100, r: 3.28, unit: "LF" },
      { d: "Line posts", q: 13.5, r: 24.3, qtyExpr: "qty/8+1", parentIndex: 0 },
      { d: "After", q: 1, r: 100 },
    ]);
    select("Description, line 1");
    fireEvent.click(screen.getByText("More details").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate line" }));
    const next = last();
    expect(next.map((l) => l.d)).toEqual(["Fence", "Line posts", "Fence", "Line posts", "After"]);
    expect(next[3]?.parentIndex).toBe(2);
    expect(next[1]?.parentIndex).toBe(0);
  });
});

describe("attachments in the payload", () => {
  it("carries type and attachments onto the wire, and omits them when empty", () => {
    const line: ComposerLine = {
      d: "Panel swap",
      q: 1,
      r: 1800,
      ltype: "labor",
      att: [{ key: "orgs/o1/proposal/abc.jpg", name: "panel.jpg" }],
    };
    const wire = lineToPayload(line);
    expect(wire.lineType).toBe("labor");
    expect(wire.attachments).toEqual([{ key: "orgs/o1/proposal/abc.jpg", name: "panel.jpg" }]);
    const bare = lineToPayload({ d: "Haul-away", q: 1, r: 240 });
    expect("lineType" in bare).toBe(false);
    expect("attachments" in bare).toBe(false);
  });
});
