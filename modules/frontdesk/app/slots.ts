// PURE availability math for the voice front desk — NO I/O, NO Date.now(). The caller passes `now`
// (from a Clock) so this whole file is deterministic and exhaustively unit-testable. It turns the
// org's opening hours + already-booked visits + crew size into a few DISCRETE 2-HOUR ARRIVAL
// WINDOWS the caller picks from (the home-services norm — a tight "2 to 4pm" beats a 5-hour
// "afternoon"). Date arithmetic is done on CALENDAR dates (rolling a YYYY-MM-DD string forward one
// day at a time), never on millisecond offsets, so a DST transition can never drop or duplicate a
// day.

// The length of every arrival window, in hours. Named, not magic: the playbook offers 2-hour
// arrival windows (e.g. 8-10, 10-12, …), so a caller hears a tight commitment, not a half-day block.
export const SLOT_WINDOW_HOURS = 2;

// We offer AT MOST this many windows so the caller has a short menu to pick from, not a calendar to
// read. Earliest-first, across days.
export const MAX_SLOTS = 3;

// A shop with no member flagged is_field_crew is still one working technician (the solo owner-op),
// so capacity is at least this many crew. Prevents a mis-configured roster from making the agent
// claim it has no openings at all. Applied here AND clamped again by the tool (defense-in-depth).
export const MIN_CREW = 1;

// One offerable arrival window. `date` is a calendar date "YYYY-MM-DD"; `startHHMM`/`endHHMM` are
// the window bounds as 24h "HH:MM" (startHHMM feeds book_visit's slot_start / scheduledStart);
// `speakable` is the natural phrase the agent reads back ("today, 2 to 4pm", "tomorrow, 8 to 10am").
export interface SlotWindow {
  readonly date: string;
  readonly startHHMM: string;
  readonly endHHMM: string;
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
// unplaced-time visit (a date but no time yet); by rule it occupies the FIRST window of its date
// (documented below in visitOccupiesWindow) so it still reduces availability conservatively.
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

// The shared definition of a window's end: start + SLOT_WINDOW_HOURS, on the same "HH:MM" clock.
// Exported so book_visit + the booking confirmation reuse ONE definition of "the 2-hour window"
// rather than re-deriving it (a single source of truth for window length). Input is trusted to be a
// valid "HH:MM" (book_visit bounds-checks it first); the end is clamped to 24 for a late start.
export const windowEndHHMM = (startHHMM: string): string => {
  const endHour = Math.min(hourOf(startHHMM) + SLOT_WINDOW_HOURS, HOURS_IN_DAY);
  return toHHMM(endHour);
};

// Compute the offered arrival windows. Walks calendar dates from `now` forward up to `lookaheadDays`,
// yields each 2-hour window that still has crew capacity, and returns the earliest MAX_SLOTS.
//
// emergency === true: today's soonest window is offered even when the day is nearly closed / it's
// the current window (the soonest possible time still gets surfaced) — see windowsForDay. Still
// capped at MAX_SLOTS.
export function computeSlots(input: ComputeSlotsInput): SlotWindow[] {
  const byDate = groupVisitsByDate(input.visits);
  const slots: SlotWindow[] = [];

  for (let dayOffset = 0; dayOffset <= input.lookaheadDays; dayOffset += 1) {
    const date = addDays(toDateString(input.now), dayOffset);
    const hours = dayHoursFor(date, input.hours);
    const openWindows = windowsForDay({
      hours,
      isToday: dayOffset === 0,
      nowHour: input.now.getHours(),
      emergency: input.emergency,
    });

    for (const window of openWindows) {
      if (hasCapacity(window, byDate.get(date) ?? [], input.crewCount, hours.open)) {
        slots.push(toSlotWindow(date, window, input.now));
        if (slots.length === MAX_SLOTS) return slots;
      }
    }
  }
  return slots;
}

// A concrete 2-hour window computed for a day: its integer open/close hours (close = open + 2).
interface Window {
  readonly openHour: number;
  readonly closeHour: number;
}

// The windows a single day offers, in time order. A closed day yields none. Otherwise we step by
// SLOT_WINDOW_HOURS from the day's open while a whole window still fits before close (8-18 →
// 8-10, 10-12, 12-14, 14-16, 16-18). TODAY, a window whose start hour is at/behind `nowHour` is a
// past window and dropped (can't offer a slot that has already started). On an EMERGENCY we surface
// today's windows regardless, so the soonest possible window is always offered even if the day is
// nearly over or already closed.
function windowsForDay(args: {
  hours: DayHours;
  isToday: boolean;
  nowHour: number;
  emergency: boolean;
}): Window[] {
  if (isClosed(args.hours)) return [];

  const all = dayWindows(args.hours);
  if (!args.isToday || args.emergency) return all;
  return all.filter((w) => w.openHour > args.nowHour);
}

// The 2-hour windows a set of day hours defines, stepping by SLOT_WINDOW_HOURS from open. A window
// is only produced when a WHOLE SLOT_WINDOW_HOURS block fits before close, so an odd tail (e.g.
// 8–13) never yields a truncated < 2h window.
function dayWindows(hours: DayHours): Window[] {
  const windows: Window[] = [];
  for (let start = hours.open; start + SLOT_WINDOW_HOURS <= hours.close; start += SLOT_WINDOW_HOURS) {
    windows.push({ openHour: start, closeHour: start + SLOT_WINDOW_HOURS });
  }
  return windows;
}

// A window has capacity while the count of visits inside it is below the crew size — each crew
// member can run one visit per window, so `occupying < crewCount` means at least one crew is free.
// `dayOpen` is the day's open hour, used to place a null-start visit into the first window.
function hasCapacity(
  window: Window,
  dayVisits: readonly BookedVisit[],
  crewCount: number,
  dayOpen: number,
): boolean {
  const occupying = dayVisits.filter((v) => visitOccupiesWindow(v, window, dayOpen)).length;
  return occupying < crewCount;
}

// Whether a visit falls inside a window. A null-start visit has a date but no time yet, so by rule
// it occupies the FIRST window of its day (the conservative default): its start hour is treated as
// the day's OPEN hour, which by construction lands in the first window dayWindows produces. A timed
// visit occupies the window whose [openHour, closeHour) contains its start hour.
function visitOccupiesWindow(visit: BookedVisit, window: Window, dayOpen: number): boolean {
  const hour = visit.startHHMM === null ? dayOpen : hourOf(visit.startHHMM);
  return hour >= window.openHour && hour < window.closeHour;
}

// Project a resolved window onto the spoken SlotWindow DTO.
function toSlotWindow(date: string, window: Window, now: Date): SlotWindow {
  return {
    date,
    startHHMM: toHHMM(window.openHour),
    endHHMM: toHHMM(window.closeHour),
    speakable: speakableFor(date, window, now),
  };
}

// ── speech ────────────────────────────────────────────────────────────────────

const HOURS_IN_HALF_DAY = 12;
const HOURS_IN_DAY = 24;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// The natural phrase the agent reads. "today"/"tomorrow" for offsets 0/1, else the weekday name,
// then the 2-hour range with a single am/pm suffix ("today, 2 to 4pm", "tomorrow, 8 to 10am",
// "Thursday, 12 to 2pm"). The suffix is the END hour's meridiem so a window crossing noon
// ("10 to 12pm") reads naturally.
function speakableFor(date: string, window: Window, now: Date): string {
  const dayPhrase = dayPhraseFor(date, now);
  return `${dayPhrase}, ${clockRange(window.openHour, window.closeHour)}`;
}

// A 2-hour range spoken with one meridiem on the end: "2 to 4pm", "8 to 10am", "12 to 2pm". The
// meridiem is taken from the end hour so a midday window reads the way a person says it.
function clockRange(openHour: number, closeHour: number): string {
  return `${clockNumber(openHour)} to ${clockNumber(closeHour)}${meridiem(closeHour)}`;
}

// The bare 12-hour number for an integer hour: 0/24 → 12, 13 → 1, else the hour mod 12 (noon → 12).
function clockNumber(hour24: number): string {
  const h = hour24 % HOURS_IN_HALF_DAY;
  return String(h === 0 ? HOURS_IN_HALF_DAY : h);
}

// "am"/"pm" for an integer hour [0,24]. Midnight/noon handled: 0 → am, 12 → pm, 24 → am.
function meridiem(hour24: number): string {
  const h = hour24 % HOURS_IN_DAY;
  return h < HOURS_IN_HALF_DAY ? "am" : "pm";
}

// "today" | "tomorrow" | a weekday name, derived purely from the calendar-date offset off `now`.
function dayPhraseFor(date: string, now: Date): string {
  const todayStr = toDateString(now);
  if (date === todayStr) return "today";
  if (date === addDays(todayStr, 1)) return "tomorrow";
  return WEEKDAY_NAMES[weekdayOf(date)] ?? "that day";
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
