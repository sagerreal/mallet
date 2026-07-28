"use client";

/**
 * Message section — the intro that leads the quote text/email, the terms
 * attached to the quote, and the price-valid window. Boxed card shell;
 * collapsible in-flow.
 *
 * The intro (or the auto-intro fallback) IS the lead text of the send body —
 * see buildQuoteMessageBody in composer-state.ts. Terms come from the real
 * job_terms library (settings store, hydrated by SettingsHydrator); selecting
 * one SNAPSHOTS its text into the draft payload (terms_snapshot) — later term
 * edits never rewrite a sent quote. "None" attaches nothing.
 */

import { useAppStore } from "@/lib/store/app-store";
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
  // Real job_terms from settings (t = title, body = the text that snapshots).
  const terms = useAppStore((s) => s.terms);
  const selectedTerm = state.terms
    ? terms.find((t) => t.id === state.terms!.id) ?? null
    : null;

  function selectTerms(id: string) {
    if (id === "") {
      onUpdate({ terms: null });
      return;
    }
    const term = terms.find((t) => t.id === id);
    // Freeze the TEXT at selection — snapshot semantics.
    onUpdate({ terms: term ? { id: term.id, text: term.body } : null });
  }

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
            {state.terms ? ` · terms: ${selectedTerm?.t ?? "attached"}` : ""}
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
                style={{ fontSize: "var(--type-xs)", textAlign: "right", marginTop: "var(--space-2xs)" }}
              >
                {state.intro.length}/{INTRO_MAX_CHARS}
                {state.intro.length >= INTRO_MAX_CHARS ? " — at the limit" : ""}
              </div>
            )}
          </div>
          <div className="field">
            <label>
              Terms{" "}
              <span className="muted">
                (shown on the quote page — attached as written now)
              </span>
            </label>
            <select
              value={state.terms?.id ?? ""}
              onChange={(e) => selectTerms(e.target.value)}
              aria-label="Terms"
              style={{ maxWidth: 320 }}
            >
              <option value="">None</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.t}
                </option>
              ))}
            </select>
            {state.terms && (
              <p
                className="muted"
                style={{
                  fontSize: "var(--type-sm)",
                  whiteSpace: "pre-wrap",
                  margin: "var(--space-2) 0 0",
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {state.terms.text}
              </p>
            )}
          </div>
          <div className="field" style={{ maxWidth: 200, marginBottom: "0" }}>
            <label>Price valid (days)</label>
            <input
              type="number"
              inputMode="decimal"
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
