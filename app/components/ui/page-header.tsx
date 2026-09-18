import type { ReactNode } from "react";

/**
 * The one page header — renders the prototype `.pagehead` (title left, actions
 * right) with an optional subtitle.
 *
 * MOBILE CONTRACT (decided, P6): on mobile the shell's SectionTabs bar is the
 * page identity, so `.pagehead` and `.sub` are hidden by the mobile media block
 * in prototype.css — deliberately, not as a regression. A page that uses
 * PageHeader must have its route represented in SectionTabs (all current ones
 * do); its `action` must also exist somewhere reachable on mobile (the .mob-new
 * pattern). Don't "fix" the hide per-page.
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
