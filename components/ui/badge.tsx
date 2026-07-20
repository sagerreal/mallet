import type { ReactNode } from "react";

const TONE = {
  neutral: "gray",
  amber: "amber",
  red: "red",
  blue: "blue",
  green: "green",
} as const;

export type BadgeTone = keyof typeof TONE;

/** Static status/label pill — renders the prototype `.pill`. For stage/status
 *  dots use SoftPill (components/shared/stage-pill); this is the flat variant. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`pill ${TONE[tone]}`}>{children}</span>;
}
