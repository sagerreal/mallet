"use client";

/**
 * Message section — the intro that leads the quote text/email, plus the
 * price-valid window. Boxed card shell; collapsible in-flow.
 *
 * The intro (or the auto-intro fallback) IS the lead text of the send body —
 * see buildQuoteMessageBody in composer-state.ts. Terms return in a later PR
 * with a terms snapshot on the estimate.
 */

import type { Lead } from "@/lib/store/types";
import type { ComposerState } from "./composer-state";

// Keeps the composed SMS body comfortably under the 1600-char messaging cap
// (intro + ~100 chars of fixed copy + the quote link). maxLength stops input
// at the cap; the counter below makes that visible instead of silent — it
// appears once the intro passes the warn threshold (a long paste lands
// already clipped, and the counter says so).
const INTRO_MAX_CHARS = 1200;
const INTRO_COUNTER_FROM = 1000;

export function MessageCard({
  state,
  onUpdate,
  lead,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  lead: Lead | null;
}) {
  return (
    <div className="card">
      <div className={`reveal${state.msgOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ msgOpen: !state.msgOpen })}
        >
          <span className="caret">▸</span> Message{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — {state.intro ? "custom intro" : "auto intro"} · valid{" "}
            {state.validDays}d
          </span>
        </div>
        <div className="reveal-body">
          <div className="field">
            <label>
              Intro message{" "}
              <span className="muted">
                (leads the text/email — the auto intro covers most sends)
              </span>
            </label>
            <textarea
              rows={2}
              maxLength={INTRO_MAX_CHARS}
              placeholder={`auto: Hi ${lead ? lead.name.split(" ")[0] : "there"} — thanks for having us out.`}
              value={state.intro}
              onChange={(e) =>
                onUpdate({ intro: e.target.value.slice(0, INTRO_MAX_CHARS) })
              }
            />
            {state.intro.length >= INTRO_COUNTER_FROM && (
              <div
                className="muted"
                style={{ fontSize: 11, textAlign: "right", marginTop: 2 }}
              >
                {state.intro.length}/{INTRO_MAX_CHARS}
                {state.intro.length >= INTRO_MAX_CHARS ? " — at the limit" : ""}
              </div>
            )}
          </div>
          <div className="field" style={{ maxWidth: 200, marginBottom: 0 }}>
            <label>Price valid (days)</label>
            <input
              type="number"
              min={1}
              value={state.validDays}
              onChange={(e) =>
                onUpdate({
                  validDays: Math.max(1, +e.target.value || 14),
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
