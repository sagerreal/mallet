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
 *   - The job stage always runs: with a customer it reads their history;
 *     without one the typed description IS the job info — both true. The
 *     rules stage appears only when rules actually matched, never faked.
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

export interface StageView {
  readonly key: string;
  readonly label: string;
  /** Real-artifact detail, or null while its data is still loading. */
  readonly detail: string | null;
  /** Data present → the stage may tick when its turn comes. */
  readonly ready: boolean;
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

/** Pure stage builder — exported for tests (the honesty rules live here). */
export function stageViews(p: DraftRunProps): StageView[] {
  const stages: StageView[] = [];
  // The job stage always runs: with a customer attached it reads their
  // history (real counts); without one, the typed description IS the job
  // info — both are true statements, so neither renders a fake stage.
  stages.push({
    key: "job",
    label: "Reading the job",
    detail: p.hasLead
      ? p.gather
        ? [
            p.gather.notes > 0 ? plural(p.gather.notes, "note") : null,
            p.gather.texts > 0 ? plural(p.gather.texts, "text") : null,
            p.gather.visitNotes > 0 ? "visit findings" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "your description"
        : null
      : "your description",
    ready: !p.hasLead || p.gather !== null,
  });
  stages.push({
    key: "book",
    label: "Pricing from your book & rates",
    detail:
      p.pricebook.services > 0 || p.pricebook.laborRates > 0
        ? `${plural(p.pricebook.services, "service")} · ${plural(p.pricebook.laborRates, "labor rate")}`
        : "no pricebook yet — typical trade pricing",
    ready: true,
  });
  // The shop's learned rules — rendered ONLY once the draft response confirms
  // rules actually matched (count > 0), i.e. the stage appears on completion.
  // Rendering it while the count was still unknown meant every no-rules shop
  // (the common case) watched the row tick as active, then pop out mid-reveal
  // when the result landed with 0 — the least-flicker honest option is to add
  // it late, never remove it. Zero matches or an old payload without the
  // field → no stage (never a fake stage).
  if ((p.result?.rules?.count ?? 0) > 0) {
    stages.push({
      key: "rules",
      label: "Applying your shop's rules",
      detail: plural(p.result!.rules!.count, "rule"),
      ready: true,
    });
  }
  stages.push({
    key: "won",
    label: "Comparing to quotes you've won",
    detail: p.result
      ? p.result.wonQuotes.count > 0
        ? p.result.wonQuotes.nums.join(", ")
        : "no close matches yet"
      : null,
    ready: p.result !== null,
  });
  stages.push({
    key: "build",
    label: "Writing the quote",
    detail: p.result ? "every line editable" : null,
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
    <div className="runpanel" aria-live="polite">
      <p className="runpanel-head">Building the quote from your shop&rsquo;s numbers</p>
      {stages.map((s, i) => {
        const state = i < ticked ? "done" : i === ticked ? "active" : "pending";
        return (
          <div key={s.key} className={`runstep ${state}`}>
            <div className="runrail">
              <span className="runnode" aria-hidden="true">
                {state === "done" ? "✓" : ""}
              </span>
            </div>
            <div className="body">
              <div className="label">{s.label}</div>
              {state !== "pending" && <div className="detail fig">{s.detail ?? "…"}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
