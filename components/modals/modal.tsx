/**
 * components/modals/modal.tsx
 * Reusable overlay shell using prototype CSS: .overlay.open / .modal / .x
 * Backdrop click and Escape both close the modal.
 */

"use client";

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** "wide" adds the .wide class to the inner panel */
  wide?: boolean;
}

export function Modal({ open, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? " wide" : ""}`}>
        <button className="x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
