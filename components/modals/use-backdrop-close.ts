"use client";

/**
 * components/modals/use-backdrop-close.ts
 * When a click on the overlay counts as "the user meant to dismiss this".
 *
 * A `click` fires on the nearest common ancestor of where the press went DOWN and where it came
 * UP. So dragging across a field to select its text and releasing a few pixels past the panel edge
 * — the ordinary way anyone highlights an address to retype it — produced a click whose target was
 * the overlay itself, and the sheet closed with the typing lost.
 *
 * The release position is not evidence of intent on its own. A dismissal is a press that BEGAN on
 * the backdrop and ended there; anything that began inside the panel is an interaction with the
 * panel, however far the pointer travelled.
 *
 * Extracted from Modal so the rule lives in one documented place rather than inline in a component
 * that is already over the function-length cap.
 */

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

export interface BackdropCloseHandlers {
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly onClick: (e: ReactMouseEvent<HTMLElement>) => void;
}

export function useBackdropClose(onClose: () => void): BackdropCloseHandlers {
  // Did the press in flight BEGIN on the backdrop itself?
  const pressedBackdrop = useRef(false);

  return {
    // pointerdown, not mousedown: one handler covers mouse, touch and pen, and it fires before
    // focus moves, so a field taking focus cannot reorder it.
    onPointerDown: (e) => {
      pressedBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      const startedOnBackdrop = pressedBackdrop.current;
      // Disarm FIRST. Left set, the next release over the backdrop would close on stale state —
      // an intermittent version of the bug this exists to fix.
      pressedBackdrop.current = false;
      if (e.target === e.currentTarget && startedOnBackdrop) onClose();
    },
  };
}
