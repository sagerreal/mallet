// @vitest-environment jsdom
/**
 * components/modals/editable-sheet-title.test.tsx
 *
 * The sheet heading IS the name field. A record's name had two homes on the job sheet — an h2 at
 * the top and a "Job" row further down that held the same string — so renaming meant scrolling
 * past the name to find a row that edits it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditableSheetTitle } from "./editable-sheet-title";

const onCommit = vi.fn();
const setup = (over: Partial<React.ComponentProps<typeof EditableSheetTitle>> = {}) =>
  render(
    <EditableSheetTitle
      value="Drain clearing — kitchen"
      display="Drain clearing — kitchen"
      onCommit={onCommit}
      label="Job name"
      {...over}
    />,
  );

describe("EditableSheetTitle", () => {
  beforeEach(() => onCommit.mockClear());

  it("renders as a heading until you ask to change it", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Drain clearing/ })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("becomes an input when the heading is clicked", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Drain clearing — kitchen");
  });

  it("commits the trimmed name on blur", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Drain clearing — bath  " } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledWith("Drain clearing — bath");
  });

  it("commits nothing when the name did not change", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed then regretted" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Drain clearing/ })).toBeTruthy();
  });

  it("shows a stand-in when the record has no name of its own, and edits the real value", () => {
    // An untitled job's heading falls back to the customer's name, but the field being edited is
    // still the job's own (empty) title — not the customer's.
    setup({ value: "", display: "Roy Novak", placeholder: "Name this job" });

    expect(screen.getByRole("heading", { name: /Roy Novak/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByPlaceholderText("Name this job")).toBeTruthy();
  });

  it("puts the displayed name back when a caller refuses an empty rename", () => {
    // The customer sheet ignores a blank name. Without a reset the input would sit empty over a
    // record that still has its old name.
    const { rerender } = setup({ value: "Roy Novak", display: "Roy Novak" });
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.blur(screen.getByRole("textbox"));

    rerender(
      <EditableSheetTitle value="Roy Novak" display="Roy Novak" onCommit={onCommit} label="Customer name" />,
    );
    expect(screen.getByRole("heading", { name: /Roy Novak/ })).toBeTruthy();
  });
});
