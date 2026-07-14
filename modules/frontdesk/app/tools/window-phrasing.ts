// PURE 12-hour arrival-window phrasing for the voice front desk. One home for turning a validated
// "HH:MM" slot start into the natural range a person hears ("between 2 and 4pm"), reusing
// windowEndHHMM as the SINGLE definition of a window's length so the confirmed window always matches
// the offered one. No I/O, exhaustively unit-testable.
import { windowEndHHMM } from "../slots";

const HOURS_IN_HALF_DAY = 12;
const HOURS_IN_DAY = 24;

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

// The 2-hour arrival window spoken as a "between X and Ypm" range — e.g. "14:00" →
// "between 2 and 4pm". The meridiem is the END hour's so a window crossing noon reads naturally.
export const windowRange = (startHHMM: string): string => {
  const endHHMM = windowEndHHMM(startHHMM);
  return `between ${clockNumber(startHHMM)} and ${clockNumber(endHHMM)}${meridiem(endHHMM)}`;
};
