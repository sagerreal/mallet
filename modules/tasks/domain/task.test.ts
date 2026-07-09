import { describe, it, expect } from "vitest";
import { asTaskId, asOrgId, isOk } from "@mallet/shared/types";
import { Task, type TaskProps } from "./task";

const baseProps = (overrides: Partial<TaskProps> = {}): TaskProps => ({
  id: asTaskId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  leadId: null,
  text: "Call the customer",
  dueDate: "2026-07-10",
  done: false,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Task.create>): Task => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Task.create", () => {
  it("rejects an empty text", () => {
    const r = Task.create(baseProps({ text: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("text");
    }
  });

  it("trims the text", () => {
    const task = unwrap(Task.create(baseProps({ text: "  Do the thing  " })));
    expect(task.props.text).toBe("Do the thing");
  });

  it("accepts a null leadId", () => {
    const task = unwrap(Task.create(baseProps({ leadId: null })));
    expect(task.props.leadId).toBeNull();
  });

  it("accepts a null dueDate", () => {
    const task = unwrap(Task.create(baseProps({ dueDate: null })));
    expect(task.props.dueDate).toBeNull();
  });
});

describe("Task.setDone", () => {
  const now = new Date("2026-07-10T10:00:00Z");

  it("sets done to true and bumps updatedAt", () => {
    const task = unwrap(Task.create(baseProps({ done: false })));
    const updated = task.setDone(true, now);
    expect(updated.props.done).toBe(true);
    expect(updated.props.updatedAt.toISOString()).toBe(now.toISOString());
    // Immutability: original unchanged
    expect(task.props.done).toBe(false);
  });

  it("is a no-op when the value is already the same (returns same instance)", () => {
    const task = unwrap(Task.create(baseProps({ done: false })));
    const same = task.setDone(false, now);
    expect(same).toBe(task);
  });

  it("sets done to false and bumps updatedAt", () => {
    const task = unwrap(Task.create(baseProps({ done: true })));
    const updated = task.setDone(false, now);
    expect(updated.props.done).toBe(false);
    expect(updated.props.updatedAt.toISOString()).toBe(now.toISOString());
  });
});

describe("Task.patch", () => {
  const now = new Date("2026-07-10T12:00:00Z");

  it("patches text and bumps updatedAt", () => {
    const task = unwrap(Task.create(baseProps({ text: "old text" })));
    const result = task.patch({ text: "new text" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.text).toBe("new text");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
      // Immutability: original unchanged
      expect(task.props.text).toBe("old text");
    }
  });

  it("rejects empty text via patch", () => {
    const task = unwrap(Task.create(baseProps()));
    const result = task.patch({ text: "  " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("patches dueDate to null", () => {
    const task = unwrap(Task.create(baseProps({ dueDate: "2026-07-10" })));
    const result = task.patch({ dueDate: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.dueDate).toBeNull();
    }
  });

  it("patches dueDate to a new value", () => {
    const task = unwrap(Task.create(baseProps({ dueDate: "2026-07-10" })));
    const result = task.patch({ dueDate: "2026-08-01" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.dueDate).toBe("2026-08-01");
    }
  });

  it("empty patch keeps all props (except updatedAt bumped)", () => {
    const task = unwrap(Task.create(baseProps()));
    const result = task.patch({}, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.text).toBe(task.props.text);
      expect(result.value.props.dueDate).toBe(task.props.dueDate);
      expect(result.value.props.leadId).toBe(task.props.leadId);
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });
});
