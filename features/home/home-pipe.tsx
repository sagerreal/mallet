"use client";

/**
 * features/home/home-pipe.tsx
 * The Pipe — the shop's money in one line of sight, flowing through the process.
 * Presentational: takes the derived stages, renders one clickable cell each with
 * a flow chevron between them. Leaks glow amber. Derivation + figures in pipe.ts.
 */

import Link from "next/link";
import type { PipeStage } from "./pipe";

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
