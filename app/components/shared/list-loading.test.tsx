// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListLoading } from "./list-loading";

describe("ListLoading — the cold-load state", () => {
  it("renders an aria-busy status region (skeleton) so assistive tech announces the wait", () => {
    render(<ListLoading />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    // The label is present (visually hidden) so the wait is announced.
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
  it("accepts a custom label", () => {
    render(<ListLoading label="Loading jobs…" />);
    expect(screen.getByText("Loading jobs…")).toBeTruthy();
  });
});
