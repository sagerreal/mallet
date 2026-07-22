/**
 * components/modals/tech-job-modal/field-timer.tsx
 * Field timer (prototype fieldTimer, 4785) — the big field clock, the hero when
 * the job is NOT done. Running → red .tjclock.run + live elapsed + "● on the
 * clock — tap to stop"; idle → the green .tjclock + "0:00" (or resume-so-far) +
 * "Start timer" / "Resume timer".
 *
 * Elapsed is LOCAL state: a setInterval ticks every 1s while running and is
 * cleared on pause / unmount. Start → running; Pause → keep elapsed, stop
 * ticking; the elapsed persists while the modal is open.
 * deferred: persist timer + log to timesheets (across close + payroll punch)
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Visit } from "@/lib/store/types";
import { clockLabel } from "./helpers";

interface FieldTimerProps {
  visit: Visit;
}

export function FieldTimer({ visit }: FieldTimerProps) {
  // baseSec: accumulated seconds from prior run segments (survives pause).
  const [baseSec, setBaseSec] = useState(0);
  const [running, setRunning] = useState(false);
  // startedAt: wall-clock ms when the current run segment began (null when paused).
  const startedAtRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick every 1s while running; clear on pause / unmount.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Clamped ≥ 0: a clock skew / stale ref can never render a negative elapsed.
  const liveSec = Math.max(
    0,
    baseSec + (running && startedAtRef.current != null ? (now - startedAtRef.current) / 1000 : 0),
  );
  const elapsedH = liveSec / 3600;

  function start() {
    startedAtRef.current = Date.now();
    setNow(Date.now());
    setRunning(true);
  }

  function pause() {
    // Capture BEFORE queuing state updates: the setBaseSec updater runs after
    // this function nulls the ref (React batches), so reading the ref lazily
    // inside the updater added `Date.now() - 0` (epoch seconds) per pause.
    const startedAt = startedAtRef.current;
    if (running && startedAt != null) {
      const segmentSec = Math.max(0, (Date.now() - startedAt) / 1000);
      setBaseSec((s) => s + segmentSec);
    }
    startedAtRef.current = null;
    setRunning(false);
  }

  if (running) {
    return (
      <button className="tjclock run" onClick={pause}>
        <span className="tjclock-time">{clockLabel(elapsedH)}</span>
        <span className="tjclock-lbl">● on the clock — tap to stop</span>
      </button>
    );
  }

  const hasElapsed = baseSec > 0;
  return (
    <div>
      <button className="tjclock" onClick={start}>
        <span className="tjclock-time">{hasElapsed ? clockLabel(elapsedH) : "0:00"}</span>
        <span className="tjclock-lbl">{hasElapsed ? "Resume timer" : "Start timer"}</span>
      </button>
    </div>
  );
}
