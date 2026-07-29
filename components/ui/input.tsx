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

export interface FieldProps {
  /** The visible, programmatically associated label. */
  label: string;
  /**
   * Secondary text rendered inside the label after the name — "(optional)",
   * "(for a PDF copy)". Taken as a node rather than a string so a call site can
   * hand over its existing `<span className="muted" style={…}>` verbatim; the
   * hint spans in this app carry per-site `textTransform`/`letterSpacing` resets
   * and canonicalising them here would move pixels.
   */
  hint?: ReactNode;
  /** Layout style for the `.field` wrapper (margin, flex, minWidth). */
  style?: CSSProperties;
  /** Extra classes on the `.field` wrapper. `.field` is always kept. */
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, style, className, children }: FieldProps) {
  // Mirrors the prototype `.field` markup used across the app (div > label +
  // control), so the descendant rules in prototype.css style the control for free.
  //
  // `style`/`className`/`hint` exist so the remaining hand-rolled sites can
  // actually compose this primitive. They were reported as "irregular" markup
  // needing per-site work, but 36 of 67 differed from the regular shape only by a
  // layout style on the wrapper and 6 only by a hint span. Without these props the
  // choice at each of those sites is to hand-roll htmlFor/id again, which is how
  // 85 unlabelled controls got here.
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
  // ONE traversal for both finding and rendering. `Children.toArray` strips
  // null/false children while `Children.map` visits them, so an index taken from one
  // and applied to the other points at the wrong node the moment a call site has a
  // conditional child. Re-keying is why identity comparison is not an option either.
  const nodes = Children.toArray(children);
  const controlAt = findControlIndex(nodes);
  const control = controlAt < 0 ? null : nodes[controlAt];
  const existingId = isValidElement<{ id?: string }>(control)
    ? control.props.id
    : undefined;
  const controlId = existingId ?? (controlAt < 0 ? undefined : generatedId);

  return (
    <div className={className ? `field ${className}` : "field"} style={style}>
      <label htmlFor={controlId}>
        {label}
        {/* The separator is conditional: an unconditional {" "} would append a
            trailing space to the accessible name of every hint-less field. */}
        {hint ? <> {hint}</> : null}
      </label>
      {controlAt >= 0 && !existingId
        ? nodes.map((node, i) =>
            i === controlAt && isValidElement<{ id?: string }>(node)
              ? cloneElement(node, { id: controlId })
              : node,
          )
        : children}
    </div>
  );
}

/**
 * A label naming a SET of controls — the chip toggles behind "Type", "How did it
 * go?", "Direction".
 *
 * `htmlFor` cannot express this: there is no single control to point at, and
 * pointing it at the first button would name that button twice while leaving its
 * siblings anonymous. The label names a `role="group"` instead, so a screen reader
 * announces "Type, group" before reading the options.
 *
 * The caller's own container class is rendered here rather than wrapped, because
 * `.chips` is a flex row directly under `.field` — an extra div would change the
 * layout and move every baseline that contains one of these.
 */
export function FieldGroup({
  label,
  hint,
  style,
  className,
  groupClassName,
  children,
}: FieldProps & { groupClassName?: string }) {
  const labelId = useId();
  return (
    <div className={className ? `field ${className}` : "field"} style={style}>
      <label id={labelId}>
        {label}
        {hint ? <> {hint}</> : null}
      </label>
      <div className={groupClassName} role="group" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}

/**
 * A matched `htmlFor`/`id` pair for one label and one control.
 *
 * For rows laid out by hand rather than as a `.field` block — the pricebook and
 * timesheet rows put a fixed-width label beside its control in a flex row, so
 * `Field`'s stacked `.field` markup would change the layout. This keeps the markup
 * and supplies the association the site was missing.
 *
 *   const cat = useFieldId();
 *   <label {...cat.labelProps} style={…}>Category</label>
 *   <select {...cat.controlProps} …/>
 */
export function useFieldId(): {
  labelProps: { htmlFor: string };
  controlProps: { id: string };
} {
  const id = useId();
  return { labelProps: { htmlFor: id }, controlProps: { id } };
}

/**
 * The same label→group wiring as `FieldGroup`, handed back as attributes.
 *
 * For the sites `FieldGroup` cannot own: the controls already sit in a container
 * carrying inline layout styles, or explanatory prose follows them inside the same
 * `.field`. Re-parenting either one changes `.field`'s child list and moves pixels,
 * so here the existing markup keeps its shape and only gains three attributes.
 *
 *   const group = useGroupLabel();
 *   <div className="field">
 *     <label {...group.labelProps}>Job type</label>
 *     <div style={…} {...group.groupProps}>…</div>
 *     <p>…</p>
 *   </div>
 */
export function useGroupLabel(): {
  labelProps: { id: string };
  groupProps: { role: "group"; "aria-labelledby": string };
} {
  const labelId = useId();
  return {
    labelProps: { id: labelId },
    groupProps: { role: "group", "aria-labelledby": labelId },
  };
}

/**
 * The native elements a `<label for>` can actually name.
 *
 * `button` is on this list because SelectMenu renders one as its trigger — a button IS labelable
 * per HTML, and without it a Field wrapping a SelectMenu would emit htmlFor={undefined}: a
 * silently unassociated label, the defect this primitive exists to prevent.
 */
const LABELABLE = new Set(["input", "select", "textarea", "button"]);

/**
 * Index of the child that should carry the generated id, or -1.
 *
 * A single child wins whatever its type, so non-native wrappers like `DurField`
 * keep their association. With SEVERAL children the first labelable native control
 * wins — the invoice "Bill to" field is `<input list>` + `<datalist>`, and under a
 * single-child-only rule that pair rendered `htmlFor={undefined}` with no id: a
 * silently unassociated label, the very defect this primitive exists to prevent,
 * and one axe does not report because it accepts the placeholder as the name.
 */
function findControlIndex(nodes: ReturnType<typeof Children.toArray>): number {
  if (nodes.length === 1) return isValidElement(nodes[0]) ? 0 : -1;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!isValidElement(node)) continue;
    if (typeof node.type === "string" && LABELABLE.has(node.type)) return i;
    if (node.type === Input || node.type === Select) return i;
  }
  return -1;
}
