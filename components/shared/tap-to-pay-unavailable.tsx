"use client";

/**
 * components/shared/tap-to-pay-unavailable.tsx
 *
 * The Tap to Pay affordance while it cannot run: the same control the technician would tap,
 * rendered disabled, with the reason underneath — the ScanUnavailable pattern applied to the
 * close-out pay block. Hiding it would make the feature invisible to everyone it does not yet
 * work for (which today is everyone); a live button would record nothing and lie. Disabled with
 * a named reason informs instead of misleading — that is what keeps it out of "dead button"
 * territory under the house rule.
 *
 * IN THIS APP VERSION EVERY STATUS RENDERS DISABLED, including `ready`: the native plugin does
 * not exist yet, and the web-side collect flow ships WITH it in the next app-shell PR — so even
 * a probe that somehow answered ready has nothing this build could start. `ready` therefore
 * shares the plugin-missing sentence ("arrives with the next app update"), which is the true
 * state of this build, not of the device. When the plugin PR lands, the pay block renders a live
 * button for `ready` and this component keeps owning every other state.
 *
 * COPY. One sentence per status, naming the actual thing in the way and the next step. The
 * native `available()` `reason` string is never shown — diagnostic, not copy.
 *
 * A11Y. Reason wired via `aria-describedby`; real `disabled` (not aria-disabled) keeps it out of
 * the tab order. Reuses `.scanbtn`/`.scanwhy` — the design system's one disabled-control-with-
 * reason treatment — rather than minting a second look for the identical situation.
 */

import { useId } from "react";
import type { TapToPayAvailability } from "@/lib/native/tap-to-pay";

/** What this build can honestly promise once the phone side exists: the next app update. */
const NEXT_UPDATE = "Tap to Pay arrives with the next app update.";

const REASON: Record<TapToPayAvailability["status"], string> = {
  checking: "Checking whether this phone can take Tap to Pay.",
  // See the header: a `ready` device still has no collect flow in THIS build.
  ready: NEXT_UPDATE,
  "plugin-missing": NEXT_UPDATE,
  "no-native-app": "Tap to Pay needs the Mallet iPhone app — this browser can't read a card.",
  "unsupported-device":
    "This iPhone can't take Tap to Pay — it needs a newer iPhone on a current iOS.",
};

/**
 * Apple 3.8.1: a user who may not accept the Terms & Conditions is told who can, rather than
 * being left with a control that refuses. Owner/office accept on the shop's behalf; a technician
 * never does — the terms bind the business, not the person holding the phone.
 */
export const TAP_TO_PAY_UNAUTHORIZED =
  "Ask an owner or the office to turn on Tap to Pay — only they can accept Apple's terms.";

/** The exact sentence a given availability shows. The one place any caller or test reads it. */
export function tapToPayReason(availability: TapToPayAvailability): string {
  return REASON[availability.status];
}

export interface TapToPayUnavailableProps {
  availability: TapToPayAvailability;
  /**
   * The device is fine but THIS viewer may not accept Apple's terms (3.8). A distinct sentence
   * from every device reason: the shop can have Tap to Pay, this person cannot switch it on.
   */
  unauthorized?: boolean;
}

export function TapToPayUnavailable({ availability, unauthorized = false }: TapToPayUnavailableProps) {
  const reasonId = useId();
  return (
    <>
      <button type="button" className="btn copay-tap scanbtn" disabled aria-describedby={reasonId}>
        <b>Tap to Pay</b>
        <span>tap their card on this phone</span>
      </button>
      <p className="scanwhy" id={reasonId}>
        {unauthorized ? TAP_TO_PAY_UNAUTHORIZED : tapToPayReason(availability)}
      </p>
    </>
  );
}
