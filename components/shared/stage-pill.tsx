/**
 * components/shared/stage-pill.tsx
 * Reusable stage pill + source pill — used by Customers list, Pipeline, etc.
 * Renders the soft dot-pill (the dot carries the color), one treatment shared
 * with the lead header, so stage reads the same everywhere in the app.
 */

import { STAGE_PILL_CLS } from "@/lib/prototype-sample";

/** Color keys shared by every soft pill (dot carries the color). */
export type PillTone = "ink" | "info" | "warn" | "good" | "bad";

/** The soft dot-pill primitive — one status/stage treatment for the whole app. */
export function SoftPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={`stage-pill ${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const tone = (STAGE_PILL_CLS[stage] ?? "ink") as PillTone;
  return <SoftPill tone={tone}>{stage}</SoftPill>;
}

export function SrcPill({ src }: { src: string }) {
  return <span className="pill src">{src}</span>;
}
