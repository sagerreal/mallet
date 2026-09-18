"use client";

/**
 * Success feedback for EXPLICIT save buttons — the "Saved ✓" flash the settings
 * cards each hand-rolled. Store-write success stays quiet by design (optimistic
 * UI is its own feedback); this is for the forms that commit on a Save click and
 * otherwise gave no sign the click worked (the visibility-of-status rule).
 *
 * The hook also fixes a latent bug in the hand-rolled version: it clears the
 * pending timer on unmount, so a card closed within 2s of saving no longer calls
 * setState on an unmounted component.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface SaveFlash {
  /** True for `durationMs` after `flash()` — drives the "Saved ✓" marker. */
  saved: boolean;
  /** Call after a save succeeds. */
  flash: () => void;
  /** Call when the form changes again, so stale "Saved ✓" clears immediately. */
  reset: () => void;
}

export function useSaveFlash(durationMs = 2000): SaveFlash {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Clear any pending timer when the component unmounts.
  useEffect(() => clear, [clear]);

  const flash = useCallback(() => {
    setSaved(true);
    clear();
    timer.current = setTimeout(() => setSaved(false), durationMs);
  }, [clear, durationMs]);

  const reset = useCallback(() => {
    clear();
    setSaved(false);
  }, [clear]);

  return { saved, flash, reset };
}

/** The "Saved ✓" marker — renders nothing until `saved` is true. */
export function SavedFlash({ saved, children = "Saved ✓" }: { saved: boolean; children?: ReactNode }) {
  if (!saved) return null;
  return (
    <span style={{ color: "var(--green-900)", fontSize: "var(--type-sm)", fontWeight: 600 }}>
      {children}
    </span>
  );
}
