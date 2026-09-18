"use client";

/**
 * features/a2p/sms-blocked.tsx
 * What a send control looks like on a shop that cannot text yet.
 *
 * BLOCKED, NOT DISABLED. The control keeps its place and stays in the tab order; only its
 * availability changes. Two reasons, and neither is aesthetic:
 *
 *   1. `disabled` removes the control from the accessibility tree — unfocusable, unannounced —
 *      so a screen-reader user gets silence exactly where a sighted user gets a reason.
 *      `aria-disabled` announces "unavailable" and keeps the reason reachable.
 *   2. Deleting the control hides the feature from every shop that has not registered. They
 *      never learn texting exists, and the layout jumps the day approval lands.
 *
 * `aria-disabled` is a LABEL and not a BEHAVIOUR — the browser still dispatches the click — so
 * `smsBlockProps` pairs the attribute with the guard that makes it true. Never set one by hand
 * without the other; see sms-blocked.test.tsx.
 *
 * NO CALL TO ACTION HERE. The account banner (./sms-setup-banner) is the one place that explains
 * and the one place that links. Repeating "Set up texting" beside six controls is noise, and it
 * is nonsense on the three surfaces a technician can reach — they cannot file a registration.
 */

import type { MouseEvent } from "react";
import type { SmsGate } from "./use-sms-ready";

export interface SmsBlockProps {
  readonly "aria-disabled"?: true;
  readonly onClick: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * Props for a control the carrier gate blocks: the announcement and the click guard, together.
 *
 * `aria-disabled` is omitted rather than set to `false` when texting works — an explicit "false"
 * puts a claim in the accessibility tree where saying nothing is correct.
 */
export function smsBlockProps(gate: SmsGate, onActivate: () => void): SmsBlockProps {
  if (gate.ready) return { onClick: () => onActivate() };
  return {
    "aria-disabled": true,
    onClick: (e: MouseEvent<HTMLElement>) => {
      // stopPropagation as well as preventDefault: every one of these controls sits inside a row
      // or card that opens on click, and a blocked Send that bubbles would open the record —
      // a different action than the one the shop asked for.
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/**
 * The line under a blocked control. One clause, no link.
 *
 * `role="status"` rather than `alert`: this is a standing condition of the shop, not an event.
 * An alert would interrupt; status announces when the control it explains comes into view.
 */
export function SmsNote({ gate, align = "left" }: { gate: SmsGate; align?: "left" | "right" }) {
  if (gate.ready || !gate.note) return null;
  return (
    <p
      role="status"
      className="sms-note"
      style={{ textAlign: align === "right" ? "right" : "left" }}
    >
      {gate.note}
    </p>
  );
}
