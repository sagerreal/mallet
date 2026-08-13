// @vitest-environment jsdom
/**
 * features/a2p/sms-blocked.test.tsx
 *
 * THE ONE TRAP OF `aria-disabled`. It is the right attribute here — a control carrying the real
 * `disabled` attribute is unfocusable and announced as nothing at all, so a screen-reader user
 * meets silence where a sighted user reads a reason. But `aria-disabled` is a LABEL, not a
 * behaviour: the browser still fires the click. Pairing the two is the whole point of
 * `smsBlockProps`, and this file is what stops them being separated.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SmsNote, smsBlockProps } from "./sms-blocked";
import type { SmsGate } from "./use-sms-ready";

const gate = (over: Partial<SmsGate> = {}): SmsGate => ({
  ready: false, state: "not_started", note: "Texting isn't set up yet.",
  detail: "…", action: { label: "Set up texting", href: "/settings#texting" }, ...over,
});
const open: SmsGate = { ready: true, state: "active", note: null, detail: null, action: null };

describe("smsBlockProps", () => {
  it("marks the control unavailable without removing it from the tab order", () => {
    const props = smsBlockProps(gate(), vi.fn());
    expect(props["aria-disabled"]).toBe(true);
    expect("disabled" in props).toBe(false);
  });

  it("swallows the click, so aria-disabled is not merely decorative", () => {
    const onActivate = vi.fn();
    render(<button type="button" {...smsBlockProps(gate(), onActivate)}>Send text</button>);
    fireEvent.click(screen.getByRole("button", { name: "Send text" }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does not let the click reach a clickable row behind it", () => {
    // Every send control in the app sits inside something that opens on click. A blocked Send
    // that still bubbles would open the record instead — a different action than the one asked for.
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <button type="button" {...smsBlockProps(gate(), vi.fn())}>Send text</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send text" }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it("passes the click straight through once texting works", () => {
    const onActivate = vi.fn();
    render(<button type="button" {...smsBlockProps(open, onActivate)}>Send text</button>);
    fireEvent.click(screen.getByRole("button", { name: "Send text" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("leaves aria-disabled off entirely when ready, rather than setting it false", () => {
    // aria-disabled="false" is a claim in the accessibility tree where silence is correct.
    expect(smsBlockProps(open, vi.fn())["aria-disabled"]).toBeUndefined();
  });
});

describe("SmsNote", () => {
  it("renders the gate's one clause", () => {
    render(<SmsNote gate={gate()} />);
    expect(screen.getByText("Texting isn't set up yet.")).toBeTruthy();
  });

  it("renders nothing at all when texting works", () => {
    const { container } = render(<SmsNote gate={open} />);
    expect(container.innerHTML).toBe("");
  });

  it("carries no link — the account banner owns the call to action", () => {
    // Repeating "Set up texting" at six controls is the noise this design moved away from.
    render(<SmsNote gate={gate()} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is announced when it appears, so a blocked control explains itself to a screen reader", () => {
    render(<SmsNote gate={gate()} />);
    expect(screen.getByText("Texting isn't set up yet.").getAttribute("role")).toBe("status");
  });
});
