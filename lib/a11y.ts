/**
 * lib/a11y.ts — keyboard access for prototype-styled clickables. The 1:1 port
 * keeps divs/spans/trs for visual fidelity; spread pressable(onActivate) on them
 * so they're focusable and Enter/Space-operable like real buttons.
 */

import type { KeyboardEvent } from "react";

export function pressable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
