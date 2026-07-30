"use client";

/**
 * features/home/home-pipe.tsx
 * The Pipe — the shop's money in one line of sight, flowing through the process.
 * Presentational: takes the derived stages, renders one clickable cell each with
 * a flow chevron between them. Leaks glow amber. Derivation + figures in pipe.ts.
 */

import Link from "next/link";
import type { PipeStage } from "./pipe";

/**
 * Cold-load stand-in for the pipe: six cells with the same box structure as the real
 * .hpcell (label/value/sub lines), so the tiles never state zeros-from-an-empty-store
 * as fact and nothing shifts when the real figures arrive.
 */
export function HomePipeSkeleton() {
  return (
    <div className="hpipe" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="hpcell">
          <span className="l"><span className="sk" style={{ display: "inline-block", width: 56, height: 10 }} /></span>
          <span className="v"><span className="sk" style={{ display: "inline-block", width: 44, height: 22 }} /></span>
          <span className="s"><span className="sk" style={{ display: "inline-block", width: 88, height: 10 }} /></span>
        </div>
      ))}
    </div>
  );
}

export function HomePipe({ stages }: { stages: PipeStage[] }) {
  return (
    <nav className="hpipe" aria-label="Where your money sits">
      {stages.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          className={`hpcell${s.leak ? " leak" : ""}`}
        >
          <span className="l">{s.label}</span>
          <span className="v">{s.value}</span>
          <span className="s">
            {s.red && <span className="red">{s.red}</span>}
            {s.red && s.sub ? " · " : ""}
            {s.sub}
          </span>
        </Link>
      ))}
    </nav>
  );
}
