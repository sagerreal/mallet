"use client";

/**
 * Good / Better / Best modes — the describe-the-job prompt and the 3-option
 * review grid. Extracted from the composer page; behavior unchanged.
 *
 * Deferred (intentional no-op — tracked punch-list item):
 *   - descMic() / 🎤 — no speech API in the app yet
 */

import { fmt$ } from "@/lib/format";
import type { Lead } from "@/lib/store/types";
import {
  gbbFor,
  gbbTierTotal,
  jobTypeOf,
  type ComposerState,
} from "./composer-state";

// ---- GBB prompt mode --------------------------------------------------------

export function GBBPromptMode({
  state,
  onUpdate,
  selectedLead,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  selectedLead: Lead | null;
}) {
  return (
    <div className="card">
      <h3>3 options — describe the job once</h3>
      <div className="field">
        <textarea
          rows={3}
          placeholder="e.g. 40-gal water heater is leaking — replace, haul away, bring to code"
          value={state.desc}
          onChange={(e) => onUpdate({ desc: e.target.value })}
        />
      </div>
      {state.desc && (
        <p className="muted" style={{ fontSize: "11.5px", margin: "-4px 0 8px" }}>
          Pre-filled from intake.
        </p>
      )}
      <button
        className="btn primary"
        onClick={() => {
          // Pick the GBB seed by job type; recommended tier's lines seed the builder.
          const type = jobTypeOf(state.desc + " " + (selectedLead?.job ?? ""));
          const gbb = gbbFor(type, state.lines);
          const rec = gbb.opts.find((o) => o.k === gbb.rec) ?? gbb.opts[0];
          onUpdate({
            mode: "gbb-review",
            gbb,
            gbbType: type,
            lines: (rec?.lines ?? []).map((l) => ({ ...l })),
          });
        }}
      >
        Build 3 options
      </button>
      <button
        className="btn"
        style={{ marginLeft: 8 }}
        onClick={() => {
          // deferred: no speech API — dictate is a no-op for now
        }}
        title="talk it instead of typing it"
      >
        🎤
      </button>
      <span className="muted" style={{ marginLeft: 10 }}>
        from your pricebook + trade seed knowledge — every line editable
      </span>
    </div>
  );
}

// ---- GBB review mode --------------------------------------------------------

export function GBBReviewMode({
  state,
  onUpdate,
  onEditTier,
  onSendAll3,
  onPreview,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onEditTier: (k: "good" | "better" | "best") => void;
  onSendAll3: () => void;
  onPreview: () => void;
}) {
  const g = state.gbb!;
  const lcN = g.opts.reduce(
    (s, o) => s + o.lines.filter((x) => (x as { lc?: boolean }).lc).length,
    0
  );

  return (
    <>
      <div className="deltabanner">
        <b>Three ways to say yes</b> —{" "}
        {lcN
          ? `⚠ marks the ${lcN} line${lcN === 1 ? "" : "s"} the AI is least sure of; everything else came from your pricebook & trade seeds.`
          : "Every line came from your pricebook & trade seeds."}{" "}
        Customers pick a tier, then tune it with toggles — never restart.
      </div>

      <div
        className="ops-grid"
        style={{ gridTemplateColumns: "repeat(3,1fr)", alignItems: "start" }}
      >
        {g.opts.map((o) => {
          const tot = gbbTierTotal(o);
          const isRec = g.rec === o.k;
          return (
            <div
              key={o.k}
              className="card"
              style={{
                margin: 0,
                border: isRec
                  ? "2px solid var(--green-600)"
                  : undefined,
              }}
            >
              {isRec && (
                <span
                  className="pill green"
                  style={{ float: "right" }}
                >
                  recommended
                </span>
              )}
              <h3 style={{ fontSize: 14, marginBottom: 0 }}>{o.name}</h3>
              <div className="muted" style={{ fontSize: 12 }}>
                {o.title}
              </div>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 19,
                  margin: "6px 0",
                }}
              >
                {fmt$(tot)}
              </div>
              {o.lines.map((x, xi) => (
                <div
                  key={xi}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    padding: "2px 0",
                    gap: 8,
                  }}
                >
                  <span>
                    {(x as { lc?: boolean }).lc ? (
                      <span title="low confidence — generic estimate, worth a glance">
                        ⚠{" "}
                      </span>
                    ) : null}
                    {x.d}
                    {(x.q ?? 1) > 1 ? ` ×${x.q}` : ""}
                  </span>
                  <span className="muted">
                    {fmt$((x.q ?? 1) * (x.r ?? 0))}
                  </span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {o.note}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn sm ghost"
                  onClick={() => onEditTier(o.k)}
                >
                  Edit
                </button>
                {!isRec && (
                  <button
                    className="btn sm ghost"
                    onClick={() => onUpdate({ gbb: { ...g, rec: o.k } })}
                  >
                    ★ Recommend this
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          className="linklike"
          onClick={() =>
            onUpdate({ mode: "builder", gbb: null, gbbType: undefined, gbbEdit: null })
          }
        >
          use a single quote instead
        </span>
        <span style={{ display: "flex", gap: 10 }}>
          <button className="btn ghost" onClick={onPreview}>
            Preview as customer
          </button>
          <button className="btn primary" onClick={onSendAll3}>
            Looks right — send all 3
          </button>
        </span>
      </div>
    </>
  );
}
