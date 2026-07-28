// @vitest-environment jsdom
/**
 * components/ui/field.test.tsx
 *
 * The Field primitive rendered `<div class="field"><label>Name</label><input/></div>`
 * — a label that is a SIBLING of its control with no htmlFor and no id, so it was
 * never programmatically associated. Two real consequences:
 *
 *   1. Screen readers never announced it. The control's accessible name fell back to
 *      its placeholder, which is exactly what placeholders are discouraged for —
 *      the name vanishes the moment the user types.
 *   2. Tapping the label did not focus the control. That is a free, expected hit
 *      target, and on a phone operated with gloves it is not a small loss.
 *
 * It is also why e2e/field.spec.ts sat silently red: getByLabel("Name") matched
 * nothing, because there was no label relationship to match.
 *
 * getByLabelText below is the assertion that matters — it resolves the control
 * THROUGH the label, exactly as a screen reader and Playwright's getByLabel do.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, Input, Select } from "./input";

describe("Field", () => {
  it("associates its label with a plain input", () => {
    render(
      <Field label="Rate ($)">
        <Input defaultValue="900" />
      </Field>,
    );
    // Resolves through the label, not the placeholder.
    expect((screen.getByLabelText("Rate ($)") as HTMLInputElement).value).toBe("900");
  });

  it("associates its label with a select", () => {
    render(
      <Field label="Technician">
        <Select>
          <option value="a">Ana</option>
        </Select>
      </Field>,
    );
    expect(screen.getByLabelText("Technician").tagName.toLowerCase()).toBe("select");
  });

  it("associates its label with a raw input element too", () => {
    // Most call sites pass a bare <input>, not the Input primitive.
    render(
      <Field label="Business name">
        <input type="text" />
      </Field>,
    );
    expect(screen.getByLabelText("Business name")).toBeTruthy();
  });

  it("makes the label point at the control it actually wraps", () => {
    const { container } = render(
      <Field label="Deposit">
        <Input />
      </Field>,
    );
    const label = container.querySelector("label")!;
    const input = container.querySelector("input")!;
    expect(label.getAttribute("for")).toBeTruthy();
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("gives each field its own id, so two on one page do not collide", () => {
    const { container } = render(
      <>
        <Field label="From"><Input /></Field>
        <Field label="To"><Input /></Field>
      </>,
    );
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.id).toBeTruthy();
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
  });

  it("respects an id the caller already set rather than overwriting it", () => {
    const { container } = render(
      <Field label="Notes">
        <Input id="notes-explicit" />
      </Field>,
    );
    expect(container.querySelector("input")!.id).toBe("notes-explicit");
    expect(container.querySelector("label")!.getAttribute("for")).toBe("notes-explicit");
  });

  it("keeps the .field markup the stylesheet depends on", () => {
    // prototype.css styles `.field label` and `.field input` as descendants; changing
    // the structure would silently restyle every form in the app.
    const { container } = render(<Field label="X"><Input /></Field>);
    expect(container.querySelector("div.field > label")).toBeTruthy();
    expect(container.querySelector("div.field > input")).toBeTruthy();
  });
});
