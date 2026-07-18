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

function setup(over: Partial<Task> = {}) {
  const onToggle = vi.fn();
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onOpenLead = vi.fn();
  render(
    <EditableTaskRow
      task={makeTask(over)}
      leads={leads}
      onToggle={onToggle}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onOpenLead={onOpenLead}
    />,
  );
  return { onToggle, onUpdate, onRemove, onOpenLead };
}

describe("EditableTaskRow", () => {
  it("clicking the attached customer opens that customer — it does NOT open the editor", () => {
    const { onOpenLead } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onOpenLead).toHaveBeenCalledWith("L1");
    expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
  });

  it("clicking the task text opens the inline editor (text, due, customer)", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.getByLabelText("Attached customer")).toBeTruthy();
  });

  it("saving sends ONLY the changed fields (text + reassigned customer)", () => {
    const { onUpdate } = setup({ due: "2026-07-20", leadId: "L1" });
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Call client back" } });
    fireEvent.change(screen.getByLabelText("Attached customer"), { target: { value: "L2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("t1", { t: "Call client back", leadId: "L2" });
  });

  it("detaching the customer sends leadId ''", () => {
    const { onUpdate } = setup({ leadId: "L1" });
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    fireEvent.change(screen.getByLabelText("Attached customer"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("t1", { leadId: "" });
  });

  it("Delete removes the task", () => {
    const { onRemove } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemove).toHaveBeenCalledWith("t1");
  });

  it("Cancel closes the editor without saving", () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit task: Call client" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
  });

  it("the check toggles done", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark task done" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
  });
});
