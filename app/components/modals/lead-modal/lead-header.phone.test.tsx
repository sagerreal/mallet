// @vitest-environment jsdom
/**
 * The inline phone field lost typed input whenever anything re-rendered the header — and because
 * switching to another window does not move focus inside the document, its blur handler never fired
 * either. Owen typed a number, switched away, came back, and it was gone with no error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const updateLead = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ updateLead, leads: [] }),
  useOpenModal: () => vi.fn(),
  useCloseModal: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { PhoneCell } = await import("./lead-header");

beforeEach(() => updateLead.mockClear());

const field = () => screen.getByLabelText("Customer phone") as HTMLInputElement;

describe("the inline phone field", () => {
  it("keeps what was typed across a re-render", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<PhoneCell value="" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "7813850591" } });
    // Something else re-renders the header — a reconcile, a store write elsewhere.
    rerender(<PhoneCell value="" onCommit={onCommit} />);
    expect(field().value).toBe("7813850591");
  });

  it("saves on blur", () => {
    const onCommit = vi.fn();
    render(<PhoneCell value="" onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: "7813850591" } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith("7813850591");
  });

  /**
   * The quieter bug: the old handler fired on EVERY blur, so tabbing through the field wrote an
   * empty string and wiped a number nobody had touched.
   */
  it("writes nothing when the value did not change", () => {
    const onCommit = vi.fn();
    render(<PhoneCell value="+17813850591" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on Enter without needing a click away", () => {
    const onCommit = vi.fn();
    render(<PhoneCell value="" onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: "7813850591" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("7813850591");
  });

  it("adopts a number changed elsewhere while not focused", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<PhoneCell value="" onCommit={onCommit} />);
    rerender(<PhoneCell value="+17813850591" onCommit={onCommit} />);
    expect(field().value).toBe("+17813850591");
  });

  // Never yank the number out from under someone mid-edit.
  it("does not adopt an outside change while focused", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<PhoneCell value="" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "555" } });
    rerender(<PhoneCell value="+19999999999" onCommit={onCommit} />);
    expect(field().value).toBe("555");
  });
});
