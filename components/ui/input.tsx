import { Children, cloneElement, isValidElement, useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode, CSSProperties } from "react";

/**
 * The field layer — Field (label + control) plus Input/Select that inherit the
 * prototype `.field` styling. Wrapping in `.field` means the descendant rules in
 * prototype.css style the control; no per-input class needed.
 */

/**
 * The compact input treatment — smaller than the full-size `.field` control
 * (radius-sm, tighter padding, base type). Applied inline (not as a class) so it
 * keeps overriding the `.field input` descendant rule when a compact control
 * lives inside a `.field` container. Shared here instead of being redefined in
 * every dense settings/checklist/setup surface.
 */
export const COMPACT_INPUT: CSSProperties = {
  fontSize: "var(--type-base)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
};
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  // Mirrors the prototype `.field` markup used across the app (div > label +
  // control), so the descendant rules in prototype.css style the control for free.
  //
  // The label MUST be programmatically associated with its control. As a bare
  // sibling with no htmlFor it was decorative only: screen readers fell back to the
  // control's placeholder for its accessible name (which disappears as soon as the
  // user types), tapping the label did not focus the control — a free hit target,
  // and not a small loss for a gloved thumb — and `getByLabel` matched nothing,
  // which is why e2e/field.spec.ts sat silently red.
  //
  // Done by cloning the child rather than nesting the control inside the <label>:
  // prototype.css positions `.field > label` and `.field > input` as siblings, and
  // nesting would silently restyle every form in the app. An id the caller already
  // set always wins.
  const generatedId = useId();
  const only = Children.count(children) === 1 ? (children as ReactNode) : null;
  const child = isValidElement<{ id?: string }>(only) ? only : null;
  const controlId = child?.props.id ?? (child ? generatedId : undefined);

  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {child && !child.props.id ? cloneElement(child, { id: controlId }) : children}
    </div>
  );
}
