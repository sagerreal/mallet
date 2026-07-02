/**
 * components/shared/stage-pill.tsx
 * Reusable stage stamp + source pill — used by Customers list, Pipeline, etc.
 */

import { STAGE_PILL_CLS } from "@/lib/prototype-sample";

export function StagePill({ stage }: { stage: string }) {
  const cls = STAGE_PILL_CLS[stage] ?? "ink";
  return <span className={`stamp ${cls}`}>{stage}</span>;
}

export function SrcPill({ src }: { src: string }) {
  return <span className="pill src">{src}</span>;
}
