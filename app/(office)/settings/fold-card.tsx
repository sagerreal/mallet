"use client";

import { useState } from "react";

export interface FoldCardProps {
  title: string;
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

export function FoldCard({ title, summary, defaultOpen = false, anchorId, children }: FoldCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={anchorId} className={`foldcard${open ? " open" : ""}`}>
      <div className="fhead" onClick={() => setOpen((v) => !v)}>
        <span className="caret">▸</span>
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  );
}
