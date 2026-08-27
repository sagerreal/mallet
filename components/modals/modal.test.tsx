// @vitest-environment jsdom
/**
 * The dialog shell's close contract — specifically, what counts as a backdrop click.
 *
 * THE BUG THESE PIN. A `click` event fires on the nearest common ancestor of where the press went
 * down and where it came up. So dragging across a field to select its text and releasing a few
 * pixels past the panel edge — the ordinary way anyone highlights an address to retype it — landed
 * a click whose `target` WAS the overlay, and the sheet closed with the typing lost. The release
 * position is not evidence of intent on its own; only the press origin is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./modal";

const onClose = vi.fn();

const open = () =>
  render(
    <Modal open onClose={onClose} label="Test dialog">
      <h2>Sheet</h2>
      <input aria-label="Some field" defaultValue="388 Beale St" />
    </Modal>,
  );

const overlay = () => document.querySelector(".overlay") as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe("closing on the backdrop", () => {
  it("closes when the press starts AND ends on the backdrop", () => {
    open();
    fireEvent.pointerDown(overlay());
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledOnce();
  });

  /** THE ONE THAT MATTERS: a selection drag that overshoots the panel must not close the sheet. */
  it("does NOT close when the press started inside the panel and ended on the backdrop", () => {
    open();
    fireEvent.pointerDown(screen.getByLabelText("Some field"));
    // The browser dispatches the click on the common ancestor — the overlay itself.
    fireEvent.click(overlay());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a click inside the panel", () => {
    open();
    const field = screen.getByLabelText("Some field");
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * The flag must not survive the click it belonged to. Left armed, the NEXT release over the
   * backdrop would close on stale state — turning the fix into an intermittent version of the bug.
   */
  it("does not carry the press origin over to a later click", () => {
    open();
    fireEvent.pointerDown(overlay());
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledOnce();

    // A second interaction that begins inside the panel must be judged on its own.
    fireEvent.pointerDown(screen.getByLabelText("Some field"));
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("still closes from the ✕ regardless of where anything was pressed", () => {
    open();
    fireEvent.pointerDown(screen.getByLabelText("Some field"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("still closes on Escape", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
