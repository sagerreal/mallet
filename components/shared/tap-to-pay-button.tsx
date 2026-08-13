"use client";

/**
 * components/shared/tap-to-pay-button.tsx
 *
 * The Tap to Pay control in the close-out pay block, built to Apple's checkout requirements
 * (Tap to Pay on iPhone App & Marketing Requirements and Review Guide v1.6, §5).
 *
 * THIS REPLACES A DISABLED BUTTON, AND THE REASON IS WORTH WRITING DOWN. PR1 shipped Tap to Pay
 * as visible-but-`disabled`-with-a-reason — the room-scan honesty pattern, and the right instinct
 * for shipping before the entitlement existed. Apple's 5.3 forbids exactly that:
 *
 *   "The button that activates Tap to Pay on an iPhone should never be altered, greyed out, or
 *    otherwise obscured, regardless of whether the user has enabled Tap to Pay on iPhone. If the
 *    user hasn't yet enabled it, pressing the button will automatically open the acceptance of
 *    Tap to Pay on iPhone Terms and Conditions."
 *
 * So "not enabled yet" is NOT a disabled state — it is the entry point to enrolment. A shop that
 * has never turned Tap to Pay on taps this and lands in the T&C flow, which is a better product
 * than a greyed-out control explaining itself, and discharges 3.7 (a trigger to enable inside
 * checkout) at the same time.
 *
 * WHAT IS STILL DISABLED, AND WHY THAT IS COMPLIANT. 5.3 is *Conditional* — conditioned on
 * whether the user can accept the terms on their iPhone at all. Three cases genuinely cannot:
 * a browser (no reader), an iPhone too old for the hardware, and a technician who is not
 * authorised to accept terms on the shop's behalf (3.8). Those keep TapToPayUnavailable, which
 * owns every "no" sentence in the app.
 *
 * 5.2 — the caller renders this FIRST in the pay block, above Card/Cash/Check/Bank.
 * 5.5 — the icon is Apple's SF Symbol `wave.3.right.circle`, drawn as inline SVG because the
 *       webview cannot render an SF Symbol directly. Shape and weight follow the symbol; nothing
 *       else may be substituted.
 */

import type { TapToPayAvailability } from "@/lib/native/tap-to-pay";
import { TapToPayUnavailable } from "./tap-to-pay-unavailable";

/**
 * SF Symbol `wave.3.right.circle` (5.5). Inline SVG: three arcs opening right inside a ring,
 * matching the symbol's geometry. `aria-hidden` — the label beside it already names the action.
 */
export function WaveRightCircle({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9 9.2a4 4 0 0 1 0 5.6" />
      <path d="M11.6 7.3a7 7 0 0 1 0 9.4" />
      <path d="M14.2 5.4a10 10 0 0 1 0 13.2" />
    </svg>
  );
}

/** Whether this viewer may accept the Terms & Conditions on the shop's behalf (3.8). */
export type TapToPayRole = "authorized" | "unauthorized";

export interface TapToPayButtonProps {
  readonly availability: TapToPayAvailability;
  /** Has this shop already accepted Apple's Terms & Conditions? Read from the SDK, never cached (1.6). */
  readonly enabled: boolean;
  /** Owner/office may accept terms; a technician may not (3.8, 3.8.1). */
  readonly role: TapToPayRole;
  /** Start a Tap to Pay transaction. Only called when enabled and available. */
  readonly onCollect: () => void;
  /** Open the Terms & Conditions flow — what an un-enabled tap does (5.3). */
  readonly onEnable: () => void;
  /** True while the reader is still configuring — the button says "initializing" (5.7). */
  readonly initializing?: boolean;
}

export function TapToPayButton({
  availability,
  enabled,
  role,
  onCollect,
  onEnable,
  initializing = false,
}: TapToPayButtonProps) {
  // A device that cannot run Tap to Pay at all, or a viewer who cannot accept the terms. Both are
  // 5.3's conditional escape, and both already have a sentence.
  if (availability.status !== "ready") {
    return <TapToPayUnavailable availability={availability} />;
  }
  if (!enabled && role === "unauthorized") {
    return <TapToPayUnavailable availability={availability} unauthorized />;
  }

  // 5.7 — pressed while still configuring, the user sees that it is coming, not a dead tap.
  if (initializing) {
    return (
      <button className="btn copay-tap tap-to-pay" disabled aria-live="polite">
        <b>
          <WaveRightCircle /> Setting up Tap to Pay…
        </b>
        <span>This takes a moment the first time.</span>
      </button>
    );
  }

  // 5.1/5.3 — live in both states. Not enabled yet? The tap opens the terms.
  return (
    <button
      className="btn primary copay-tap tap-to-pay"
      onClick={enabled ? onCollect : onEnable}
    >
      <b>
        <WaveRightCircle /> Tap to Pay on iPhone
      </b>
      <span>
        {enabled
          ? "hold their card or phone to yours"
          : "accept the terms to turn it on — takes a minute"}
      </span>
    </button>
  );
}
