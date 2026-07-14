// PURE 12-hour arrival-window phrasing for the voice front desk. One home for turning a validated
// "HH:MM" slot start into (a) the discrete START-TIME phrase the caller now hears ("8am", "noon",
// "4pm") and (b) the natural 2-hour arrival RANGE a booking confirmation can still mention
// ("between 2 and 4pm"), reusing windowEndHHMM as the SINGLE definition of a window's length so the
// confirmed window always matches the offered one. No I/O, exhaustively unit-testable.
import { windowEndHHMM } from "../slots";

const HOURS_IN_HALF_DAY = 12;
const HOURS_IN_DAY = 24;
// The two clock hours that get a spoken WORD rather than a bare "12": midnight and noon read
// unnaturally as "12am"/"12pm" to a caller, so we say the word instead.
const NOON_HOUR = 12;
const MIDNIGHT_HOUR = 0;

// The integer hour of a validated "HH:MM" (or "HH:MM:SS") string.
const hourOf = (hhmm: string): number => Number(hhmm.slice(0, 2));

// The bare 12-hour number for an "HH:MM": 00/24 → 12, 13 → 1, noon → 12, else hour mod 12.
const clockNumber = (hhmm: string): string => {
  const h = hourOf(hhmm) % HOURS_IN_HALF_DAY;
  return String(h === 0 ? HOURS_IN_HALF_DAY : h);
};

// "am"/"pm" for an "HH:MM": < noon → am, else pm (24:00 → am).
const meridiem = (hhmm: string): string =>
  hourOf(hhmm) % HOURS_IN_DAY < HOURS_IN_HALF_DAY ? "am" : "pm";

// A discrete START-TIME phrase the caller hears when picking a slot — "8am", "noon", "4pm" — NOT a
// range. On-the-hour starts read clean (windows always start on the hour). Midnight/noon are worded
// ("noon"/"midnight") because "12pm"/"12am" are ambiguous to a listener; every other hour is
// "<n><am|pm>". Reused verbatim by both the offer and the booked confirmation so the two agree.
export const startTimePhrase = (startHHMM: string): string => {
  const hour = hourOf(startHHMM) % HOURS_IN_DAY;
  if (hour === NOON_HOUR) return "noon";
  if (hour === MIDNIGHT_HOUR) return "midnight";
  return `${clockNumber(startHHMM)}${meridiem(startHHMM)}`;
};

// The 2-hour arrival window spoken as a "between X and Ypm" range — e.g. "14:00" →
// "between 2 and 4pm". The meridiem is the END hour's so a window crossing noon reads naturally.
// Retained for the arrival-window mention (the offer now leads with startTimePhrase instead).
export const windowRange = (startHHMM: string): string => {
  const endHHMM = windowEndHHMM(startHHMM);
  return `between ${clockNumber(startHHMM)} and ${clockNumber(endHHMM)}${meridiem(endHHMM)}`;
};
