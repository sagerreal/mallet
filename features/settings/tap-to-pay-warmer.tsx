"use client";

/**
 * features/settings/tap-to-pay-warmer.tsx
 * Warms the Tap to Pay reader at launch and whenever the app returns to the foreground.
 *
 * Apple 1.5: *"At the launch of your app or when it comes to the foreground, your app must trigger
 * the initial preparation and warming-up of Tap to Pay on an iPhone."*
 *
 * WHY IT IS REQUIRED, AND NOT MERELY POLITE. 5.6 says the Tap to Pay UI must appear within ONE
 * SECOND at least 90% of the time. A cold `connectReader` performs discovery, an account check and
 * possibly a reader software update — seconds, sometimes tens of them on first run. There is no
 * way to make the tap fast at tap-time; the only lever is having already connected. So 1.5 and 5.6
 * are the same requirement seen from either end, and this component is where 5.6 is actually won.
 *
 * SILENT BY CONSTRUCTION. Renders nothing, never throws, never surfaces an error. A speculative
 * warm-up that popped a message at app launch would be worse than a slow tap — and the tap itself
 * connects on demand and reports anything real. `prepareTapToPay` swallows its own failures for
 * the same reason.
 *
 * Mounted in the FIELD layout only: the reader is the phone in the technician's hand, and the
 * office surface has no card to hold to it.
 */

import { useEffect } from "react";
import { prepareTapToPay } from "@/lib/native/tap-to-pay-collect";
import { tapToPayPlugin } from "@/lib/native/tap-to-pay";

export function TapToPayWarmer() {
  useEffect(() => {
    // No plugin (any browser, or a shell without the native build) — nothing to warm, and no
    // network call worth making to find that out.
    if (!tapToPayPlugin()?.prepare) return;

    void prepareTapToPay();

    const onVisible = () => {
      if (document.visibilityState === "visible") void prepareTapToPay();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
