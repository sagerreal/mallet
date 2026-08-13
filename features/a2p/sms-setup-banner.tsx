"use client";

/**
 * features/a2p/sms-setup-banner.tsx
 * The account-level answer to "why won't anything text?" — stated once, app-wide.
 *
 * WHY ONE BANNER AND NOT SIX EXPLANATIONS. Nine send paths need the shop's 10DLC registration.
 * Putting the whole explanation and its call to action beside every one of them is noise, and it
 * is the same paragraph six times on a screen a shop reads every morning. The established shape
 * for a capability blocked pending verification is an account-level notice carrying the reason
 * and the fix, with a single clause at each point of use (see ./sms-blocked). Stripe's
 * "Payment setup in progress" while a Connect capability is under review is the same move.
 *
 * SILENT IN TWO STATES, for different reasons. Active: there is nothing to say. Checking: the
 * hydrator has not landed, and a banner that appears mid-fetch and then disappears is the
 * hydration flash applied to an accusation — see useSmsGate.
 *
 * OFFICE ONLY. It reads the store, which A2pHydrator fills, which mounts in the office layout;
 * and its call to action goes to a Settings page a technician cannot use. The field says its one
 * sentence beside the control instead (SMS_FIELD_NOTE).
 */

import Link from "next/link";
import { useSmsGate } from "./use-sms-ready";

export function SmsSetupBanner() {
  const gate = useSmsGate();

  // `detail` is null in exactly the two silent states, so this one check covers both.
  if (gate.ready || !gate.detail) return null;

  return (
    <div className={`sms-banner${gate.state === "failed" ? " failed" : ""}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span className="txt">{gate.detail}</span>
      {gate.action && <Link href={gate.action.href}>{gate.action.label}</Link>}
    </div>
  );
}
