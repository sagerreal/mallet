"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { isStaleDeployError } from "@/lib/stale-deploy-error";

/**
 * components/shared/route-error.tsx
 * The crash screen behind every route error boundary.
 *
 * Two jobs beyond the message: LOG the error (the boundary used to swallow it whole, so a
 * "Something went wrong" report came with an empty console and could not be diagnosed), and
 * self-heal the one crash whose cure is known — a stale tab importing chunks a newer deploy
 * replaced reloads itself once to pick up the new build.
 */

/** One automatic reload per session — a genuine crash loop must land on the screen, not spin. */
const RELOADED_FLAG = "mallet-stale-deploy-reloaded";

/** True exactly once per session. Storage denied (private mode) counts as spent: never loop. */
function claimReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FLAG) !== null) return false;
    sessionStorage.setItem(RELOADED_FLAG, "1");
    return true;
  } catch {
    return false;
  }
}

export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Deliberate: this is the one place a crash is guaranteed to surface for a user report.
    // eslint-disable-next-line no-console
    console.error(error);
    if (isStaleDeployError(error) && claimReload()) window.location.reload();
  }, [error]);

  return (
    <div style={{ padding: "var(--space-6)" }}>
      <p style={{ fontWeight: 500 }}>Something went wrong.</p>
      <Button variant="quiet" style={{ marginTop: "var(--space-3)" }} onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
