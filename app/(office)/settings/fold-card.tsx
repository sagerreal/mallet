"use client";

import { useState } from "react";

export interface FoldCardProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function FoldCard({ title, summary, defaultOpen = false, children }: FoldCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`foldcard${open ? " open" : ""}`}>
      <div className="fhead" onClick={() => setOpen((v) => !v)}>
        <span className="caret">▸</span>
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  );
}
