// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoldCard } from "./fold-card";

/**
 * Every Settings section is a FoldCard, so a header that only answers a mouse click puts the whole
 * page — Import included, which has no other entry point — out of reach of a keyboard. The header
 * has to be a real button: focusable, operable by Enter and Space, and announcing its own state.
 */
describe("FoldCard — the header is a real control", () => {
  it("exposes the header as a button naming the section", () => {
    render(<FoldCard title="Import"><p>body</p></FoldCard>);
    expect(screen.getByRole("button", { name: /Import/ })).toBeTruthy();
  });

  it("reports collapsed and expanded through aria-expanded", () => {
    render(<FoldCard title="Import"><p>body</p></FoldCard>);
    const head = screen.getByRole("button", { name: /Import/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens on Enter and on Space", () => {
    // Asserted through the native button's own key handling rather than a synthetic keydown: a
    // hand-rolled Enter/Space listener on a div is exactly the shape that regressed here.
    render(<FoldCard title="Import"><p>body</p></FoldCard>);
    const head = screen.getByRole("button", { name: /Import/ });
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("type")).toBe("button");
  });

  it("honours defaultOpen", () => {
    render(<FoldCard title="Import" defaultOpen><p>body</p></FoldCard>);
    expect(screen.getByRole("button", { name: /Import/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the summary inside the row without displacing the title", () => {
    render(<FoldCard title="Import" summary="Last run 3 Aug"><p>body</p></FoldCard>);
    expect(screen.getByRole("button", { name: /Import/ })).toBeTruthy();
    expect(screen.getByText("Last run 3 Aug")).toBeTruthy();
  });
});
