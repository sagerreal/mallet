import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// Wall-clock conversion. Job visits stamp instants (`timestamptz`, e.g. visit.startedAt) but
// time entries store a calendar date plus a wall-clock time (`date` + `time`, read back as
// "HH:MM"). Turning an instant into "which work day, and what time on the clock on the wall"
// requires the shop's timezone: a plumber finishing at 21:00 Pacific must not land on
// tomorrow's timesheet because the server runs in UTC.
//
// All zone/DST arithmetic is delegated to Intl.DateTimeFormat with the IANA zone. The platform
// already implements the tz database correctly, including DST transitions, so hand-rolled offset
// maths (or a date library) would only add a second, worse source of truth.

// The formatted string is never rendered — parts are read by type — so the locale only needs to
// be Gregorian with ASCII digits. en-US is both, and pinning it keeps output independent of the
// server's default locale.
const PARTS_LOCALE = "en-US";

// A local day's first and last representable minutes. "24:00" is not a valid value for an HH:MM
// `time` column, so 23:59 is where a day-crossing segment has to stop.
const START_OF_LOCAL_DAY = "00:00";
const END_OF_LOCAL_DAY = "23:59";

// One continuous work segment spanning more than a week is a runaway timer or corrupt data, not
// a shift. Refuse it rather than emit a week of filler rows onto someone's timesheet.
const MAX_SPANNED_LOCAL_DAYS = 7;

// Stepping a UTC-anchored calendar date by exactly 24h is safe precisely because UTC has no DST.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WallClock {
  readonly workDate: string; // YYYY-MM-DD
  readonly hhmm: string; // HH:MM
}

export interface Segment {
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface DaySegment {
  readonly workDate: string; // YYYY-MM-DD
  readonly startTime: string; // HH:MM
  readonly endTime: string; // HH:MM
}

// Build the zone-aware parts formatter. Seconds are deliberately NOT requested: the minute part
// Intl reports is the floor of the local time, so "HH:MM" is truncated by construction. Rounding
// would be wrong here — 23:59:40 would round up to "24:00", which no `time` column accepts.
const wallClockFormatter = (timeZone: string): Result<Intl.DateTimeFormat, ValidationError> => {
  try {
    return ok(
      new Intl.DateTimeFormat(PARTS_LOCALE, {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        // h23 keeps midnight as "00". hour12:false can render it as "24" in some locales, which
        // would produce an out-of-range HH:MM.
        hourCycle: "h23",
      }),
    );
  } catch {
    // Intl throws RangeError for an unknown IANA zone. Surfacing that as a validation error is
    // the whole point: a silent fallback to UTC would put hours on the wrong day, which is the
    // exact bug this module exists to prevent.
    return err(validation(`unknown time zone: "${timeZone}"`, "timeZone"));
  }
};

const formatWith = (
  formatter: Intl.DateTimeFormat,
  instant: Date,
): Result<WallClock, ValidationError> => {
  if (Number.isNaN(instant.getTime())) {
    return err(validation("instant is not a valid date", "instant"));
  }

  const parts = formatter.formatToParts(instant);
  const partValue = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value;

  const year = partValue("year");
  const month = partValue("month");
  const day = partValue("day");
  const hour = partValue("hour");
  const minute = partValue("minute");

  if (!year || !month || !day || !hour || !minute) {
    return err(validation(`time zone produced no readable local parts`, "timeZone"));
  }

  return ok({ workDate: `${year}-${month}-${day}`, hhmm: `${hour}:${minute}` });
};

// Convert an instant into the shop's local work date and wall-clock time.
export const toWallClock = (instant: Date, timeZone: string): Result<WallClock, ValidationError> => {
  const formatter = wallClockFormatter(timeZone);
  if (!formatter.ok) return formatter;
  return formatWith(formatter.value, instant);
};

interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

const parseCalendarDate = (workDate: string): CalendarDate | null => {
  const parts = workDate.split("-");
  const [y, m, d] = [parts[0], parts[1], parts[2]];
  if (y === undefined || m === undefined || d === undefined) return null;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
};

const formatCalendarDate = (c: CalendarDate): string =>
  `${String(c.year).padStart(4, "0")}-${pad2(c.month)}-${pad2(c.day)}`;

// Pure calendar arithmetic on an already-localised date, so UTC is the correct anchor: it has no
// DST, and month/year rollover comes free from Date.
const addOneDay = (c: CalendarDate): CalendarDate => {
  const next = new Date(Date.UTC(c.year, c.month - 1, c.day) + MS_PER_DAY);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
};

// One candidate row per local day the segment touches. Rows may be zero-length; the caller
// filters those out.
//
// Each crossing of local midnight LOSES ONE MINUTE: the earlier day ends at 23:59 and the next
// begins at 00:00, so 23:59->00:00 is never billed. This is accepted deliberately. The only
// alternative is migrating the time columns to timestamptz, which would break the time pickers,
// the hours derivation and the QuickBooks mapper — a minute a midnight is the cheaper trade.
const candidateRows = (
  start: WallClock,
  end: WallClock,
): Result<readonly DaySegment[], ValidationError> => {
  if (start.workDate === end.workDate) {
    return ok([{ workDate: start.workDate, startTime: start.hhmm, endTime: end.hhmm }]);
  }

  const startDate = parseCalendarDate(start.workDate);
  if (startDate === null) {
    // Unreachable via toWallClock, which always emits YYYY-MM-DD; kept so the parse has no
    // silent failure mode.
    return err(validation(`unreadable local work date: "${start.workDate}"`, "startedAt"));
  }

  // Walk calendar days from the start day to the end day, appending copies rather than pushing:
  // recursion depth is capped by MAX_SPANNED_LOCAL_DAYS, so the immutable form costs nothing.
  const walk = (
    cursor: CalendarDate,
    cursorDate: string,
    rows: readonly DaySegment[],
  ): Result<readonly DaySegment[], ValidationError> => {
    if (cursorDate === end.workDate) {
      // The final (end) day. When the segment ends exactly at local midnight this row is
      // 00:00->00:00 and the zero-length filter drops it, which is the correct reading: the work
      // belongs wholly to the earlier day.
      return ok([
        ...rows,
        { workDate: end.workDate, startTime: START_OF_LOCAL_DAY, endTime: end.hhmm },
      ]);
    }
    // The walk always finishes with one end-day row, so the days before it can be at most
    // MAX_SPANNED_LOCAL_DAYS - 1 if the total is to honour the limit this error reports.
    if (rows.length >= MAX_SPANNED_LOCAL_DAYS - 1) {
      return err(
        validation(`segment spans more than ${MAX_SPANNED_LOCAL_DAYS} local days`, "endedAt"),
      );
    }
    const filled: readonly DaySegment[] = [
      ...rows,
      {
        workDate: cursorDate,
        startTime: rows.length === 0 ? start.hhmm : START_OF_LOCAL_DAY,
        endTime: END_OF_LOCAL_DAY,
      },
    ];
    const next = addOneDay(cursor);
    return walk(next, formatCalendarDate(next), filled);
  };

  return walk(startDate, start.workDate, []);
};

// Split an instant-pair into one timesheet row per local day it touches.
//
// KNOWN AND ACCEPTED LIMITATION — a segment that SPANS a DST transition mis-states its duration.
//
// Rows carry wall-clock HH:MM, and pay is derived as (end - start) on the wall. So an hour the
// local clock repeats is billed once (fall-back under-bills by an hour) and an hour it skips is
// billed anyway (spring-forward over-bills by an hour). Neither is detected here: only a segment
// whose wall clock runs BACKWARDS is caught, which is a narrow sub-case.
//
// This is accepted, not overlooked. US DST transitions happen at 02:00 local, so no ordinary shift
// reaches one — the beachhead does not work nights, and the shop was asked. The fix would be to
// store instants instead of wall times, which would break the pickers, the hours derivation, the
// editors and the QuickBooks mapper, and rewrite every existing row. If a shop ever runs crews
// through 02:00, that migration is the answer and this comment is the reason.
//
// Separately: a day's start is anchored at 00:00, which assumes local midnight exists. In the zones
// this serves it always does, but a few shift AT midnight (e.g. America/Havana springs 23:59 ->
// 01:00), where the anchor names a minute that never happened. Same disposition, same reason.
export const splitAtMidnight = (
  segment: Segment,
  timeZone: string,
): Result<readonly DaySegment[], ValidationError> => {
  const startedMs = segment.startedAt.getTime();
  const endedMs = segment.endedAt.getTime();
  // Named per end so the caller is told WHICH instant is bad. Checked before the ordering
  // comparison below, because every comparison against NaN is false and an invalid date would
  // otherwise slip through as a valid range.
  if (Number.isNaN(startedMs)) {
    return err(validation("startedAt is not a valid date", "startedAt"));
  }
  if (Number.isNaN(endedMs)) {
    return err(validation("endedAt is not a valid date", "endedAt"));
  }
  // The downstream TimeEntry factory rejects this too; failing here keeps the error attached to
  // the instants the caller actually passed.
  if (endedMs <= startedMs) {
    return err(validation("endedAt must be after startedAt", "endedAt"));
  }

  const formatter = wallClockFormatter(timeZone);
  if (!formatter.ok) return formatter;

  const start = formatWith(formatter.value, segment.startedAt);
  if (!start.ok) return start;
  const end = formatWith(formatter.value, segment.endedAt);
  if (!end.ok) return end;

  const rows = candidateRows(start.value, end.value);
  if (!rows.ok) return rows;

  // Zero-padded 24-hour "HH:MM" sorts lexicographically exactly as it runs chronologically, so a
  // row ending before it starts means the wall clock moved BACKWARDS. That happens only inside a
  // daylight-saving fall-back, where the same local hour is walked twice; `date` + `time` columns
  // cannot record which pass a value belongs to. Refuse it here with a reason, rather than hand on
  // a row the TimeEntry factory would reject as negative hours.
  const backwards = rows.value.find((r) => r.endTime < r.startTime);
  if (backwards) {
    return err(
      validation(
        "segment ends at an earlier wall-clock time than it starts (ambiguous daylight-saving hour)",
        "endedAt",
      ),
    );
  }

  // A row whose start equals its end represents no billable minute and TimeEntry would reject it,
  // so it is never emitted.
  const billable = rows.value.filter((r) => r.startTime !== r.endTime);
  if (billable.length === 0) {
    // Three ways to land here, and the third is not what the other two are:
    //  - a sub-minute segment (both ends truncate to the same HH:MM);
    //  - one spent entirely inside a repeated fall-back hour;
    //  - one straddling midnight inside the 23:59 -> 00:00 window, e.g. 23:59:00 -> 00:00:59. That
    //    is ~2 real minutes, but the midnight rule ends day one at 23:59 and starts day two at
    //    00:00, so BOTH candidate rows are zero-length and the whole segment is consumed by the
    //    one-minute crossing cost.
    // In every case there is no nonzero HH:MM row to write, and the alternative — inventing a
    // minute on whichever day looks closest — would put time on the sheet nobody worked. So it is
    // refused, loudly, rather than rounded into existence.
    return err(
      validation(
        "segment is too short to record at one-minute resolution (or falls entirely in the midnight crossing)",
        "endedAt",
      ),
    );
  }
  return ok(billable);
};
