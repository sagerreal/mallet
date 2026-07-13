"use client";

/**
 * The staged draft-run reveal — an in-flow checklist of the REAL steps the
 * estimator takes, shown while the model call is in flight.
 *
 * Honesty rules (labor-illusion research: operational transparency raises
 * perceived value ONLY while every displayed fact is true):
 *   - Every count is real: job-info counts come from v1.ai.gatherJobContext
 *     (fired at t=0 alongside the draft), pricebook/rates counts from the
 *     hydrated store, won-quote nums from the draft response itself.
 *   - A stage that ran is shown; a stage that didn't (no lead → no job-info
 *     read) is omitted, never faked.
 *   - Concurrent pacing: the model call starts at t=0 and the fast read
 *     stages play during its dead time — the choreography adds zero latency.
 *     Each stage holds ≥1s so it reads; when the model returns early, the
 *     remaining stages fast-forward.
 */

import { useEffect, useRef, useState } from "react";

export interface DraftRunGather {
  readonly notes: number;
  readonly texts: number;
  readonly visitNotes: number;
}

export interface DraftRunResult {
  readonly wonQuotes: { count: number; nums: string[] };
  /** Matched confirmed shop rules — null when the payload predates the stage
   *  (deploy skew): the stage is then omitted, never faked. */
  readonly rules: { count: number } | null;
}

export interface DraftRunProps {
  /** Whether a persisted lead is attached (adds the job-info stage). */
  hasLead: boolean;
  /** gatherJobContext counts — null while loading. */
  gather: DraftRunGather | null;
  /** Real counts from the hydrated store (pricebook + labor rates). */
  pricebook: { services: number; laborRates: number };
  /** The draft response's stages — null while the model is working. */
  result: DraftRunResult | null;
  /** Fired once, ~350ms after the last stage ticks. */
  onDone: () => void;
}

const STAGE_MS = 1_000; // minimum hold per stage — readable, per NN/g
const FAST_MS = 400; // fast-forward spacing once the model has returned
const DONE_MS = 350;

interface StageView {
  readonly key: string;
  readonly label: string;
  /** Real-artifact detail, or null while its data is still loading. */
  readonly detail: string | null;
  /** Data present → the stage may tick when its turn comes. */
  readonly ready: boolean;
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

function stageViews(p: DraftRunProps): StageView[] {
  const stages: StageView[] = [];
  if (p.hasLead) {
    stages.push({
      key: "job",
      label: "Reading the job",
      detail: p.gather
        ? [
            p.gather.notes > 0 ? plural(p.gather.notes, "note") : null,
            p.gather.texts > 0 ? plural(p.gather.texts, "text") : null,
            p.gather.visitNotes > 0 ? "visit findings" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "no history yet"
        : null,
      ready: p.gather !== null,
    });
  }
  stages.push({
    key: "book",
    label: "Your pricebook & rates",
    detail:
      p.pricebook.services > 0 || p.pricebook.laborRates > 0
        ? `${plural(p.pricebook.services, "service")} · ${plural(p.pricebook.laborRates, "labor rate")}`
        : "no pricebook yet — typical trade pricing",
    ready: true,
  });
  // The shop's learned rules — shown while the count is still unknown (result
  // pending) and kept only when rules actually matched. Zero matches or an
  // old payload without the field → the stage drops out (never a fake stage).
  if (p.result === null || (p.result.rules?.count ?? 0) > 0) {
    stages.push({
      key: "rules",
      label: "Your shop's rules",
      detail: p.result ? plural(p.result.rules?.count ?? 0, "rule") : null,
      ready: p.result !== null,
    });
  }
  stages.push({
    key: "won",
    label: "Comparing against quotes you've won",
    detail: p.result
      ? p.result.wonQuotes.count > 0
        ? p.result.wonQuotes.nums.join(", ")
        : "no close matches"
      : null,
    ready: p.result !== null,
  });
  stages.push({
    key: "build",
    label: "Building the quote",
    detail: p.result ? "done" : null,
    ready: p.result !== null,
  });
  return stages;
}

export function DraftRun(props: DraftRunProps) {
  const stages = stageViews(props);
  const [ticked, setTicked] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const doneFired = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, []);

  // A stage ticks when (a) its data is ready and (b) its minimum hold has
  // passed — 1s each normally, 400ms once the model has already returned.
  const holdMs = props.result !== null ? FAST_MS : STAGE_MS;
  useEffect(() => {
    if (ticked >= stages.length) return;
    const next = stages[ticked]!;
    const due = (ticked + 1) * holdMs;
    if (next.ready && elapsed >= due) setTicked((n) => n + 1);
  }, [elapsed, ticked, stages, holdMs]);

  useEffect(() => {
    if (ticked === stages.length && !doneFired.current) {
      doneFired.current = true;
      const t = setTimeout(props.onDone, DONE_MS);
      return () => clearTimeout(t);
    }
  }, [ticked, stages.length, props.onDone]);

  return (
    <div style={{ padding: "18px 8px 10px" }} aria-live="polite">
      {stages.map((s, i) => {
        const state = i < ticked ? "done" : i === ticked ? "active" : "pending";
        return (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 9,
              padding: "5px 0",
              fontSize: 13,
              opacity: state === "pending" ? 0.35 : 1,
              transition: "opacity .2s",
            }}
          >
            <span style={{ width: 16, textAlign: "center", flexShrink: 0 }} aria-hidden="true">
              {state === "done" ? "✓" : state === "active" ? <span className="run-pulse">●</span> : "·"}
            </span>
            <span style={{ fontWeight: state === "active" ? 700 : 600, color: "var(--ink)" }}>
              {s.label}
            </span>
            {state !== "pending" && s.detail && (
              <span className="muted fig" style={{ fontSize: 12 }}>
                {s.detail}
              </span>
            )}
            {state === "active" && !s.detail && (
              <span className="muted" style={{ fontSize: 12 }}>
                …
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
