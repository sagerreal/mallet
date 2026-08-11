/**
 * components/modals/modal.tsx
 * Reusable overlay shell using prototype CSS: .overlay.open / .modal / .x
 * Backdrop click and Escape both close the modal.
 *
 * This is the single dialog contract — all 22 modal bodies render inside it, so
 * the accessibility behaviour lives here once rather than 22 times:
 *   - role="dialog" + aria-modal so assistive tech announces it as a dialog
 *   - focus moves INTO the panel on open and returns to the trigger on close
 *   - Tab / Shift+Tab cycle within the panel instead of escaping behind the overlay
 */

"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Elements that can hold keyboard focus inside the panel. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** "wide" adds the .wide class to the inner panel */
  wide?: boolean;
  /** exact max-width override (px) — e.g. the 560px price/quote builder sheet */
  maxWidth?: number;
  /** Accessible name for the dialog, announced on open. */
  label?: string;
  /**
   * This mount replaces another open modal in the same commit (ModalHost's switch
   * detection) — skip the entrance animation. Replaying it on a switch painted a full
   * frame of bare page (outgoing gone, incoming at the keyframes' opacity 0) and then a
   * translucent fade over it: the "glitch" on every modal→modal hop.
   */
  instant?: boolean;
}

export function Modal({ open, onClose, children, wide, maxWidth, label, instant }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Remember the trigger, move focus into the panel, and put it back on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    return () => {
      const target = restoreRef.current;
      // Only restore if the trigger still exists — a row that closed with the modal doesn't.
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  // Escape closes; Tab cycles inside the panel rather than escaping behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Swipe-down dismisses the sheet on touch (mobile renders modals as bottom
  // sheets). Only when the panel is scrolled to the top — otherwise the gesture is
  // scrolling — and only a deliberate pull (>72px) closes, so a sloppy scroll can't
  // eat the modal. This is what makes the grabber an affordance instead of
  // decoration, which the house rules would otherwise require deleting.
  let touchStartY = 0;
  let pulling = false;
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    pulling = panel != null && panel.scrollTop <= 0;
    touchStartY = e.touches[0]?.clientY ?? 0;
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!pulling) return;
    const dy = (e.touches[0]?.clientY ?? 0) - touchStartY;
    if (dy > 72) {
      pulling = false;
      onClose();
    }
  };

  return (
    <div
      className={`overlay open${instant ? " swap" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal${wide ? " wide" : ""}`}
        style={maxWidth != null ? { maxWidth } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? "Dialog"}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        {/* Sticky zero-height rail so the ✕ stays reachable however far the sheet
            scrolls — position:absolute pinned it to the panel TOP, which scrolled
            away with the content (Owen lost the close button mid-modal). */}
        <div className="xwrap">
          <button className="x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
