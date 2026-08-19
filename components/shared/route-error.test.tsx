// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteError } from "./route-error";

/**
 * The route crash screen. Two contracts: every crash is LOGGED (the boundary used to swallow the
 * error whole, so "Something went wrong" reports were undiagnosable), and a stale-deploy chunk
 * failure reloads itself ONCE — the fix for that state is the new build, not a Try again button.
 */
describe("RouteError", () => {
  const reload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, "location", { value: { reload }, writable: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the message, logs the error, offers Try again", () => {
    const reset = vi.fn();
    const boom = new Error("boom");
    render(<RouteError error={boom} reset={reset} />);
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(boom);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a stale-deploy chunk failure reloads the page — once", () => {
    const e = new Error("Loading chunk 4821 failed.");
    e.name = "ChunkLoadError";
    render(<RouteError error={e} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never loops: the second stale-deploy crash in a session stays on screen", () => {
    const e = new Error("Loading chunk 4821 failed.");
    e.name = "ChunkLoadError";
    const first = render(<RouteError error={e} reset={vi.fn()} />);
    first.unmount();
    render(<RouteError error={e} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
  });
});
