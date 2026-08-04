/**
 * Client island for /pay/success: fire the server-side reconcile with the session_id Stripe
 * substituted into the return URL, then upgrade the copy to "Payment confirmed" when the ledger
 * verifiably holds the money. Graceful by design — the webhook is the PRIMARY recorder, so a
 * missing param, a slow network or a 503 here just leaves the generic success copy standing.
 */
"use client";

import { useEffect, useState } from "react";
import { PayResult } from "../pay-result";

export function SuccessConfirm() {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    // Read from the window rather than useSearchParams: no Suspense boundary needed, and the
    // param is optional anyway (older links carry no session_id).
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId || !sessionId.startsWith("cs_")) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/public/pay/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) return; // the webhook records it — keep the generic copy
        const data = (await res.json()) as { recorded?: boolean };
        if (!cancelled && data.recorded === true) setConfirmed(true);
      } catch {
        // Network failure — same graceful fallback; nothing to surface to the customer.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <PayResult variant={confirmed ? "confirmed" : "success"} />;
}
