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
 * CLOSED job, the composer before a customer is picked, and a settings read that never landed —
 * and all three were handled by rendering nothing (or, worse, a LIVE control), which is the same
 * unexplained-absence bug in a different costume. They are now blockers in the same union, so a
 * surface's only options are "live control" or "control plus reason": there is no shape of this
 * component that renders silence.
 *
 * WHY `settings-unknown` IS A BLOCKER AND NOT A REASON TO GO LIVE. The measurement gate fails
 * OPEN on `"unknown"` (lib/measurement-gate.ts) so the affordance is never silently deleted by a
 * failed read. Failing open must mean "still VISIBLE", not "still TAPPABLE": tapping runs
 * `openRoomCard()`, which creates an estimate job server-side, so a live control during a settings
 * outage writes rows into a shop that may have turned measuring off deliberately. Visible +
 * disabled + a stated reason keeps the guideline-4.2 answer on screen and costs a reload.
 *
 * COPY. One sentence per blocker, naming the actual thing in the way and the next step, per the
 * house copy rule. Deliberately NOT collapsed into one generic string: "needs an iPhone Pro" is
 * simply wrong on a desktop, and "open the iPhone app" is useless advice to someone already
 * holding the app. The native `available()` `reason` code is never shown — it is a diagnostic,
 * not copy.
 *
 * ONE CONTROL, ONE SENTENCE — AND ONE SENTENCE FOR TWO CONTROLS WHERE THEY SHARE A BLOCKER.
 * `ScanUnavailable` pairs a single control with its own reason. The composer's room row has two
 * (`+ Add a room` and `Scan room`), so it renders the buttons itself and points both at one
 * `ScanReason`; stacking two sentences under two dimmed buttons reads as noise, and putting the
 * second reason in a `title` was how "+ Add a room" ended up with an invisible one.
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
 *  - `device`           — the hardware/bridge/plugin says no. Carries the native status.
 *  - `settings-unknown` — no settings snapshot has arrived, so whether this shop measures at all
 *                         is unknown (lib/measurement-gate.ts's `"unknown"`).
 *  - `job-closed`       — the job is done, so nothing new may be attached to it.
 *  - `no-customer`      — the composer has no customer picked yet, and a room attaches to one of
 *                         their jobs.
 */
export type ScanBlocker =
  | { readonly kind: "device"; readonly availability: BlockedRoomScanAvailability }
  | { readonly kind: "settings-unknown" }
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
  // The gate is `"unknown"`: no settings snapshot arrived, so we do not know whether this shop
  // measures. The affordance still RENDERS — an unexplained absence is the bug this branch exists
  // to kill — but it must not be LIVE, because tapping it creates an estimate job server-side for
  // a shop that may have switched measuring off on purpose. Disabled with a reload as the next
  // step is the honest trade: a dead row during an outage costs a reload, a live one writes data.
  "settings-unknown": "Couldn't load this shop's settings — reload the page to scan a room.",
  "job-closed": "This job is closed — reopen it to scan a room.",
  // Covers BOTH composer room controls, not just the scanner — "+ Add a room" needs a customer
  // for the same reason, and the two share one reason line (see measured-surfaces-panel).
  "no-customer": "Pick a customer first — a room attaches to one of their jobs.",
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

/**
 * The reason line on its own, so a surface with TWO blocked controls can point both at ONE
 * sentence instead of printing it twice or leaving the second control's reason in a `title`
 * tooltip (invisible on touch, unannounced to a screen reader — the exact defect this file
 * exists to fix). The composer's room row is that surface; every other caller uses
 * `ScanUnavailable`, which renders this itself. The copy and the `.scanwhy` class stay in one
 * place either way.
 */
export function ScanReason({ blocker, id }: { blocker: ScanBlocker; id: string }) {
  return (
    <p className="scanwhy" id={id}>
      {scanBlockerReason(blocker)}
    </p>
  );
}

export function ScanUnavailable({ blocker, label, variant = "button" }: ScanUnavailableProps) {
  const reasonId = useId();
  const className = variant === "link" ? "linklike scanbtn" : "btn sm scanbtn";

  return (
    <>
      <button type="button" className={className} disabled aria-describedby={reasonId}>
        {label}
      </button>
      <ScanReason blocker={blocker} id={reasonId} />
    </>
  );
}
