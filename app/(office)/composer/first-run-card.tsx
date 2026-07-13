"use client";

/**
 * First-run intro for the estimator bar — shows WHAT the machine reads, once.
 * Renders under the bar until the user either dismisses it or completes their
 * first draft; after that the bar stands alone (the placeholder carries it).
 * Seen-state lives in localStorage — a hint, not data, so client-local is fine.
 */

import { useEffect, useState } from "react";

const SEEN_KEY = "mallet.composer.introSeen";

export function useFirstRunIntro(aiDrafted: boolean): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(SEEN_KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);

  // The first completed draft is the real intro — the card has done its job.
  useEffect(() => {
    if (aiDrafted && show) {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        // storage unavailable — the card simply shows again next visit
      }
      setShow(false);
    }
  }, [aiDrafted, show]);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage unavailable — dismiss for this session only
    }
    setShow(false);
  }

  return { show, dismiss };
}

const COLUMNS: { title: string; lines: string[] }[] = [
  { title: "Reads the job", lines: ["customer texts", "call & web requests", "the tech's scope notes"] },
  { title: "Prices like you", lines: ["your pricebook", "your labor rates"] },
  { title: "Checks your wins", lines: ["quotes customers", "already said yes to"] },
];

export function FirstRunCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="introcard">
      <div className="introcols">
        {COLUMNS.map((c) => (
          <div key={c.title} className="introcol">
            <div className="introcol-title">{c.title}</div>
            {c.lines.map((l) => (
              <div key={l} className="introcol-line fig">
                {l}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="introfoot">
        <span>
          Correct it once — <b>it remembers for next time.</b>
        </span>
        <button type="button" className="linklike" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
