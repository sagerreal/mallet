"use client";

/**
 * Message & terms section — intro message, terms select, price-valid days.
 * Extracted from the composer page; behavior unchanged.
 */

import type { Lead } from "@/lib/store/types";
import { TERMS_LIB, type ComposerState } from "./composer-state";

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
    <div className={`reveal${state.msgOpen ? " open" : ""}`}>
      <div
        className="reveal-head"
        onClick={() => onUpdate({ msgOpen: !state.msgOpen })}
      >
        <span className="caret">▸</span> Message &amp; terms{" "}
        <span className="muted" style={{ fontWeight: 500 }}>
          —{" "}
          {state.intro ? "custom intro" : "auto intro"}
          {state.terms != null ? " · terms attached" : ""} · valid{" "}
          {state.validDays}d
        </span>
      </div>
      <div className="reveal-body">
        <div className="field">
          <label>
            Intro message{" "}
            <span className="muted">
              (optional — the auto intro covers most sends)
            </span>
          </label>
          <textarea
            rows={2}
            placeholder={`auto: Hi ${lead ? lead.name.split(" ")[0] : "there"} — thanks for having us out…`}
            value={state.intro}
            onChange={(e) => onUpdate({ intro: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <div className="field" style={{ flex: 2, marginBottom: 0 }}>
            <label>
              Terms{" "}
              <span className="muted">(from your library)</span>
            </label>
            <select
              style={{
                width: "100%",
                border: "1.5px solid var(--line)",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 13,
              }}
              value={state.terms ?? ""}
              onChange={(e) =>
                onUpdate({
                  terms: e.target.value === "" ? null : +e.target.value,
                })
              }
            >
              <option value="">None</option>
              {TERMS_LIB.map((t, i) => (
                <option key={i} value={i}>
                  {t.t}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
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
