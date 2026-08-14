// @vitest-environment jsdom
/**
 * features/jobs/checklist-steps-editor.test.tsx
 *
 * The one checklist editor. The Checklists library had a proper one — name, ordered steps, each a
 * Check or a Photo, add and remove — while the job sheet asked for "One item per line" in a
 * textarea, which could not express a photo step at all and silently made every line required.
 * Same editor in both places now.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChecklistStepsEditor, newDraftStep, type DraftItem } from "./checklist-steps-editor";

const onName = vi.fn();
const onItems = vi.fn();

const setup = (items: DraftItem[] = []) =>
  render(
    <ChecklistStepsEditor name="Water heater close-out" onName={onName} items={items} onItems={onItems} />,
  );

describe("ChecklistStepsEditor", () => {
  beforeEach(() => {
    onName.mockClear();
    onItems.mockClear();
  });

  it("edits the checklist name", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: "Drain cleaning" } });
    expect(onName).toHaveBeenCalledWith("Drain cleaning");
  });

  it("adds a step", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    expect(onItems).toHaveBeenCalledWith([expect.objectContaining({ text: "", type: "check" })]);
  });

  it("shows no Steps label until there is a step", () => {
    setup();
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("edits a step's text", () => {
    setup([{ id: "s1", text: "", type: "check" }]);
    fireEvent.change(screen.getByLabelText("Step 1 description"), { target: { value: "Water back on" } });
    expect(onItems).toHaveBeenCalledWith([{ id: "s1", text: "Water back on", type: "check" }]);
  });

  it("turns a step into a photo step — the thing the textarea could never express", () => {
    setup([{ id: "s1", text: "Photo of the T&P valve", type: "check" }]);
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    expect(onItems).toHaveBeenCalledWith([
      { id: "s1", text: "Photo of the T&P valve", type: "photo" },
    ]);
  });

  it("removes a step", () => {
    setup([
      { id: "s1", text: "one", type: "check" },
      { id: "s2", text: "two", type: "check" },
    ]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove step" })[0]!);
    expect(onItems).toHaveBeenCalledWith([{ id: "s2", text: "two", type: "check" }]);
  });

  it("numbers each step so the rows name themselves", () => {
    setup([
      { id: "s1", text: "one", type: "check" },
      { id: "s2", text: "two", type: "check" },
    ]);
    expect(screen.getByLabelText("Step 1 description")).toBeTruthy();
    expect(screen.getByLabelText("Step 2 description")).toBeTruthy();
  });
});

describe("newDraftStep", () => {
  it("mints a blank check step with its own id", () => {
    const a = newDraftStep();
    const b = newDraftStep();
    expect(a).toMatchObject({ text: "", type: "check" });
    expect(a.id).not.toBe(b.id);
  });
});
