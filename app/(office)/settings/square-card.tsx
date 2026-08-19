"use client";

/**
 * Settings → "Square" card. Connects the Square account the shop ALREADY uses so Mallet can take
 * card payments into it.
 *
 * The return redirect lands on ?tab=payments&square=… — surfaced once, then stripped from the URL
 * so a refresh does not repeat a stale outcome.
 */

import { useEffect, useState } from "react";
import { FoldCard } from "./fold-card";
import { SquareSetup } from "./square-setup";

type Outcome = "connected" | "failed" | "denied";

const OUTCOME_MESSAGE: Record<Outcome, string> = {
  connected: "Square connected.",
  // Names the likely cause and the next step rather than "an error occurred". The commonest
  // real cause is a consent that sat too long — the state token has a 10-minute life.
  failed: "Couldn't finish connecting to Square. Start again — the sign-in may have timed out.",
  denied: "Connection cancelled — nothing changed.",
};

export function SquareCard() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("square");
    if (raw !== "connected" && raw !== "failed" && raw !== "denied") return;
    setOutcome(raw);
    // Strip it: a refresh must not re-announce an outcome from a flow that already finished.
    url.searchParams.delete("square");
    window.history.replaceState(null, "", url.toString());
  }, []);

  return (
    <FoldCard title="Square" summary="Take cards through the Square account you already use" anchorId="square">
      {outcome && (
        <p
          role="status"
          style={{
            fontSize: "var(--type-sm)",
            color: outcome === "connected" ? "var(--green)" : "var(--ink-2)",
            margin: "0 0 var(--space-2)",
          }}
        >
          {OUTCOME_MESSAGE[outcome]}
        </p>
      )}
      <SquareSetup />
    </FoldCard>
  );
}
