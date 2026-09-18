// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectMenu } from "./select-menu";

const TRADES = [
  { value: "plumbing", label: "Plumbing" },
  { value: "garage", label: "Garage door" },
  { value: "electrical", label: "Electrical" },
  { value: "hvac", label: "HVAC", disabled: true },
  { value: "septic", label: "Septic" },
];

const setup = (over: Partial<React.ComponentProps<typeof SelectMenu>> = {}) => {
  const onChange = vi.fn();
  render(<SelectMenu value="plumbing" onChange={onChange} options={TRADES} aria-label="Your trade" {...over} />);
  return { onChange, trigger: screen.getByRole("button", { name: /your trade/i }) };
};

describe("SelectMenu", () => {
  it("shows the selected option's label, not its value", () => {
    setup({ value: "garage" });
    expect(screen.getByRole("button").textContent).toContain("Garage door");
  });

  it("shows the placeholder when the value matches nothing", () => {
    setup({ value: "", placeholder: "Pick a trade" });
    expect(screen.getByRole("button").textContent).toContain("Pick a trade");
  });

  it("opens on click and exposes a listbox", () => {
    const { trigger } = setup();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("commits the clicked option", () => {
    const { onChange, trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("option", { name: /garage door/i }));
    expect(onChange).toHaveBeenCalledWith("garage");
  });

  // --- keyboard parity with a native select. A replacement that cannot be driven from the
  // keyboard is a downgrade wearing a polish pass. ---

  it("opens with ArrowDown and commits with Enter", () => {
    const { onChange, trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("garage");
  });

  it("SKIPS a disabled option when arrowing", () => {
    // Landing on a disabled row and refusing to commit reads as a frozen menu.
    const { onChange, trigger } = setup({ value: "electrical" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // opens on Electrical
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // HVAC is disabled → skip to Septic
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("septic");
  });

  it("never commits a disabled option on click", () => {
    const { onChange, trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("option", { name: /hvac/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape cancels without committing what was arrowed past", () => {
    const { onChange, trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Home and End jump to the first and last enabled options", () => {
    const { onChange, trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("septic");
  });

  it("type-ahead jumps to the option starting with what you typed", () => {
    // The behaviour people use without noticing until it is gone.
    const { onChange, trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "g" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("garage");
  });

  it("Tab closes the menu and does not swallow the keypress", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const ev = fireEvent.keyDown(trigger, { key: "Tab" });
    // fireEvent returns false when preventDefault was called — Tab must stay usable for focus.
    expect(ev).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does nothing at all when disabled", () => {
    const { onChange, trigger } = setup({ disabled: true });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the current value as selected for a screen reader", () => {
    const { trigger } = setup({ value: "garage" });
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /garage door/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: /plumbing/i }).getAttribute("aria-selected")).toBe("false");
  });
});
