// PURE availability math for the voice front desk — NO I/O, NO Date.now(). The caller passes `now`
// (from a Clock) so this whole file is deterministic and exhaustively unit-testable. It turns the
// org's opening hours + already-booked visits + crew size into at most two speakable slot windows
// (the "two-slot close" the playbook scripts). Date arithmetic is done on CALENDAR dates (rolling a
// YYYY-MM-DD string forward one day at a time), never on millisecond offsets, so a DST transition
// can never drop or duplicate a day.

// The window boundary between the morning and afternoon slots (13:00 local). Named, not magic: the
// playbook says "morning = open→13:00, afternoon = 13:00→close" and this is that 13.
export const WINDOW_BOUNDARY_HOUR = 13;

// The two-slot close: we offer AT MOST this many windows so the caller has a simple either/or, not a
// calendar to read. Earliest two, in time order.
export const MAX_SLOTS = 2;

// The two windows within an open day. `morning` runs from the day's open hour to WINDOW_BOUNDARY_HOUR;
// `afternoon` from WINDOW_BOUNDARY_HOUR to the day's close hour.
export type SlotWindowKind = "morning" | "afternoon";

// One offerable slot. `date` is a calendar date "YYYY-MM-DD"; `startHHMM` is the window's open time
// "HH:MM" (feeds book_visit's scheduledStart in B2); `speakable` is the natural phrase the agent
// reads back ("today 8 to 12", "tomorrow afternoon, 1 to 5", "Thursday morning, 8 to 12").
export interface SlotWindow {
  readonly date: string;
  readonly window: SlotWindowKind;
  readonly startHHMM: string;
  readonly speakable: string;
}

// Opening hours as integer hours in [0, 24]; a CLOSED day is open === 0 && close === 0 (the schema's
// convention). wd = Mon–Fri, sat = Saturday, sun = Sunday.
export interface OrgHours {
  readonly wdOpen: number;
  readonly wdClose: number;
  readonly satOpen: number;
  readonly satClose: number;
  readonly sunOpen: number;
  readonly sunClose: number;
}

// A visit already on the books, as the availability reader returns it. `startHHMM` is null for an
// unplaced-time visit (a date but no time yet); by rule it occupies the MORNING window of its date
// (documented below in windowsOfVisit) so it still reduces availability conservatively.
export interface BookedVisit {
  readonly date: string;
  readonly startHHMM: string | null;
  readonly durationMinutes: number;
}

export interface ComputeSlotsInput {
  readonly now: Date;
  readonly hours: OrgHours;
  readonly visits: readonly BookedVisit[];
  readonly crewCount: number;
  readonly lookaheadDays: number;
  readonly emergency: boolean;
}

// A day's resolved open/close hours (already mapped from OrgHours by weekday). A closed day has
// open === close === 0.
interface DayHours {
  readonly open: number;
  readonly close: number;
}

// Compute the offered slot windows. Walks calendar dates from `now` forward up to `lookaheadDays`,
// yields each open window that still has crew capacity, and returns the earliest MAX_SLOTS.
//
// emergency === true: today's window is offered even when today is nearly closed (the soonest
// possible time still gets surfaced) — see todayWindows. Still capped at MAX_SLOTS.
export function computeSlots(input: ComputeSlotsInput): SlotWindow[] {
  const byDate = groupVisitsByDate(input.visits);
  const slots: SlotWindow[] = [];

  for (let dayOffset = 0; dayOffset <= input.lookaheadDays; dayOffset += 1) {
    const date = addDays(toDateString(input.now), dayOffset);
    const hours = dayHoursFor(date, input.hours);
    const openWindows = windowsForDay({
      date,
      hours,
      isToday: dayOffset === 0,
      nowHour: input.now.getHours(),
      emergency: input.emergency,
    });

    for (const window of openWindows) {
      if (hasCapacity(window, byDate.get(date) ?? [], input.crewCount)) {
        slots.push(toSlotWindow(date, window, input.now));
        if (slots.length === MAX_SLOTS) return slots;
      }
    }
  }
  return slots;
}

// The concrete window computed for a day: which kind and its integer open/close hours.
interface Window {
  readonly kind: SlotWindowKind;
  readonly openHour: number;
  readonly closeHour: number;
}

// The windows a single day offers, in time order. A closed day yields none. Otherwise morning is
// present when open < boundary and afternoon when close > boundary. TODAY, a window is kept only if
// it hasn't fully CLOSED yet (a window still in progress is bookable — a 3pm call can still take the
// 1–5 afternoon). On an emergency we surface today's windows regardless, so the soonest possible
// time is always offered even if the day is nearly over.
function windowsForDay(args: {
  date: string;
  hours: DayHours;
  isToday: boolean;
  nowHour: number;
  emergency: boolean;
}): Window[] {
  if (isClosed(args.hours)) return [];

  const all = dayWindows(args.hours);
  if (!args.isToday) return all;
  return all.filter((w) => args.emergency || w.closeHour > args.nowHour);
}

// The (up to two) windows a set of day hours defines, skipping a window the hours don't span.
function dayWindows(hours: DayHours): Window[] {
  const windows: Window[] = [];
  if (hours.open < WINDOW_BOUNDARY_HOUR) {
    windows.push({ kind: "morning", openHour: hours.open, closeHour: Math.min(hours.close, WINDOW_BOUNDARY_HOUR) });
  }
  if (hours.close > WINDOW_BOUNDARY_HOUR) {
    windows.push({ kind: "afternoon", openHour: Math.max(hours.open, WINDOW_BOUNDARY_HOUR), closeHour: hours.close });
  }
  return windows;
}

// A window has capacity while the count of visits overlapping it is below the crew size — each crew
// member can run one visit per window, so `overlapping < crewCount` means at least one crew is free.
function hasCapacity(window: Window, dayVisits: readonly BookedVisit[], crewCount: number): boolean {
  const overlapping = dayVisits.filter((v) => visitOverlapsWindow(v, window)).length;
  return overlapping < crewCount;
}

// Which windows a visit occupies. A null-start visit has a date but no time yet, so by rule it
// occupies the MORNING window (the conservative default — it reduces the day's morning capacity and
// leaves the afternoon open). A timed visit occupies the window its start hour falls in.
function visitOverlapsWindow(visit: BookedVisit, window: Window): boolean {
  const startHour = visit.startHHMM === null ? 0 : hourOf(visit.startHHMM);
  const kind: SlotWindowKind = startHour < WINDOW_BOUNDARY_HOUR ? "morning" : "afternoon";
  return kind === window.kind;
}

// Project a resolved window onto the spoken SlotWindow DTO.
function toSlotWindow(date: string, window: Window, now: Date): SlotWindow {
  return {
    date,
    window: window.kind,
    startHHMM: toHHMM(window.openHour),
    speakable: speakableFor(date, window, now),
  };
}

// ── speech ────────────────────────────────────────────────────────────────────

const HOURS_IN_HALF_DAY = 12;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// The natural phrase the agent reads. "today"/"tomorrow" for offsets 0/1, else the weekday name.
// A relative-day MORNING omits the window word to stay terse ("today 8 to 12"); every other case
// includes it ("tomorrow afternoon, 1 to 5", "Thursday morning, 8 to 12") so the slot is unambiguous.
function speakableFor(date: string, window: Window, now: Date): string {
  const dayPhrase = dayPhraseFor(date, now);
  const range = `${clockPhrase(window.openHour)} to ${clockPhrase(spokenCloseHour(window))}`;
  const isRelative = dayPhrase === "today" || dayPhrase === "tomorrow";

  if (window.kind === "morning" && isRelative) return `${dayPhrase} ${range}`;
  return `${dayPhrase} ${window.kind}, ${range}`;
}

// The hour SPOKEN as a window's end. A morning window that runs to the 13:00 boundary is spoken as
// ending at noon ("8 to 12"), not "8 to 1" — the boundary is a scheduling seam, not the words a
// customer expects. Every other close is spoken as-is.
function spokenCloseHour(window: Window): number {
  if (window.kind === "morning" && window.closeHour === WINDOW_BOUNDARY_HOUR) return HOURS_IN_HALF_DAY;
  return window.closeHour;
}

// "today" | "tomorrow" | a weekday name, derived purely from the calendar-date offset off `now`.
function dayPhraseFor(date: string, now: Date): string {
  const todayStr = toDateString(now);
  if (date === todayStr) return "today";
  if (date === addDays(todayStr, 1)) return "tomorrow";
  return WEEKDAY_NAMES[weekdayOf(date)] ?? "that day";
}

// A bare-clock phrase for speech: "8", "12", "1", "5" (12-hour, no am/pm — the window word carries
// morning/afternoon). Midnight/noon map to 12.
function clockPhrase(hour24: number): string {
  const h = hour24 % HOURS_IN_HALF_DAY;
  return String(h === 0 ? HOURS_IN_HALF_DAY : h);
}

// ── calendar-date helpers (DST-safe: string math, never ms offsets) ─────────────

// A visit list bucketed by its calendar date, so a window only checks its own day's visits.
function groupVisitsByDate(visits: readonly BookedVisit[]): Map<string, BookedVisit[]> {
  const byDate = new Map<string, BookedVisit[]>();
  for (const v of visits) {
    const bucket = byDate.get(v.date);
    if (bucket) bucket.push(v);
    else byDate.set(v.date, [v]);
  }
  return byDate;
}

// The open/close hours for a date's weekday. Mon–Fri → wd, Sat → sat, Sun → sun.
function dayHoursFor(date: string, hours: OrgHours): DayHours {
  const dow = weekdayOf(date);
  if (dow === 0) return { open: hours.sunOpen, close: hours.sunClose };
  if (dow === 6) return { open: hours.satOpen, close: hours.satClose };
  return { open: hours.wdOpen, close: hours.wdClose };
}

const isClosed = (hours: DayHours): boolean => hours.open === 0 && hours.close === 0;

// The [year, month(1-12), day] of a "YYYY-MM-DD" string, as a fixed-length tuple so downstream
// arithmetic never sees `undefined` (noUncheckedIndexedAccess).
function parseDateParts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-");
  return [Number(y), Number(m), Number(d)];
}

// Day of week [0=Sun … 6=Sat] for a "YYYY-MM-DD" string. Uses UTC noon of the date to sidestep any
// timezone/DST edge at midnight — we only need the weekday, which UTC noon always reports correctly.
function weekdayOf(date: string): number {
  const [y, m, d] = parseDateParts(date);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// The local calendar date of `now` as "YYYY-MM-DD" (from the Date's LOCAL fields, matching how a
// visit's scheduled_date is stored/read). Exported so callers derive the reader's date range with
// the SAME rule the slot math uses (range and windows must agree).
export function toDateString(now: Date): string {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  return `${y}-${m}-${d}`;
}

// Add `days` to a "YYYY-MM-DD" string, returning a "YYYY-MM-DD" string. Uses UTC arithmetic on a
// noon anchor so the +1-day rollover is exact regardless of local DST. Exported for the same
// range-derivation reuse as toDateString.
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDateParts(date);
  const anchored = new Date(Date.UTC(y, m - 1, d, 12));
  anchored.setUTCDate(anchored.getUTCDate() + days);
  return `${anchored.getUTCFullYear()}-${pad2(anchored.getUTCMonth() + 1)}-${pad2(anchored.getUTCDate())}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// "HH:MM" for an integer hour (minutes always 00 — windows start on the hour).
const toHHMM = (hour: number): string => `${pad2(hour)}:00`;

// The integer hour of an "HH:MM" (or "HH:MM:SS") string.
const hourOf = (hhmm: string): number => Number(hhmm.slice(0, 2));
