// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";
import { Card } from "./card";
import { Badge } from "./badge";
import { Field, Input, Select } from "./input";
import { PageHeader } from "./page-header";
import { Row } from "./row";
import { DisclosureRow } from "./disclosure-row";

describe("ui primitives render prototype classes (one house style, no Tailwind)", () => {
  it("Button maps variant/size to prototype .btn modifiers", () => {
    const { rerender } = render(<Button>Go</Button>);
    expect(screen.getByRole("button").className).toBe("btn primary");
    rerender(<Button variant="quiet" size="sm">Go</Button>);
    expect(screen.getByRole("button").className).toBe("btn ghost sm");
    rerender(<Button variant="danger">Go</Button>);
    expect(screen.getByRole("button").className).toBe("btn danger");
  });

  it("Button defaults to type=button (never a stray form submit)", () => {
    render(<Button>Go</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).type).toBe("button");
  });

  it("Card renders .card and passes through className", () => {
    const { container } = render(<Card className="extra">x</Card>);
    expect((container.firstChild as HTMLElement).className).toBe("card extra");
  });

  it("Badge maps tone to a .pill modifier (neutral -> gray)", () => {
    const { rerender, container } = render(<Badge>n</Badge>);
    expect((container.firstChild as HTMLElement).className).toBe("pill gray");
    rerender(<Badge tone="amber">a</Badge>);
    expect((container.firstChild as HTMLElement).className).toBe("pill amber");
  });

  it("Field wraps a label + control in .field so prototype styling applies", () => {
    render(<Field label="Email"><Input type="email" /></Field>);
    expect(screen.getByText("Email").closest(".field")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("Select renders a real select", () => {
    render(<Field label="Kind"><Select><option>a</option></Select></Field>);
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("PageHeader renders .pagehead with title, optional subtitle + action", () => {
    render(<PageHeader title="Jobs" subtitle="all of them" action={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    expect(screen.getByText("all of them").className).toBe("sub");
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("Row is a plain div when static, a real button when interactive", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Row label="Fee" value="$95" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Row label="Fee" value="$95" onClick={onClick} ariaLabel="Edit fee" />);
    const btn = screen.getByRole("button", { name: "Edit fee" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("DisclosureRow: closed shows label+value only; open reveals the body; head never submits", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DisclosureRow label="Lead source" value="Google" open={false} onToggle={onToggle}>
        <input aria-label="editor" />
      </DisclosureRow>,
    );
    const head = screen.getByRole("button", { name: /Lead source/ });
    expect((head as HTMLButtonElement).type).toBe("button");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.queryByLabelText("editor")).toBeNull();

    fireEvent.click(head);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <DisclosureRow label="Lead source" value="Google" open={true} onToggle={onToggle}>
        <input aria-label="editor" />
      </DisclosureRow>,
    );
    expect(screen.getByRole("button", { name: /Lead source/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("editor")).toBeTruthy();
  });
});
