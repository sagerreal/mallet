/**
 * components/shell/new-menu.tsx
 * The "+ New" dropdown button (§2.4) — the DESKTOP create surface, in the sidebar.
 *
 * The sidebar is `display:none` below 760px, so the MOBILE create surface is the
 * topbar's "+" instead. Both render the same actions from useNewMenuItems, so the
 * two surfaces cannot drift.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useNewMenuItems } from "@/components/shell/new-menu-items";

export function NewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = useNewMenuItems(() => setOpen(false));

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className={`navnew${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="plus">+</span>
        <span>New</span>
        <span className="nm-caret">▾</span>
      </button>

      {open && (
        <div className="newmenu open">
          {items.map((item) => (
            <button
              key={item.label}
              className="newitem"
              onClick={item.action}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
