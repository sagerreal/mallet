// @vitest-environment jsdom
/**
 * lib/phone.test.tsx
 * PhoneGate is the ONE tappable phone-gate. It must:
 *   - run the action immediately when a phone is on file (passing the on-file number);
 *   - stay tappable with no phone, expanding an in-flow add-number row on tap;
 *   - on save, persist via onSavePhone AND auto-proceed with the FRESH number
 *     (never race the store);
 *   - render a read-only note (no add row) when canAddPhone is false.
 *
 * The pure hasPhone helper is covered in lib/phone.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneGate } from "./phone";

function renderGate(props: Partial<React.ComponentProps<typeof PhoneGate>> = {}) {
  const onAction = vi.fn();
  const onSavePhone = vi.fn();
  render(
    <PhoneGate
      bearer={props.bearer ?? { phone: "" }}
      addLabel="No phone number yet"
      onAction={onAction}
      onSavePhone={onSavePhone}
      {...props}
    >
      {({ onClick }) => (
        <button onClick={onClick}>Call</button>
      )}
    </PhoneGate>,
  );
  return { onAction, onSavePhone };
}

describe("PhoneGate", () => {
  it("runs the action with the on-file number when a phone exists — no add row", () => {
    const { onAction, onSavePhone } = renderGate({ bearer: { phone: "555-0101" } });
    fireEvent.click(screen.getByText("Call"));
    expect(onAction).toHaveBeenCalledWith("555-0101");
    expect(onSavePhone).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("No phone number yet")).toBeNull();
  });

  it("stays tappable with no phone and expands the in-flow add-number row", () => {
    renderGate({ bearer: { phone: "" } });
    const btn = screen.getByText("Call") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(screen.getByLabelText("No phone number yet")).toBeTruthy();
  });

  it("saves the fresh number and auto-proceeds with it (no store race)", () => {
    const { onAction, onSavePhone } = renderGate({ bearer: { phone: "" } });
    fireEvent.click(screen.getByText("Call"));
    const input = screen.getByLabelText("No phone number yet");
    fireEvent.change(input, { target: { value: "(925) 555-0100" } });
    fireEvent.click(screen.getByText(/^Save/));
    // Persisted AND proceeded with the FRESH number the user just typed.
    expect(onSavePhone).toHaveBeenCalledWith("(925) 555-0100");
    expect(onAction).toHaveBeenCalledWith("(925) 555-0100");
    // The row collapses after a successful save.
    expect(screen.queryByLabelText("No phone number yet")).toBeNull();
  });

  it("rejects an invalid number inline without saving or proceeding", () => {
    const { onAction, onSavePhone } = renderGate({ bearer: { phone: "" } });
    fireEvent.click(screen.getByText("Call"));
    fireEvent.change(screen.getByLabelText("No phone number yet"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByText(/^Save/));
    expect(screen.getByText(/doesn't look right/i)).toBeTruthy();
    expect(onSavePhone).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("canAddPhone=false renders a read-only note instead of an add row", () => {
    const { onAction, onSavePhone } = renderGate({ bearer: { phone: "" }, canAddPhone: false });
    fireEvent.click(screen.getByText("Call"));
    expect(screen.getByText(/No number on file — ask the office/i)).toBeTruthy();
    expect(screen.queryByLabelText("No phone number yet")).toBeNull();
    expect(onSavePhone).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});
