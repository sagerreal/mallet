/**
 * lib/task-dates.ts — the ONE clock for task due-dates, built on the app's frozen
 * TODAY_ISO sample clock. Mirrors the prototype's isOverdue/dueLabel semantics:
 * Today / Tomorrow / Yesterday / "N days late" / weekday within a week / "Jul 9".
 */

import { TODAY_ISO } from "@/lib/prototype-sample";
import type { Task } from "@/lib/store/types";

const DAY_MS = 86_400_000;

function noon(iso: string): number {
  return new Date(iso + "T12:00:00").getTime();
}

export function isOverdue(t: Task): boolean {
  return !t.done && !!t.due && t.due < TODAY_ISO;
}

export function dueLabel(iso: string): string {
  if (!iso) return "";
  const diff = Math.round((noon(iso) - noon(TODAY_ISO)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${-diff} days late`;
  const d = new Date(iso + "T12:00:00");
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Tomorrow on the app clock — the default due for a new task. */
export function tomorrowISO(): string {
  const d = new Date(TODAY_ISO + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
