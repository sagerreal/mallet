// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPreviewStep } from "./import-preview-step";
import type { BuildResult } from "@/lib/import/engine/descriptor";

const build = (over: Partial<BuildResult> = {}): BuildResult => ({
  rows: [{ name: "Ann" }, { name: "Bob" }],
  skipped: [],
  warnings: [],
  ...over,
});

const setup = (built: BuildResult, over: Partial<Parameters<typeof ImportPreviewStep>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onBack = vi.fn();
  render(
    <ImportPreviewStep
      built={built}
      skipReason="no name"
      importLabel={(n) => `Import ${n} customers`}
      resumeFrom={0}
      busy={false}
      error={null}
      onBack={onBack}
      onConfirm={onConfirm}
      {...over}
    />,
  );
  return { onConfirm, onBack };
};

describe("ImportPreviewStep", () => {
  it("says nothing has been saved yet, so the step reads as a decision point", () => {
    setup(build());
    expect(screen.getByText(/nothing has been saved yet/i)).toBeTruthy();
  });

  it("counts what will import", () => {
    setup(build());
    expect(screen.getByText("2 will import")).toBeTruthy();
  });

  it("names skipped rows by spreadsheet row number, not array index", () => {
    // rowIndex 0 is the first DATA row, which is line 2 of the file once the header is counted.
    setup(build({ skipped: [{ rowIndex: 0, kind: "skipped", message: "No name — row skipped." }] }));

    expect(screen.getByText(/No name — row skipped\./)).toBeTruthy();
    expect(screen.getByText("(row 2)")).toBeTruthy();
  });

  it("groups repeated issues instead of listing every row", () => {
    const warnings = [0, 1, 2].map((rowIndex) => ({
      rowIndex, kind: "warning" as const, message: 'Couldn’t read phone "555" — imported without it.',
    }));
    setup(build({ warnings }));

    // One line for the group, not three.
    expect(screen.getAllByText(/Couldn’t read phone/)).toHaveLength(1);
    expect(screen.getByText("(rows 2, 3, 4)")).toBeTruthy();
  });

  it("truncates a long row list rather than filling the sheet", () => {
    const warnings = Array.from({ length: 12 }, (_, rowIndex) => ({
      rowIndex, kind: "warning" as const, message: "Couldn't read email — imported without it.",
    }));
    setup(build({ warnings }));

    expect(screen.getByText("(rows 2, 3, 4 and 9 more)")).toBeTruthy();
  });

  it("separates rows that will be dropped from rows that merely lose a field", () => {
    setup(
      build({
        skipped: [{ rowIndex: 0, kind: "skipped", message: "No name — row skipped." }],
        warnings: [{ rowIndex: 1, kind: "warning", message: "Couldn't read phone — imported without it." }],
      }),
    );

    expect(screen.getByText(/won't be imported/i)).toBeTruthy();
    expect(screen.getByText(/without the field we couldn't read/i)).toBeTruthy();
  });

  it("hides an issue section entirely when there is nothing in it", () => {
    setup(build());
    expect(screen.queryByText(/won't be imported/i)).toBeNull();
    expect(screen.queryByText(/without the field/i)).toBeNull();
  });

  it("commits only when confirmed", async () => {
    const { onConfirm } = setup(build());
    await userEvent.click(screen.getByRole("button", { name: /import 2 customers/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("goes back to the mapping without importing", async () => {
    const { onBack, onConfirm } = setup(build());
    await userEvent.click(screen.getByRole("button", { name: /change the mapping/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("blocks the import and says why when every row was skipped", () => {
    setup(build({ rows: [], skipped: [{ rowIndex: 0, kind: "skipped", message: "No name — row skipped." }] }));

    expect(screen.getByText(/every row is missing something required/i)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: /import 0 customers/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("offers to resume, not restart, after a partial failure", () => {
    setup(build(), { resumeFrom: 1 });
    expect(screen.getByRole("button", { name: /resume — 1 left/i })).toBeTruthy();
  });

  it("surfaces an error from a failed attempt", () => {
    setup(build(), { error: "Import stopped partway." });
    expect(screen.getByText("Import stopped partway.")).toBeTruthy();
  });

  describe("re-import", () => {
    it("splits new from overwriting instead of one lumped count", () => {
      setup(build({ rows: [{ name: "A" }, { name: "B" }, { name: "C" }] }), { willUpdate: 2 });

      expect(screen.getByText("1 new")).toBeTruthy();
      expect(screen.getByText("2 will be updated")).toBeTruthy();
      // The lumped label must NOT also appear, or the numbers read as contradictory.
      expect(screen.queryByText("3 will import")).toBeNull();
    });

    it("says what an overwrite actually touches, so it isn't a surprise", () => {
      setup(build(), { willUpdate: 2 });
      expect(screen.getByText(/only the columns in your file change/i)).toBeTruthy();
    });

    it("keeps the single count when nothing will be overwritten", () => {
      setup(build(), { willUpdate: 0 });

      expect(screen.getByText("2 will import")).toBeTruthy();
      expect(screen.queryByText(/will be updated/i)).toBeNull();
    });

    it("stays silent about updates for a create-only entity", () => {
      setup(build()); // willUpdate omitted
      expect(screen.getByText("2 will import")).toBeTruthy();
      expect(screen.queryByText(/will be updated/i)).toBeNull();
    });
  });
});
