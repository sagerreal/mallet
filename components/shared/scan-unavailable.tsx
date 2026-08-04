"use client";

/**
 * components/shared/scan-unavailable.tsx
 *
 * The scan affordance whenever it cannot run: the same control the user would tap, rendered
 * disabled, with the reason it cannot run sitting under it.
 *
 * It exists because the alternative — hiding the control — hid the app's only native capability
 * from everyone who could not use it. A reviewer on a base iPhone, or any of us testing in a
 * browser, saw a Scope section with no scanner in it and no way to tell whether the feature was
 * missing, broken, or just not for this device. Now the control is always there and it says which.
 *
 * WHY IT IS NOT A DEAD BUTTON. The house rule is "wire a control or delete it". A dead button is
 * one that presents itself as working and then does nothing. This one presents itself as
 * unavailable — dimmed, `disabled`, reason attached — so it informs instead of misleading.
 *
 * THE BLOCKER IS A UNION, NOT A DEVICE STATUS. It started as one: `BlockedRoomScanAvailability`,
 * the ways the hardware/bridge can say no. But the surfaces had other reasons to refuse — a
 * CLOSED job, and the composer before a customer is picked — and both were handled by rendering
 * nothing at all, which is the same unexplained-absence bug in a different costume. They are now
 * blockers in the same union, so a surface's only options are "live control" or "control plus
 * reason": there is no shape of this component that renders silence.
 *
 * COPY. One sentence per blocker, naming the actual thing in the way and the next step, per the
 * house copy rule. Deliberately NOT collapsed into one generic string: "needs an iPhone Pro" is
 * simply wrong on a desktop, and "open the iPhone app" is useless advice to someone already
 * holding the app. The native `available()` `reason` code is never shown — it is a diagnostic,
 * not copy.
 *
 * A11Y. The reason is wired to the button with `aria-describedby`, so a screen reader announces
 * "Scan a room, dimmed — This device reports no LiDAR sensor…" rather than leaving the blocker as
 * a purely visual grey. The real `disabled` attribute (not `aria-disabled`) keeps it out of the
 * tab order, so it can never be focused and pressed as if it were live — that is also the repo's
 * standing disabled pattern (`disabled={readOnly}` throughout), and `.scanbtn:disabled` dims it
 * following the `.mh-acts .btn:disabled` precedent, the closest existing disabled-control
 * treatment. There is no disabled-ROW precedent in the design system; that scoped-dim rule is
 * the nearest one and is reused verbatim rather than inventing a look.
 */

import { useId } from "react";
import type { BlockedRoomScanAvailability } from "@/lib/native/room-scan";

/**
 * Why this surface is not offering a live scan control.
 *
 *  - `device`      — the hardware/bridge/plugin says no. Carries the native status.
 *  - `job-closed`  — the job is done, so nothing new may be attached to it.
 *  - `no-customer` — the composer has no customer picked yet, and a room scan has to land on one
 *                    of their jobs.
 */
export type ScanBlocker =
  | { readonly kind: "device"; readonly availability: BlockedRoomScanAvailability }
  | { readonly kind: "job-closed" }
  | { readonly kind: "no-customer" };

/**
 * The user-facing reason per blocked DEVICE status — the single source of this copy.
 * `checking` is transient (the native probe now times out rather than hanging forever, see
 * lib/native/room-scan.ts) but still gets a real sentence: a dimmed control with no explanation
 * is the thing this component exists to prevent.
 */
const DEVICE_REASON: Record<BlockedRoomScanAvailability["status"], string> = {
  checking: "Checking whether this device can scan.",
  // States what this device REPORTED, then what scanning needs. The old wording led with the
  // accusation ("Needs an iPhone Pro or iPad Pro"), which is wrong anywhere the report is not
  // actually about the hardware — the iOS Simulator answers `isSupported: false` too, so a build
  // under test blamed the tester's phone for being the wrong phone.
  "no-lidar": "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro.",
  "no-native-app": "Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor.",
  // NOT "close the app and open it again". This status means the MalletRoomScan plugin is not
  // registered on the Capacitor bridge — the shell registers it from a static manifest in
  // capacitorDidLoad, so a shell BUILD that shipped without that entry has a bridge and no
  // scanner — or the plugin's own probe never answered. A restart cannot fix either one, and
  // telling someone to restart makes a permanent defect look like a glitch they caused. A newer
  // build is the only real next step, and the App Store is where a build comes from.
  "scanner-missing":
    "This version of the Mallet app is missing the room scanner — update the app in the App Store.",
};

/** The reason for every blocker that is NOT about the device. */
const BLOCKER_REASON: Record<Exclude<ScanBlocker["kind"], "device">, string> = {
  "job-closed": "This job is closed — reopen it to scan a room.",
  "no-customer": "Pick a customer first — a room scan attaches to one of their jobs.",
};

/** The exact sentence a given blocker shows. The one place any caller or test reads this copy. */
export function scanBlockerReason(blocker: ScanBlocker): string {
  return blocker.kind === "device"
    ? DEVICE_REASON[blocker.availability.status]
    : BLOCKER_REASON[blocker.kind];
}

/** Test/verifier helper: the sentence a given blocked DEVICE status shows. */
export function scanUnavailableReason(status: BlockedRoomScanAvailability["status"]): string {
  return DEVICE_REASON[status];
}

export interface ScanUnavailableProps {
  /** Why scanning is blocked. A live `ready` device is not a blocker — render the real control. */
  blocker: ScanBlocker;
  /** The verb this surface uses when scanning IS available ("Scan a room", "Re-scan room", …). */
  label: string;
  /**
   * Which control shape this surface's live scan affordance has, so the disabled one matches it:
   * `button` for the `.btn` surfaces, `link` for the room card's `.linklike` row.
   */
  variant?: "button" | "link";
}

export function ScanUnavailable({ blocker, label, variant = "button" }: ScanUnavailableProps) {
  const reasonId = useId();
  const className = variant === "link" ? "linklike scanbtn" : "btn sm scanbtn";

  return (
    <>
      <button type="button" className={className} disabled aria-describedby={reasonId}>
        {label}
      </button>
      <p className="scanwhy" id={reasonId}>
        {scanBlockerReason(blocker)}
      </p>
    </>
  );
}
