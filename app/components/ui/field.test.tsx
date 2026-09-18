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
import { Field, FieldGroup, Input, Select, useFieldId, useGroupLabel } from "./input";

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

  // ---- the three props that let the remaining hand-rolled sites compose Field ----
  //
  // 83 hand-rolled label sites were reported as "19 mechanically regular, 64
  // irregular". Re-measuring found 85 sites, and that the split was an artifact of
  // this primitive's API rather than of the markup: 36 of the 67 irregular sites are
  // irregular ONLY because their wrapper carries a layout style
  // (`<div className="field" style={{margin:"0"}}>`), and 6 more only because the
  // label carries a muted hint span. Those are the two props below. Without them the
  // choice at each site is to hand-roll htmlFor/id — which is what put 85 unlabelled
  // controls in the app in the first place.

  it("passes a layout style through to the .field wrapper", () => {
    // The wrapper style must land on the SAME node that carries .field, or the
    // margin collapses differently and the visual baselines move.
    const { container } = render(
      <Field label="Tax %" style={{ flex: 1, minWidth: 120 }}>
        <Input />
      </Field>,
    );
    const wrapper = container.querySelector("div.field") as HTMLElement;
    // `flex: 1` expands to the `1 1 0%` longhand, so assert the resolved grow value.
    expect(wrapper.style.flexGrow).toBe("1");
    expect(wrapper.style.minWidth).toBe("120px");
  });

  it("keeps the .field class when the caller adds a className", () => {
    const { container } = render(
      <Field label="Crew" className="fpanel-field">
        <Input />
      </Field>,
    );
    const wrapper = container.querySelector("div.field") as HTMLElement;
    expect(wrapper.classList.contains("field")).toBe(true);
    expect(wrapper.classList.contains("fpanel-field")).toBe(true);
  });

  it("renders a hint inside the label but keeps the accessible name resolvable", () => {
    // The hint is part of the label element, so the accessible name includes it.
    // getByLabelText with a substring matcher still resolves the control, which is
    // what a screen reader and Playwright's getByLabel do.
    const { container } = render(
      <Field
        label="Email"
        hint={<span className="muted">(for the emailed invoice link)</span>}
      >
        <Input />
      </Field>,
    );
    const label = container.querySelector("label")!;
    expect(label.textContent).toBe("Email (for the emailed invoice link)");
    expect(screen.getByLabelText(/Email/)).toBe(container.querySelector("input"));
  });

  it("still associates the control when a hint is present", () => {
    const { container } = render(
      <Field label="Price" hint={<span className="muted">(optional)</span>}>
        <Input />
      </Field>,
    );
    const label = container.querySelector("label")!;
    expect(label.getAttribute("for")).toBe(container.querySelector("input")!.id);
  });

  it("associates the first labelable control when the field holds several children", () => {
    // The invoice "Bill to" field is <input list> + <datalist>. With the
    // single-child rule that pair produced htmlFor={undefined} and no id — a
    // silently unassociated label, which is the exact defect being fixed here and
    // one axe does not report.
    render(
      <Field label="Bill to">
        <input type="text" list="billto-list" defaultValue="Ana" />
        <datalist id="billto-list">
          <option value="Ana" />
        </datalist>
      </Field>,
    );
    const control = screen.getByLabelText("Bill to");
    expect(control.tagName.toLowerCase()).toBe("input");
    expect((control as HTMLInputElement).value).toBe("Ana");
  });

  it("skips a non-labelable element to reach the control", () => {
    // A leading hint <div> must not swallow the association.
    const { container } = render(
      <Field label="Radius (miles)">
        <div className="muted">how far you travel</div>
        <input type="number" defaultValue="25" />
      </Field>,
    );
    expect(container.querySelector("label")!.getAttribute("for")).toBe(
      container.querySelector("input")!.id,
    );
  });

  it("still labels a lone custom control that is not a native input", () => {
    // Pre-existing behaviour: a single child of any element type gets the id, so
    // wrappers like DurField keep working. Narrowing to native controls only would
    // silently unlabel them.
    function Custom(props: { id?: string }) {
      return <div data-testid="custom" id={props.id} />;
    }
    const { container } = render(
      <Field label="Length">
        <Custom />
      </Field>,
    );
    const label = container.querySelector("label")!;
    expect(label.getAttribute("for")).toBeTruthy();
    expect(label.getAttribute("for")).toBe(
      container.querySelector('[data-testid="custom"]')!.id,
    );
  });

  it("omits the hint separator entirely when there is no hint", () => {
    // A stray trailing space would change the accessible name of all 79 other fields.
    const { container } = render(<Field label="Notes"><Input /></Field>);
    expect(container.querySelector("label")!.textContent).toBe("Notes");
  });
});

describe("FieldGroup", () => {
  // Three sites label a set of chip buttons rather than one control: "Type" in
  // job-modal and new-job-modal, "How did it go?" in call-modal. htmlFor is the
  // wrong tool — there is no single control to point at, and pointing at the first
  // button would name that button twice and leave the rest anonymous. The label
  // names a role="group" instead.

  it("names the group with its label", () => {
    render(
      <FieldGroup label="Type" groupClassName="chips">
        <button type="button">Estimate</button>
        <button type="button">Job</button>
      </FieldGroup>,
    );
    expect(screen.getByRole("group", { name: "Type" })).toBeTruthy();
  });

  it("keeps the caller's container class so the DOM shape does not change", () => {
    // The chips container already existed; FieldGroup renders it rather than adding
    // a wrapper, or `.field > div` layout would shift and the baselines would move.
    const { container } = render(
      <FieldGroup label="Type" groupClassName="chips">
        <button type="button">Estimate</button>
      </FieldGroup>,
    );
    expect(container.querySelector("div.field > label")).toBeTruthy();
    const group = container.querySelector("div.field > div.chips") as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.getAttribute("role")).toBe("group");
    expect(container.querySelectorAll("div.field > div")).toHaveLength(1);
  });

  it("passes a layout style to the .field wrapper, not the group", () => {
    const { container } = render(
      <FieldGroup label="Type" groupClassName="chips" style={{ marginTop: "var(--space-2)" }}>
        <button type="button">Estimate</button>
      </FieldGroup>,
    );
    expect((container.querySelector("div.field") as HTMLElement).style.marginTop).toBe(
      "var(--space-2)",
    );
    expect((container.querySelector("div.chips") as HTMLElement).style.marginTop).toBe("");
  });

  it("associates nothing via htmlFor, because there is no single control", () => {
    const { container } = render(
      <FieldGroup label="Type" groupClassName="chips">
        <button type="button">Estimate</button>
      </FieldGroup>,
    );
    expect(container.querySelector("label")!.hasAttribute("for")).toBe(false);
  });

  it("gives two groups on one page distinct label ids", () => {
    const { container } = render(
      <>
        <FieldGroup label="Type" groupClassName="chips"><button type="button">a</button></FieldGroup>
        <FieldGroup label="Direction" groupClassName="chips"><button type="button">b</button></FieldGroup>
      </>,
    );
    const ids = Array.from(container.querySelectorAll("label")).map((l) => l.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(screen.getByRole("group", { name: "Direction" })).toBeTruthy();
  });
});

describe("useFieldId", () => {
  // For rows laid out by hand: a fixed-width label beside its control in a flex row,
  // where Field's stacked `.field` markup would change the layout.

  function Row() {
    const cat = useFieldId();
    return (
      <div style={{ display: "flex" }}>
        <label {...cat.labelProps} style={{ minWidth: 66 }}>Category</label>
        <select {...cat.controlProps} defaultValue="drains">
          <option value="drains">Drains</option>
        </select>
      </div>
    );
  }

  it("resolves the control through its label", () => {
    render(<Row />);
    expect(screen.getByLabelText("Category").tagName.toLowerCase()).toBe("select");
  });

  it("keeps the hand-laid-out markup intact", () => {
    const { container } = render(<Row />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.display).toBe("flex");
    expect((container.querySelector("label") as HTMLElement).style.minWidth).toBe("66px");
  });

  it("mints a distinct id per row so a list does not collide", () => {
    const { container } = render(
      <>
        <Row />
        <Row />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("label")).map((l) =>
      l.getAttribute("for"),
    );
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(screen.getAllByLabelText("Category")).toHaveLength(2);
  });
});

describe("useGroupLabel", () => {
  // For sites where FieldGroup's own wrapper cannot be used: the container already
  // carries inline layout styles, or prose follows the controls inside the same
  // `.field`. Nesting or re-parenting either one moves pixels, so this hook supplies
  // the same wiring as attributes and leaves the DOM shape exactly as it was.

  function Subject() {
    const group = useGroupLabel();
    return (
      <div className="field">
        <label {...group.labelProps}>Ballpark range ($)</label>
        <div style={{ display: "flex" }} {...group.groupProps}>
          <input aria-label="Ballpark range from" defaultValue="150" />
          <span className="muted">to</span>
          <input aria-label="Ballpark range to" defaultValue="300" />
        </div>
        <p className="muted">what the caller hears</p>
      </div>
    );
  }

  it("names the group with the label, without htmlFor", () => {
    render(<Subject />);
    expect(screen.getByRole("group", { name: "Ballpark range ($)" })).toBeTruthy();
  });

  it("leaves the DOM shape untouched", () => {
    // The <p> stays a direct child of .field, and the flex container keeps its style.
    const { container } = render(<Subject />);
    expect(container.querySelector("div.field > p")).toBeTruthy();
    const group = container.querySelector("div.field > div") as HTMLElement;
    expect(group.style.display).toBe("flex");
    expect(group.getAttribute("role")).toBe("group");
  });

  it("still lets each control keep its own name inside the group", () => {
    render(<Subject />);
    expect((screen.getByLabelText("Ballpark range from") as HTMLInputElement).value).toBe("150");
    expect((screen.getByLabelText("Ballpark range to") as HTMLInputElement).value).toBe("300");
  });

  it("mints a distinct id per instance", () => {
    const { container } = render(
      <>
        <Subject />
        <Subject />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("label")).map((l) => l.id);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
