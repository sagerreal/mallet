/**
 * components/modals/sheet-row.tsx
 * The sheet grammar's ONE row — label left, value right, optional in-flow accordion
 * body. One primitive for every row so the list reads as a list (config-surface rule),
 * and the body opens INSIDE the flow, never floating.
 *
 * Three shapes, one behaviour:
 *   <SheetRow label="Phone" value="Add" onPress={…}/>        — a plain action row
 *   <SheetRow label="Notes" value="2" expandable>{body}</…>   — an accordion row
 *   <SheetRow variant="section" label="Found work" value={3} expandable>{body}</…>
 *
 * `variant` is a REGISTER, not a second component. The default is the quiet level-0
 * config row (`.sheet-row`); "section" is the tech field sheet's uppercase chapter
 * head (`.fsec` / `.tjf`), which reads as a heading rather than as a setting. The
 * disclosure behaviour — controlled or uncontrolled open, the aria-expanded button,
 * the id-linked in-flow body — is identical, which is precisely why it is a prop here
 * and not a duplicate file. (It WAS a duplicate file, `tech-job-modal/counted-section.tsx`,
 * and the copy had no aria-controls, a 44px target and no controlled mode.)
 *
 * The whole row is one 52px button (glove target). Empty rows say "Add" —
 * an affordance, not a dash: the register critic found "—" reads as broken data.
 */

"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Which register the row is drawn in.
 *   "row"     — the quiet level-0 config row: hairline-separated, sentence case.
 *   "section" — a field-sheet chapter head: rule above, uppercase tracked label.
 */
export type SheetRowVariant = "row" | "section";

interface SheetRowProps {
  label: string;
  /** Trailing text. Pass the real value when filled, "Add" when empty. */
  value?: ReactNode;
  /** Muted "Add"-style treatment for the trailing text. */
  valueIsHint?: boolean;
  /**
   * Extra trailing content rendered between the value and the chevron — a
   * status Badge, a small muted note ("measured 560"), a count's qualifier
   * ("· 2 awaiting OK"). Kept separate from `value` so `value` stays the single
   * right-aligned, ellipsis-truncated string every other row already passes.
   */
  after?: ReactNode;
  /** The row's visual register. Default "row". */
  variant?: SheetRowVariant;
  /** Renders a chevron and an in-flow accordion body. */
  expandable?: boolean;
  /** Open the accordion on first render (used when a row is the primary's target). */
  defaultOpen?: boolean;
  /** Controlled mode — lets a primary action ("Add phone") open its target row. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Plain action row: called on press when not expandable. */
  onPress?: () => void;
  children?: ReactNode;
}

export function SheetRow({
  label,
  value,
  valueIsHint,
  after,
  variant = "row",
  expandable,
  defaultOpen,
  open: openProp,
  onOpenChange,
  onPress,
  children,
}: SheetRowProps) {
  const [openState, setOpenState] = useState(Boolean(defaultOpen));
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    if (openProp === undefined) setOpenState(v);
  };
  const bodyId = useId();
  const onClick = expandable ? () => setOpen(!open) : onPress;
  const ariaExpanded = expandable ? open : undefined;
  const ariaControls = expandable && open ? bodyId : undefined;

  if (variant === "section") {
    return (
      // The wrapper is the `.tjf` open-state hook the caret rotation and the collapsed
      // head's margin both hang off. The body is a bare div so it can carry the id the
      // head points at, and bare so margins still collapse through it exactly as they
      // did when the children were `.fsec`'s own.
      <div className={open ? "fsec tjf open" : "fsec tjf"}>
        <button
          type="button"
          className="fsec-h tjf-h"
          aria-expanded={ariaExpanded}
          aria-controls={ariaControls}
          onClick={onClick}
        >
          <span className="tjf-t">{label}</span>
          {/* `add` is the empty-state register, exactly as the row branch below uses it. The
              section head used to ignore valueIsHint, so a chapter whose value is the word "Add"
              rendered identically to one carrying a real number — the prop was accepted and
              silently dropped, which is worse than not taking it. */}
          <span className={valueIsHint ? "tjf-v add" : "tjf-v"}>
            {value}
            {after}
            <span className="tjcaret" aria-hidden="true">
              ›
            </span>
          </span>
        </button>
        {expandable && open && <div id={bodyId}>{children}</div>}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="sheet-row"
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        onClick={onClick}
      >
        <span className="lab">{label}</span>
        {value != null && <span className={`val${valueIsHint ? " add" : ""}`}>{value}</span>}
        {after}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {expandable && open && (
        <div className="sheet-acc" id={bodyId}>
          {children}
        </div>
      )}
    </>
  );
}
