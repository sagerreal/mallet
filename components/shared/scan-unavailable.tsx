"use client";

/**
 * components/shared/scan-unavailable.tsx
 *
 * The scan affordance in every state EXCEPT `ready`: the same button the user would tap,
 * rendered disabled, with the reason it cannot run sitting under it.
 *
 * It exists because the alternative — hiding the control — hid the app's only native
 * capability from everyone who could not use it. A reviewer on a base iPhone, or any of us
 * testing in a browser, saw a Scope section with no scanner in it and no way to tell whether
 * the feature was missing, broken, or just not for this device. Now the control is always
 * there and it says which.
 *
 * WHY IT IS NOT A DEAD BUTTON. The house rule is "wire a control or delete it". A dead button
 * is one that presents itself as working and then does nothing. This one presents itself as
 * unavailable — dimmed, `disabled`, reason attached — so it informs instead of misleading.
 *
 * COPY. One sentence per status, naming the actual blocker and the next step, per the house
 * copy rule. Deliberately NOT collapsed into one generic string: "needs an iPhone Pro" is
 * simply wrong on a desktop, and "open the iPhone app" is useless advice to someone already
 * holding the app. The native `available()` `reason` code is never shown — it is a diagnostic,
 * not copy.
 *
 * A11Y. The reason is wired to the button with `aria-describedby`, so a screen reader announces
 * "Scan a room, dimmed — Needs an iPhone Pro…" rather than leaving the blocker as a purely
 * visual grey. The real `disabled` attribute (not `aria-disabled`) keeps it out of the tab
 * order, so it can never be focused and pressed as if it were live — that is also the repo's
 * standing disabled pattern (`disabled={readOnly}` throughout), and `.scanbtn:disabled` dims it
 * following the `.mh-acts .btn:disabled` precedent, the closest existing disabled-control
 * treatment. There is no disabled-ROW precedent in the design system; that scoped-dim rule is
 * the nearest one and is reused verbatim rather than inventing a look.
 */

import { useId } from "react";
import type { BlockedRoomScanAvailability } from "@/lib/native/room-scan";

/**
 * The user-facing reason per blocked status — the single source of this copy.
 * `checking` is transient (one tick, shell only) but still gets a real sentence: a dimmed
 * control with no explanation is the thing this component exists to prevent.
 */
const REASON: Record<BlockedRoomScanAvailability["status"], string> = {
  checking: "Checking whether this device can scan.",
  "no-lidar": "Needs an iPhone Pro or iPad Pro — room scanning uses the LiDAR sensor.",
  "no-native-app": "Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor.",
  "scanner-missing": "The scanner did not load. Close the Mallet app and open it again.",
};

/** Test/verifier helper: the exact sentence a given blocked status shows. */
export function scanUnavailableReason(status: BlockedRoomScanAvailability["status"]): string {
  return REASON[status];
}

export interface ScanUnavailableProps {
  /** Why scanning is blocked. `ready` is excluded by the type — render the live control instead. */
  availability: BlockedRoomScanAvailability;
  /** The verb this surface uses when scanning IS available ("Scan a room", "Re-scan room", …). */
  label: string;
  /**
   * Which control shape this surface's live scan affordance has, so the disabled one matches it:
   * `button` for the `.btn` surfaces, `link` for the room card's `.linklike` row.
   */
  variant?: "button" | "link";
}

export function ScanUnavailable({ availability, label, variant = "button" }: ScanUnavailableProps) {
  const reasonId = useId();
  const className = variant === "link" ? "linklike scanbtn" : "btn sm scanbtn";

  return (
    <>
      <button type="button" className={className} disabled aria-describedby={reasonId}>
        {label}
      </button>
      <p className="scanwhy" id={reasonId}>
        {REASON[availability.status]}
      </p>
    </>
  );
}
