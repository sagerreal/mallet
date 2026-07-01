// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  it("renders nothing when closed and an in-flow section (no dialog/portal) when open", () => {
    const { rerender, container } = render(
      <Sheet open={false} title="New customer" onClose={() => {}}>x</Sheet>,
    );
    expect(container.innerHTML).toBe("");
    rerender(<Sheet open title="New customer" onClose={() => {}}>x</Sheet>);
    expect(screen.getByText("New customer")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull(); // in-flow, not a floating dialog
  });

  it("calls onClose from the Close button", async () => {
    const onClose = vi.fn();
    render(<Sheet open title="t" onClose={onClose}>x</Sheet>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
