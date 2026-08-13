"use client";

/**
 * app/(office)/settings/tap-to-pay-card.tsx
 *
 * Settings → Payments → Tap to Pay. This card is how Mallet satisfies three of Apple's
 * requirements at once (Tap to Pay on iPhone App & Marketing Requirements v1.6):
 *
 *   3.6 — "Your app must allow users to enable Tap to Pay on iPhone outside of the usual
 *          communications and checkout flow, such as through your app settings."
 *   4.3 — "Your app should provide merchant education resources in either the Settings or Help
 *          section for easy reference."
 *   3.4 — it sits directly beneath the Connect onboarding card, so finishing merchant onboarding
 *          lands the shop on the way to turn Tap to Pay on.
 *
 * 3.8 — ONLY AN ADMIN MAY ACCEPT THE TERMS. The whole Settings surface is owner/office already
 * (`ownerOnly` on the Payments tab), so a technician cannot reach this card at all. The close-out
 * button carries the same rule for the field surface, where a tech CAN reach the control.
 *
 * 1.6 — acceptance is read from Apple on every mount, never stored. `useTapToPayTermsAccepted`
 * owns that; nothing here persists a yes.
 *
 * The card is honest on the desktop web, where Tap to Pay can never run: it says the setup
 * happens on the phone rather than offering a button that would fail.
 */

import { useState } from "react";
import { FoldCard } from "./fold-card";
import { TapToPayEducation } from "@/components/shared/tap-to-pay-education";
import { useTapToPayAvailability, useTapToPayTermsAccepted } from "@/lib/native/tap-to-pay";

export function TapToPayCard() {
  const availability = useTapToPayAvailability();
  const accepted = useTapToPayTermsAccepted();
  const [showEducation, setShowEducation] = useState(false);

  const onPhone = availability.status === "ready";

  return (
    <FoldCard
      title="Tap to Pay on iPhone"
      summary={accepted ? "On" : onPhone ? "Not set up" : "iPhone only"}
    >
      <p className="muted" style={{ margin: "0 0 var(--space-3)" }}>
        Take cards and Apple Pay on your iPhone at the door — no reader to buy or carry.
      </p>

      {!onPhone ? (
        // Every non-phone surface. Never a button that cannot work: the setup genuinely has to
        // happen on the device that will be the reader.
        <p className="muted" style={{ margin: 0 }}>
          {availability.status === "unsupported-device"
            ? "This iPhone can't take Tap to Pay — it needs a newer iPhone on a current iOS."
            : "Open Mallet on your iPhone to set this up. Tap to Pay needs the phone that will read the card."}
        </p>
      ) : accepted ? (
        <>
          <p style={{ margin: "0 0 var(--space-3)" }}>
            <b>Tap to Pay is on for this shop.</b>
          </p>
          <button type="button" className="btn" onClick={() => setShowEducation((v) => !v)}>
            {showEducation ? "Hide how it works" : "How it works"}
          </button>
          {/* 4.3 — the same education, reachable again whenever they want it. In-flow, per the
              house rule; never a modal on top of Settings. */}
          {showEducation ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <TapToPayEducation revisiting />
            </div>
          ) : null}
        </>
      ) : (
        // 3.5 — the clear action to accept Apple's Terms & Conditions, outside checkout (3.6).
        <p className="muted" style={{ margin: 0 }}>
          Turning it on takes a minute — Apple asks you to accept their terms the first time. The
          Tap to Pay button on any job will walk you through it.
        </p>
      )}
    </FoldCard>
  );
}
