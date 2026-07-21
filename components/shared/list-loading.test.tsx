// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListLoading } from "./list-loading";

describe("ListLoading — the cold-load state", () => {
  it("renders an aria-busy region so assistive tech announces the wait", () => {
    render(<ListLoading />);
    const el = screen.getByText("Loading…");
    expect(el.getAttribute("aria-busy")).toBe("true");
  });
  it("accepts a custom label", () => {
    render(<ListLoading label="Loading jobs…" />);
    expect(screen.getByText("Loading jobs…")).toBeTruthy();
  });
});
