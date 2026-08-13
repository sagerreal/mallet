"use client";

/**
 * components/shared/tap-to-pay-education.tsx
 *
 * Merchant education for Tap to Pay (Apple v1.6 §4), and the "Try It Out" screen the review
 * checklist requires after it.
 *
 * 4.1 IS A SHORTCUT AND WE TAKE IT. Apple: "Use ProximityReaderDiscovery to educate merchants on
 * iOS 18 and later. (This fulfils requirements 4.4, 4.6…)" — their own system UI discharges
 * several education requirements at once, and it is guaranteed current when Apple changes what
 * the tap gesture looks like. So on iOS 18+ the primary action hands off to
 * `MalletTapToPay.presentEducation()` (the plugin wraps ProximityReaderDiscovery) and the
 * screens below are the FALLBACK for older iOS and for anyone re-reading it later from Settings.
 *
 * The fallback still has to cover:
 *   4.5 accepting contactless cards · 4.6 accepting Apple Pay and other digital wallets.
 *
 * DELIBERATELY NOT COVERED, because Mallet is US-only at launch (the entitlement request says so):
 *   4.7 PIN entry — every region except JP/TW.
 *   4.8 fallback payment method — CA, GL, IE, IM, JE, UK.
 * Both are "Conditional on Region". Shipping either would be inventing a flow with nothing behind
 * it; the moment a second country is added, they become required and this comment is the reminder.
 *
 * 4.2 renders this immediately after the terms are accepted; 4.3 makes the same component
 * reachable later from Settings.
 */

import { WaveRightCircle } from "./tap-to-pay-button";

/** One thing the merchant can accept, and what to tell the customer to do. */
const ACCEPTS = [
  {
    title: "Contactless cards",
    body: "Hold the card flat against the top of your iPhone, near the camera. Keep it there until you see the checkmark.",
  },
  {
    title: "Apple Pay and digital wallets",
    body: "The customer double-clicks their side button, then holds their phone or watch to the top of yours.",
  },
] as const;

export interface TapToPayEducationProps {
  /** Hand off to Apple's own ProximityReaderDiscovery UI when the shell can (iOS 18+, 4.1). */
  readonly onSystemEducation?: () => void;
  /** The Try It Out screen — a $0.00 test transaction. Checklist: "a dedicated screen inviting them to try it out." */
  readonly onTryItOut?: () => void;
  /** Reading it later from Settings rather than straight after acceptance (4.3) — no Try It Out CTA. */
  readonly revisiting?: boolean;
}

export function TapToPayEducation({
  onSystemEducation,
  onTryItOut,
  revisiting = false,
}: TapToPayEducationProps) {
  return (
    <div className="ttp-edu">
      <div className="ttp-edu-h">
        <WaveRightCircle size={26} />
        <div>
          <h3>Tap to Pay is on</h3>
          <p className="muted">Your iPhone is the card reader. Nothing else to carry.</p>
        </div>
      </div>

      {ACCEPTS.map((a) => (
        <div className="ttp-edu-row" key={a.title}>
          <b>{a.title}</b>
          <p className="muted">{a.body}</p>
        </div>
      ))}

      {/* 4.1 — Apple's own walkthrough, which is always current and covers 4.4/4.6 by itself. */}
      {onSystemEducation ? (
        <button type="button" className="btn" onClick={onSystemEducation}>
          Show me how it works
        </button>
      ) : null}

      {/* The checklist's own words: a dedicated screen inviting them to try it out. */}
      {!revisiting && onTryItOut ? (
        <button type="button" className="btn primary" onClick={onTryItOut}>
          Try it out — no charge
        </button>
      ) : null}

      <p className="muted ttp-edu-foot">
        You can read this again any time under Settings → Payments.
      </p>
    </div>
  );
}
