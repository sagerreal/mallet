// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Lead, Task } from "@/lib/store/types";
import { EditableTaskRow } from "./editable-task-row";

const leads = [
  { id: "L1", name: "Ada Lovelace" },
  { id: "L2", name: "Grace Hopper" },
] as unknown as Lead[];

const makeTask = (over: Partial<Task> = {}): Task =>
  ({ id: "t1", t: "Call client", due: null, leadId: "L1", done: false, ...over } as Task);

function setup(over: Partial<Task> = {}, editing = false) {
  const handlers = {
    onToggle: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onOpenLead: vi.fn(),
    onStartEdit: vi.fn(),
    onStopEdit: vi.fn(),
  };
  render(<EditableTaskRow task={makeTask(over)} leads={leads} editing={editing} {...handlers} />);
  return handlers;
}

describe("EditableTaskRow — resting row", () => {
  it("has a visible edit (pencil) control and clicking it starts editing", () => {
    const { onStartEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it("clicking the task text also starts editing", () => {
    const { onStartEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it("clicking the attached customer opens that customer (not the editor)", () => {
    const { onOpenLead, onStartEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onOpenLead).toHaveBeenCalledWith("L1");
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("the check toggles done", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark task done" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
  });

  it("does not render the editor while resting", () => {
    setup();
    expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
  });
});

describe("EditableTaskRow — editing", () => {
  it("renders labeled Task, Due date, and Customer fields", () => {
    setup({}, true);
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.getByLabelText("Attached customer")).toBeTruthy();
  });

  it("Save sends ONLY the changed fields and closes the editor", () => {
    const { onUpdate, onStopEdit } = setup({ due: "2026-07-20", leadId: "L1" }, true);
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Call client back" } });
    fireEvent.change(screen.getByLabelText("Attached customer"), { target: { value: "L2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("t1", { t: "Call client back", leadId: "L2" });
    expect(onStopEdit).toHaveBeenCalledTimes(1);
  });

  it("detaching the customer sends leadId ''", () => {
    const { onUpdate } = setup({ leadId: "L1" }, true);
    fireEvent.change(screen.getByLabelText("Attached customer"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("t1", { leadId: "" });
  });

  it("Delete removes the task and closes the editor", () => {
    const { onRemove, onStopEdit } = setup({}, true);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemove).toHaveBeenCalledWith("t1");
    expect(onStopEdit).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes the editor without saving", () => {
    const { onUpdate, onStopEdit } = setup({}, true);
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onStopEdit).toHaveBeenCalledTimes(1);
  });
});
