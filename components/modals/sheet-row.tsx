/**
 * components/modals/sheet-row.tsx
 * The quiet level-0 row of the sheet grammar — label left, value right, optional
 * in-flow accordion body. One register for every row so the list reads as a list
 * (config-surface rule), and the body opens INSIDE the flow, never floating.
 *
 * Two shapes:
 *   <SheetRow label="Phone" value="Add" onPress={…}/>       — a plain action row
 *   <SheetRow label="Notes" value="2" expandable>{body}</…>  — an accordion row
 *
 * The whole row is one 52px button (glove target). Empty rows say "Add" —
 * an affordance, not a dash: the register critic found "—" reads as broken data.
 */

"use client";

import { useId, useState, type ReactNode } from "react";

interface SheetRowProps {
  label: string;
  /** Trailing text. Pass the real value when filled, "Add" when empty. */
  value?: string;
  /** Muted "Add"-style treatment for the trailing text. */
  valueIsHint?: boolean;
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

  return (
    <>
      <button
        type="button"
        className="sheet-row"
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable && open ? bodyId : undefined}
        onClick={expandable ? () => setOpen(!open) : onPress}
      >
        <span className="lab">{label}</span>
        {value != null && <span className={`val${valueIsHint ? " add" : ""}`}>{value}</span>}
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
