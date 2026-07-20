"use client";

/**
 * components/shared/write-error-toast.tsx
 * Announces a rolled-back optimistic write.
 *
 * Mounted once per shell. Subscribes to the store's write-error seam and renders
 * the failure in a polite live region so it is both seen and announced — the
 * user's change reverting is otherwise completely silent.
 *
 * Anchored to the bottom of the content column (not floating over it), per the
 * no-floating-UI rule.
 */

import { useEffect, useState } from "react";
import { subscribeWriteErrors, type WriteError } from "@/lib/store/write-error";

/** How long a failure stays on screen before it clears itself. */
const DISMISS_MS = 8000;

export function WriteErrorToast() {
  const [current, setCurrent] = useState<WriteError | null>(null);

  useEffect(() => subscribeWriteErrors(setCurrent), []);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), DISMISS_MS);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <div className="werr-live" role="status" aria-live="polite">
      {current && (
        <div className="werr" key={current.seq}>
          <span className="werr-msg">{current.message}</span>
          <button className="werr-x" onClick={() => setCurrent(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
