import type { ReactNode } from "react";

/**
 * The one list row — a label/value/trailing line with a real, whole-row click
 * target when interactive (Fitts's Law; also fixes the keyboard-dead rows the
 * audit found). Renders a <button> when onClick is given so it is focusable and
 * Enter/Space-activatable for free; a plain <div> otherwise.
 */
export interface RowProps {
  label: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}

export function Row({ label, value, trailing, onClick, ariaLabel }: RowProps) {
  const body = (
    <>
      <span className="uirow-label">{label}</span>
      {value != null && <span className="uirow-value">{value}</span>}
      {trailing != null && <span className="uirow-trailing">{trailing}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="uirow uirow-clickable" onClick={onClick} aria-label={ariaLabel}>
        {body}
      </button>
    );
  }
  return <div className="uirow">{body}</div>;
}
