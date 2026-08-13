"use client";

/**
 * components/modals/close-out-tap-step.tsx
 * The Tap to Pay step of the close-out — what the technician sees between pressing the button and
 * knowing whether the money moved.
 *
 * APPLE 5.7–5.9 LIVE HERE:
 *   5.7 an "initializing" screen while the reader configures,
 *   5.8 a "processing" screen after a successful read (Apple's own reader sheet owns most of this;
 *       this covers the window after it dismisses and before the server has answered),
 *   5.9 the outcome stated plainly — approved, declined, or timed out.
 *
 * THE FOURTH OUTCOME IS THE ONE THAT MATTERS. `unreconciled` means the customer's card WAS
 * charged and Mallet has not recorded it. Folding that into "failed" would tell somebody standing
 * at a door that the payment did not work while their customer's card was debited — the single
 * worst thing this screen can say. It gets its own state, its own colour, and a retry that only
 * re-runs the recording half (the reconcile is idempotent server-side, so it never re-charges).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { collectTapToPay, retryTapReconcile, type TapOutcome } from "@/lib/native/tap-to-pay-collect";
import { WaveRightCircle } from "@/components/shared/tap-to-pay-button";
import { fmt$ } from "@/lib/format";

export interface CloseOutTapStepProps {
  readonly invoiceId: string;
  /** Dollars, for the heading — the SERVER derives what it actually charges from the balance. */
  readonly amount: number;
  /** Settled and recorded: hand back to the close-out's existing done step. */
  readonly onPaid: () => void;
  /** Cancelled or abandoned — back to the method list. */
  readonly onBack: () => void;
}

type Phase = "starting" | "collecting" | "settled";

export function CloseOutTapStep({ invoiceId, amount, onPaid, onBack }: CloseOutTapStepProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [outcome, setOutcome] = useState<TapOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);
  // One collection per mount. Without this, a re-render mid-tap starts a second reader session and
  // the plugin's own guard rejects it — which would surface as a spurious error on a working tap.
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase("collecting");
    const result = await collectTapToPay(invoiceId);
    setOutcome(result);
    setPhase("settled");
    if (result.status === "succeeded") onPaid();
  }, [invoiceId, onPaid]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  // 5.7 — the reader is configuring. Named as setup, not as a spinner with no explanation.
  if (phase === "starting") {
    return (
      <div className="tapstep" aria-live="polite">
        <WaveRightCircle size={30} />
        <p className="tapstep-h">Getting the reader ready…</p>
        <p className="muted">This takes a moment the first time.</p>
      </div>
    );
  }

  // 5.8 — the card has been read and the charge is in flight.
  if (phase === "collecting") {
    return (
      <div className="tapstep" aria-live="polite">
        <WaveRightCircle size={30} />
        <p className="tapstep-h">Hold their card to the top of your iPhone</p>
        <p className="muted">{fmt$(amount)} · keep it there until you see the checkmark.</p>
      </div>
    );
  }

  // 5.9 — the outcome, in four honest shapes.
  if (outcome?.status === "succeeded") {
    return (
      <div className="tapstep" aria-live="polite">
        <p className="tapstep-h">Paid — {fmt$(amount)}</p>
        <p className="muted">Recorded against this invoice.</p>
      </div>
    );
  }

  if (outcome?.status === "cancelled") {
    return (
      <div className="tapstep" aria-live="polite">
        <p className="tapstep-h">Cancelled</p>
        <p className="muted">Nothing was charged.</p>
        <div className="tapstep-acts">
          <button type="button" className="btn primary" onClick={() => void run()}>Try again</button>
          <button type="button" className="btn" onClick={onBack}>Another way</button>
        </div>
      </div>
    );
  }

  if (outcome?.status === "unreconciled") {
    return (
      <div className="tapstep tapstep-warn" role="alert">
        <p className="tapstep-h">Card charged — not recorded yet</p>
        {/* Said plainly and first: their customer HAS paid. Whatever else is wrong, nobody should
            walk away thinking they need to charge the card again. */}
        <p>
          The customer was charged {fmt$(amount)}. Mallet hasn&rsquo;t recorded it yet, so the
          invoice still shows a balance.
        </p>
        <p className="muted">{outcome.message}</p>
        <div className="tapstep-acts">
          <button
            type="button"
            className="btn primary"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void retryTapReconcile(invoiceId, outcome.paymentIntentId).then((result) => {
                setRetrying(false);
                setOutcome(result);
                if (result.status === "succeeded") onPaid();
              });
            }}
          >
            {retrying ? "Recording…" : "Record it now"}
          </button>
          <button type="button" className="btn" onClick={onBack}>Leave it for the office</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tapstep tapstep-warn" role="alert">
      <p className="tapstep-h">Tap to Pay didn&rsquo;t go through</p>
      <p className="muted">{outcome?.status === "failed" ? outcome.message : "Nothing was charged."}</p>
      <div className="tapstep-acts">
        <button type="button" className="btn primary" onClick={() => void run()}>Try again</button>
        <button type="button" className="btn" onClick={onBack}>Another way</button>
      </div>
    </div>
  );
}
