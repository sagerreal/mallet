/**
 * lib/task-dates.ts — the ONE clock for task due-dates. Mirrors the prototype's
 * isOverdue/dueLabel semantics: Today / Tomorrow / Yesterday / "N days late" /
 * weekday within a week / "Jul 9". Uses the live clock (todayISO) so dates render
 * correctly against the real calendar; pinned to 2026-07-01 in tests via the
 * vi.mock in vitest.setup.ts.
 */

import { todayISO } from "@/lib/clock";
import type { Task } from "@/lib/store/types";

const DAY_MS = 86_400_000;

function noon(iso: string): number {
  return new Date(iso + "T12:00:00").getTime();
}

export function isOverdue(t: Task): boolean {
  return !t.done && t.due != null && t.due < todayISO();
}

export function dueLabel(iso: string | null): string {
  if (!iso) return "";
  const today = todayISO();
  const diff = Math.round((noon(iso) - noon(today)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${-diff} days late`;
  const d = new Date(iso + "T12:00:00");
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Tomorrow on the live clock — the default due for a new task. */
export function tomorrowISO(): string {
  const d = new Date(todayISO() + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
