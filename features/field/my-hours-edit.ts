/**
 * features/field/my-hours-edit.ts
 * The rules deciding what a technician may correct on his own timesheet, what the app may
 * suggest when he left a day open, and why a row is locked when it is.
 *
 * Pure — no React, no network. A timesheet the worker cannot challenge is a weaker record than
 * a paper card (29 CFR 516.2 puts the accuracy burden on the employer, and Anderson v. Mt.
 * Clemens Pottery shifts it further when the record is inadequate), so these rules are the ones
 * a wage claim would actually turn on. They belong somewhere they can be read and tested on
 * their own, not buried in a component.
 */

import { addDaysISO } from "@/lib/clock";
import type { MyHoursEntry } from "./my-hours-derive";

/**
 * How far back a technician may still correct his own hours: the current day plus the previous
 * six. Jobber allows adds only for the CURRENT day; that is too tight here — a plumber who
 * worked Saturday does not open the app again until Monday, and a same-day window would hand
 * every weekend correction to the office, which is the surface this feature exists to take work
 * away from. Seven days also spans a full workweek, so nothing inside the week being approved is
 * out of his reach before the office signs it.
 *
 * This is a CLIENT constraint on a repair tool, not an authorization boundary — the server
 * authorises by ownership (a tech may only touch his own entries) and by approval status.
 */
export const EDIT_WINDOW_DAYS = 7;

/** The dates a technician may still author or correct, most recent first. */
export function editWindowDates(today: string): string[] {
  return Array.from({ length: EDIT_WINDOW_DAYS }, (_, i) => addDaysISO(today, -i));
}

/**
 * ISO dates compare correctly as strings (fixed width, most-significant first), so no Date is
 * constructed here — one less timezone to be wrong about.
 */
export function isWithinEditWindow(workDate: string, today: string): boolean {
  const oldest = addDaysISO(today, -(EDIT_WINDOW_DAYS - 1));
  return workDate >= oldest && workDate <= today;
}

/** Editable, or locked with the reason stated. Never merely disabled — silence reads as a bug. */
export type Editability =
  | { readonly editable: true }
  | { readonly editable: false; readonly reason: string };

const EDITABLE: Editability = Object.freeze({ editable: true });

const NOT_YOURS = "These aren't your hours — the office timesheet edits them.";

const TOO_OLD = `Older than ${EDIT_WINDOW_DAYS} days — ask the office to change it.`;

/** "21 Jul" / "Jul 21" — whichever the technician's own device calls that date. */
const approvedOn = (approvedAt: string | null): string =>
  approvedAt === null
    ? ""
    : ` ${new Date(approvedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

/**
 * Why an approved row is locked, in one line that names the next step. "Disabled" with no
 * explanation is what makes a worker assume the app is broken and stop reporting errors at all.
 */
export function approvedReason(approvedAt: string | null): string {
  return `Approved${approvedOn(approvedAt)} — ask the office to reopen`;
}

/**
 * May this technician correct this row from this surface?
 *
 * Order is deliberate. Ownership first (an owner-operator visiting My hours is served every
 * technician's rows by the list endpoint). Approval next, because approved means locked
 * regardless of age — the shop has signed for those hours and they may already be in QuickBooks.
 */
export function editabilityOf(
  entry: MyHoursEntry,
  today: string,
  myUserId: string | undefined,
): Editability {
  // Unknown identity is not proof of ownership. Until `me` resolves, nothing is editable.
  if (myUserId === undefined || entry.techUserId !== myUserId) {
    return { editable: false, reason: NOT_YOURS };
  }
  if (entry.status === "approved") {
    return { editable: false, reason: approvedReason(entry.approvedAt) };
  }
  // A running row has no end time, so it is not yet a record — it is a hole that blocks approval
  // of the whole week. Closing it is always allowed, however old it is; sending a technician to
  // the office to fix a punch he forgot last Friday is exactly the failure this page removes.
  if (entry.running) return EDITABLE;
  if (!isWithinEditWindow(entry.workDate, today)) {
    return { editable: false, reason: TOO_OLD };
  }
  return EDITABLE;
}

/**
 * The reasons the rows of one day are locked, deduplicated, in the order they appear.
 *
 * Stated once per day rather than once per row: a fully-approved week would otherwise repeat the
 * same sentence twenty times, and repetition is how a real explanation turns into wallpaper the
 * technician stops reading. A day's rows share a date, so "older than a week" is exactly a
 * per-day fact; approval is per row, which is why an approved row also carries its own mark.
 */
export function dayLockNotes(
  dayEntries: readonly MyHoursEntry[],
  today: string,
  myUserId: string | undefined,
): string[] {
  const reasons = dayEntries
    .map((entry) => editabilityOf(entry, today, myUserId))
    .filter((e): e is Extract<Editability, { editable: false }> => !e.editable)
    .map((e) => e.reason);
  return [...new Set(reasons)];
}

/**
 * The end time to OFFER for a day left open: the end of the last completed activity that day.
 * ServiceTitan's rule, with the difference that matters — we suggest and a human accepts. We
 * never close a day on a timer, because inventing hours nobody confirmed is exactly the record
 * that loses a wage claim.
 *
 * Returns null when the day holds nothing later to suggest from. There is no fallback: a guess
 * with no evidence behind it is worse than an empty field the technician has to fill in himself.
 */
export function suggestEndTime(
  dayEntries: readonly MyHoursEntry[],
  running: MyHoursEntry,
): string | null {
  // "HH:MM" is fixed-width and zero-padded, so a string compare IS a chronological compare.
  const candidates = dayEntries
    .filter((e) => e.id !== running.id && e.workDate === running.workDate)
    .map((e) => e.endTime)
    .filter((end): end is string => end !== null && end > running.startTime);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, end) => (end > latest ? end : latest));
}

/** The one row the technician is currently inside, if any. At most one exists per technician. */
/**
 * How old a running segment must be before "your day is still open" is worth saying.
 *
 * The banner is for a day the technician LEFT running — not for the segment they are standing in.
 * Without this it fires three minutes after Start day, on the normal happy path, every time anyone
 * opens the screen. A warning that is usually wrong is a warning people learn to dismiss, and this
 * one has to be believed on the day it matters.
 *
 * Half a shift: long enough that a genuine working segment does not trip it, short enough that
 * yesterday's forgotten punch is flagged before payroll.
 */
export const STALE_OPEN_ENTRY_MS = 6 * 60 * 60 * 1000;

/**
 * The technician's own running entry, but ONLY once it is stale enough to be a forgotten punch
 * rather than the work they are doing right now.
 */
export function openEntryOf(
  entries: readonly MyHoursEntry[],
  myUserId: string | undefined,
  now: Date,
): MyHoursEntry | null {
  if (myUserId === undefined) return null;
  const mine = entries.find((e) => e.running && e.techUserId === myUserId);
  if (!mine) return null;
  return isStaleOpenEntry(mine, now) ? mine : null;
}

/** True when a running entry has been open long enough to need a human to close it. */
export function isStaleOpenEntry(entry: MyHoursEntry, now: Date): boolean {
  const startedMs = startedInstantOf(entry);
  if (startedMs === null) return false;
  return now.getTime() - startedMs > STALE_OPEN_ENTRY_MS;
}

/**
 * The instant a row's wall-clock start refers to, or null when it cannot be read.
 *
 * The row stores a local date plus HH:MM, so this is the shop's wall clock read as the VIEWER's
 * local time. That is exact whenever the technician is in the shop's zone, which is the case being
 * served; it is only used to decide whether to show a prompt, never to compute pay.
 */
function startedInstantOf(entry: MyHoursEntry): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.workDate);
  const time = /^(\d{2}):(\d{2})/.exec(entry.startTime);
  if (!parts || !time) return null;
  const [, y, mo, d] = parts;
  const [, h, mi] = time;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
  ).getTime();
}

/**
 * Why these times cannot be saved, or null. Mirrors the domain invariant (TimeEntry.create
 * rejects end <= start) so the technician is told at the field instead of by a server refusal.
 * The server stays the real boundary — this only makes the refusal legible.
 */
export function timesProblem(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) return "Set both a start and an end time.";
  if (endTime <= startTime) return "The end time has to be after the start time.";
  return null;
}
