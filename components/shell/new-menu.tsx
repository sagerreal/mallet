/**
 * components/shell/new-menu.tsx
 * The "+ New" dropdown button (§2.4).
 * Items dispatch openModal() — no magic strings, all MODAL.* constants.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface MenuItem {
  label: string;
  action: () => void;
}

export function NewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const openModal = useOpenModal();

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

  const items: MenuItem[] = [
    {
      label: "New customer",
      action: () => { openModal(MODAL.NEW_CUSTOMER); setOpen(false); },
    },
    {
      label: "New quote",
      action: () => { router.push("/composer"); setOpen(false); },
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="quickadd-btn"
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
