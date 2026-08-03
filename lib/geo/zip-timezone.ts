// lib/geo/zip-timezone.ts

/**
 * ZIP → IANA timezone.
 *
 * Why this exists: org_settings.timezone defaults to America/Los_Angeles for every org, is read by
 * the AI front desk and the in-app agent, and has no UI. The ZIP is already collected at /welcome
 * for the phone number's area code, so the timezone can be derived rather than asked for.
 *
 * ACCURACY. This is a ZIP3-prefix table, and twelve states straddle a timezone line (FL, IN, KY,
 * TN, ND, SD, NE, KS, TX, MI, OR, ID). Ranges here follow the majority of each block, so a shop on
 * the wrong side of a line gets the wrong answer. That is why the caller must SHOW the derived
 * value and let it be corrected — see the Settings timezone control. Never apply this silently.
 *
 * A gap returns null, meaning "we do not know". Falling back to a default would reintroduce the
 * exact bug: a confident wrong answer nobody was asked to check.
 */

/** Inclusive ZIP3 ranges, in ascending order. */
const ZONES: readonly (readonly [number, number, string])[] = [
  [6, 9, "America/Puerto_Rico"],
  [10, 349, "America/New_York"],
  [350, 369, "America/Chicago"],
  [370, 385, "America/Chicago"],
  [386, 397, "America/Chicago"],
  [398, 399, "America/New_York"],
  [400, 427, "America/New_York"],
  [430, 459, "America/New_York"],
  [460, 479, "America/New_York"],
  [480, 499, "America/New_York"],
  [500, 528, "America/Chicago"],
  [530, 549, "America/Chicago"],
  [550, 567, "America/Chicago"],
  [570, 577, "America/Chicago"],
  [580, 588, "America/Chicago"],
  [590, 599, "America/Denver"],
  [600, 629, "America/Chicago"],
  [630, 658, "America/Chicago"],
  [660, 679, "America/Chicago"],
  [680, 693, "America/Chicago"],
  [700, 714, "America/Chicago"],
  [716, 729, "America/Chicago"],
  [730, 749, "America/Chicago"],
  [750, 797, "America/Chicago"],
  [798, 799, "America/Denver"], // El Paso sits in Mountain while the rest of Texas is Central.
  [800, 816, "America/Denver"],
  [820, 831, "America/Denver"],
  [832, 838, "America/Denver"],
  [840, 847, "America/Denver"],
  [850, 865, "America/Phoenix"], // Arizona does not observe DST — a distinct zone, not Denver.
  [870, 884, "America/Denver"],
  [889, 898, "America/Los_Angeles"],
  [900, 961, "America/Los_Angeles"],
  [967, 968, "Pacific/Honolulu"],
  [970, 979, "America/Los_Angeles"],
  [980, 994, "America/Los_Angeles"],
  [995, 999, "America/Anchorage"],
];

/**
 * Plain names for every zone the ZIP table above can produce. A shop reads "Eastern", not
 * "America/New_York". Single source of truth: /welcome's derivation preview and the Settings
 * timezone control both import this rather than keeping their own copy — a third copy is exactly
 * how the Settings `<select>` ended up able to render blank for a zone the ZIP table had already
 * started producing (see TimezoneCard, which also renders a fallback `<option>` for any stored
 * zone missing from this map, so an unknown value is visible rather than blank).
 */
export const TZ_LABEL: Record<string, string> = {
  "America/New_York": "Eastern time",
  "America/Chicago": "Central time",
  "America/Denver": "Mountain time",
  "America/Phoenix": "Arizona time",
  "America/Los_Angeles": "Pacific time",
  "America/Anchorage": "Alaska time",
  "Pacific/Honolulu": "Hawaii time",
  "America/Puerto_Rico": "Atlantic time",
};

export function zipToTimezone(zip: string | null | undefined): string | null {
  const digits = (zip ?? "").trim().replace(/\D/g, "");
  if (digits.length < 5) return null;

  const prefix = Number(digits.slice(0, 3));
  if (!Number.isFinite(prefix)) return null;

  for (const [lo, hi, tz] of ZONES) {
    if (prefix >= lo && prefix <= hi) return tz;
  }
  return null;
}
