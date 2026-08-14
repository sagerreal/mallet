"use client";

import { useState } from "react";

export interface FoldCardProps {
  title: string;
  /**
   * A small glyph for this row (see setting-marks.tsx).
   *
   * Optional, and its absence is handled rather than left ragged: a row without one keeps the same
   * text baseline as its neighbours, so a half-marked list does not look broken while marks are
   * being added.
   */
  mark?: React.ReactNode;
  summary?: string;
  defaultOpen?: boolean;
  /**
   * A `#hash` target, so something elsewhere can link to THIS card rather than to the top of a
   * long Settings page. Only set it where a link actually exists — an id nothing points at is
   * dead weight.
   */
  anchorId?: string;
  children: React.ReactNode;
}

export function FoldCard({ title, mark, summary, defaultOpen = false, anchorId, children }: FoldCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={anchorId} className={`foldcard${open ? " open" : ""}`}>
      <div className="fhead" onClick={() => setOpen((v) => !v)}>
        <span className="caret">▸</span>
        {/* aria-hidden on the tile: the row's own title already names it, and a described icon
            beside a heading reads the row twice.

            NOTHING is rendered when there is no mark — not even a spacer. A 30px placeholder on
            every unmarked FoldCard widened cards on pages that never asked for marks, and pushed
            /dashboard?tab=frontdesk 5px past a 393px viewport. */}
        {mark ? (
          <span className="fmark" aria-hidden="true">
            {mark}
          </span>
        ) : null}
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  );
}
