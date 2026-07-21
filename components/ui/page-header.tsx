import type { ReactNode } from "react";

/**
 * The one page header — renders the prototype `.pagehead` (title left, actions
 * right) with an optional subtitle. Consolidating the 7 hand-rolled header
 * patterns onto this also fixes the mobile-title regression (the blanket
 * .pagehead display:none is replaced by this component owning its layout).
 */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <>
      <div className="pagehead">
        <h1>{title}</h1>
        {action ?? null}
      </div>
      {subtitle ? <div className="sub">{subtitle}</div> : null}
    </>
  );
}
