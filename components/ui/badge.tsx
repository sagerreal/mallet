import type { ReactNode } from "react";

const tones = {
  neutral: "bg-paper text-ink",
  amber: "bg-amber-bg text-amber",
  red: "bg-red-bg text-red",
  blue: "bg-blue-bg text-blue",
  green: "bg-green-bg text-green",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex rounded-control px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
