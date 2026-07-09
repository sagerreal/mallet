/**
 * features/counter/run-block.tsx
 * The run receipt: rows tick in one at a time (legibility pacing — the scan
 * itself is instant and local), asides route the human things back to the
 * human, and the whole run parks at ONE amber gate. "look at each" opens the
 * exact texts for the trust-building weeks; nothing sends until the owner says.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { clockNow } from "@/features/home/send";
import type { Artifact, OpenRef } from "./types";

const TICK_MS = 450;

interface RunHandlers {
  onSendAll: () => void;
  onUndo: () => void;
  onOpen: (ref: OpenRef) => void;
  onRun: (input: string) => void;
}

export function RunBlock({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "run" }>;
  h: RunHandlers;
}) {
  const totalRows = artifact.steps.length + artifact.asides.length;
  const [shown, setShown] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const stampsRef = useRef<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep each landing row in view as the receipt ticks in.
  useEffect(() => {
    const menu = rootRef.current?.closest(".cmd-menu");
    if (menu) menu.scrollTop = menu.scrollHeight;
  }, [shown, expanded]);

  useEffect(() => {
    if (shown >= totalRows) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      while (stampsRef.current.length < totalRows) stampsRef.current.push(clockNow());
      setShown(totalRows);
      return;
    }
    const iv = setInterval(() => {
      setShown((n) => {
        if (n >= totalRows) return n;
        stampsRef.current.push(clockNow());
        return n + 1;
      });
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [shown, totalRows]);

  const done = shown >= totalRows;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const secs = artifact.sent
    ? Math.max(0, Math.ceil((artifact.sent.expiresAt - Date.now()) / 1000))
    : 0;

  return (
    <div className="ct-block" aria-live="polite" ref={rootRef}>
      <div className="ct-head">{artifact.headline}</div>

      {artifact.steps.slice(0, shown).map((st, i) => (
        <div key={st.key} className="ct-runrow">
          <div className="ledgerrow" style={{ paddingBottom: 2 }}>
            <b className="fig" style={{ whiteSpace: "nowrap" }}>{stampsRef.current[i] ?? ""}</b>
            <span style={{ minWidth: 0 }}>
              ✓ {st.title}
              {st.fig && <b className="fig"> · {st.fig}</b>}
              {st.open && (
                <>
                  <span className="ct-dim"> · </span>
                  <button
                    type="button"
                    className="linklike"
                    style={{ fontSize: 12 }}
                    onClick={() => h.onOpen(st.open as OpenRef)}
                  >
                    {st.open.label} ›
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="ct-runsub">{st.sub}</div>
          {expanded && !artifact.sent && <div className="ct-ghost ct-runghost">{st.draft}</div>}
        </div>
      ))}

      {artifact.asides.map((a, i) =>
        shown > artifact.steps.length + i ? (
          <div key={a.leadId} className="ct-runrow">
            <div className="ledgerrow" style={{ paddingBottom: 2 }}>
              <b className="fig" style={{ whiteSpace: "nowrap" }}>
                {stampsRef.current[artifact.steps.length + i] ?? ""}
              </b>
              <span className="ct-aside" style={{ minWidth: 0 }}>
                ⚠ {a.reason}
                <span className="ct-dim"> · </span>
                {a.verb ? (
                  <button
                    type="button"
                    className="linklike"
                    style={{ fontSize: 12 }}
                    onClick={() => h.onRun(a.verb?.input ?? "")}
                  >
                    {a.verb.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="linklike"
                    style={{ fontSize: 12 }}
                    onClick={() => h.onOpen(a.open)}
                  >
                    {a.open.label} ›
                  </button>
                )}
              </span>
            </div>
          </div>
        ) : null
      )}

      {done && artifact.steps.length > 0 && !artifact.sent && (
        <div className="ct-runfoot">
          <div className="ct-confirm" style={{ marginBottom: 8 }}>
            <b>
              {artifact.mode === "estimates"
                ? `${artifact.steps.length} ${artifact.steps.length === 1 ? "quote" : "quotes"} drafted · ${fmt(artifact.totalChased)} on the table · nothing sent yet`
                : `${artifact.steps.length} ${artifact.steps.length === 1 ? "text" : "texts"} staged · ${fmt(artifact.totalChased)} chased · nothing sent yet`}
            </b>
          </div>
          <div className="ct-actions">
            <button className="btn sm approve" onClick={h.onSendAll}>
              Send all {artifact.steps.length}
            </button>
            <button className="btn sm ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "fold them up" : "look at each"}
            </button>
            <span className="ct-dim" style={{ fontSize: 12 }}>
              {artifact.mode === "estimates"
                ? "or leave it — they're in your Quotes"
                : "or leave it — they're on Home"}
            </span>
          </div>
        </div>
      )}

      {artifact.sent && (
        <div className="ledgerrow">
          <b className="fig" style={{ whiteSpace: "nowrap" }}>{artifact.sent.when}</b>
          <span style={{ minWidth: 0 }}>
            {artifact.mode === "estimates"
              ? `✓ sent ${artifact.steps.length} — ${fmt(artifact.totalChased)} of quotes out the door`
              : `✓ sent ${artifact.steps.length} — ${fmt(artifact.totalChased)} chased, all in the threads`}
            {secs > 0 && (
              <>
                <span className="ct-dim"> · </span>
                <button type="button" className="linklike" onClick={h.onUndo}>
                  Undo · {secs}s
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
