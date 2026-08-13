"use client";

/**
 * components/modals/close-out-tap-terms-step.tsx
 * Turning Tap to Pay on, from inside the checkout — Apple 5.3's other half.
 *
 * *"If the user hasn't yet enabled it, pressing the button will automatically open the acceptance
 * of Tap to Pay on iPhone Terms and Conditions."* So a shop that has never enabled Tap to Pay
 * taps the button and lands HERE, not on a refusal. It also discharges 3.7 (a trigger to enable
 * inside the checkout flow).
 *
 * MALLET NEVER RENDERS APPLE'S TERMS. Acceptance is a system sheet the Stripe Terminal SDK
 * presents when it first connects the on-device reader — which is what `prepare()` does. So the
 * honest shape of this screen is: say what is about to happen, connect, and let Apple ask. A
 * hand-drawn "I accept" checkbox would be a fabrication of a legal step we do not own.
 *
 * 4.2 — education follows acceptance immediately, which is why success routes into
 * TapToPayEducation rather than straight to the reader.
 */

import { useState } from "react";
import { prepareTapToPay } from "@/lib/native/tap-to-pay-collect";
import { tapToPayPlugin, tapToPayTermsAccepted } from "@/lib/native/tap-to-pay";
import { TapToPayEducation } from "@/components/shared/tap-to-pay-education";
import { WaveRightCircle } from "@/components/shared/tap-to-pay-button";

export interface CloseOutTapTermsStepProps {
  /** Terms accepted and education seen — go take the payment. */
  readonly onAccepted: () => void;
  readonly onBack: () => void;
}

type Phase = "intro" | "connecting" | "educate" | "refused";

export function CloseOutTapTermsStep({ onAccepted, onBack }: CloseOutTapTermsStepProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [message, setMessage] = useState<string | null>(null);

  const enable = async () => {
    setPhase("connecting");
    setMessage(null);
    // Connecting the reader is what makes Apple present its Terms & Conditions sheet.
    await prepareTapToPay();
    // 1.6 — ask Apple whether they accepted. Never infer it from the fact that we asked.
    const accepted = await tapToPayTermsAccepted();
    if (accepted) {
      setPhase("educate");
      return;
    }
    setPhase("refused");
    setMessage("Tap to Pay wasn't turned on. You can try again, or take payment another way.");
  };

  if (phase === "educate") {
    // 4.2 — education immediately after acceptance. 4.1's system walkthrough is offered here
    // because Apple says it fulfils 4.4 and 4.6 by itself.
    return (
      <div className="tapstep">
        <TapToPayEducation
          onSystemEducation={() => void tapToPayPlugin()?.presentEducation?.()}
          onTryItOut={onAccepted}
        />
        <div className="tapstep-acts">
          <button type="button" className="btn primary" onClick={onAccepted}>
            Take this payment
          </button>
        </div>
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <div className="tapstep" aria-live="polite">
        <WaveRightCircle size={30} />
        <p className="tapstep-h">Setting up Tap to Pay…</p>
        <p className="muted">Apple will ask you to accept their terms.</p>
      </div>
    );
  }

  return (
    <div className={`tapstep${phase === "refused" ? " tapstep-warn" : ""}`}>
      <WaveRightCircle size={30} />
      <p className="tapstep-h">Turn on Tap to Pay</p>
      <p className="muted">
        Your iPhone becomes the card reader. Apple asks you to accept their terms once — after that
        it just works.
      </p>
      {message ? <p className="muted">{message}</p> : null}
      <div className="tapstep-acts">
        <button type="button" className="btn primary" onClick={() => void enable()}>
          {phase === "refused" ? "Try again" : "Continue"}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          Another way
        </button>
      </div>
    </div>
  );
}
