import type { PaintingQuantityKind } from "./derive-painting";

/**
 * modules/measurements/domain/trim-area.ts
 * Turning a trim RUN into a trim AREA, once somebody says how tall the trim is.
 *
 * The scanner gives a perimeter, so trim has only ever been a length: 38.4 linear feet of
 * baseboard. A length is not the work. Painting a 3¼" colonial base and a 7" craftsman base
 * along the same 38.4 feet is not the same job, and a shop that prices trim by the square foot
 * had no way to get one out of Mallet at all — the run was the only number the room carried.
 *
 * So the height is TYPED, not picked. A preset list of heights is a guess about somebody
 * else's millwork: bases run 2¼", 3¼", 4", 5¼", 7", and plenty of commercial work is a 4"
 * rubber cove that matches no list at all. The painter has a tape measure and the wall in
 * front of them; the app should take the number they read off it.
 *
 * Height belongs to the two RUN kinds only. Walls, ceiling and soffit are already areas, and
 * a door is not taller in square feet — asking for a height there would be asking for nothing.
 */

/** The kinds measured as a run, and therefore the only kinds a height means anything for. */
export const TRIM_RUN_KINDS = ["baseboard_lnft", "crown_lnft"] as const;

export type TrimRunKind = (typeof TRIM_RUN_KINDS)[number];

export function isTrimRunKind(kind: PaintingQuantityKind): kind is TrimRunKind {
  return (TRIM_RUN_KINDS as readonly string[]).includes(kind);
}

/**
 * A trim area is a PRICING BASIS, not a room quantity.
 *
 * The room stores what was measured — the run — plus the height somebody typed. The square
 * footage is computed from those two on the way out, so it is deliberately NOT a
 * PaintingQuantityKind: nothing writes a `baseboard_sqft` row, no scan derives one, and the
 * card has no such line to confirm. It exists only so a shop that prices trim by the square
 * foot can point a pricebook service at it.
 */
export const TRIM_AREA_KINDS = ["baseboard_sqft", "crown_sqft"] as const;

export type TrimAreaKind = (typeof TRIM_AREA_KINDS)[number];

/** Which pricing basis a given run turns into once a height is known. */
export const TRIM_AREA_KIND_BY_RUN: Record<TrimRunKind, TrimAreaKind> = {
  baseboard_lnft: "baseboard_sqft",
  crown_lnft: "crown_sqft",
};

/**
 * Bounds on a typed height, in inches.
 *
 * The floor is exclusive: a zero-height baseboard is not a short baseboard, it is the absence
 * of one — and that answer already has its own control ("None in this room"), which records a
 * confirmed zero RUN. Letting a zero height through here would produce zero square feet on a
 * room that really does have 38 feet of base, which reads as measured-and-worthless rather
 * than not-present.
 *
 * The ceiling is 24" because past that it is not trim: a 3-foot "baseboard" is wainscot or
 * panelling, priced as a wall surface, and typing 36 into a baseboard height is far more
 * likely a slip for 3.6 than a real piece of millwork.
 */
export const MIN_TRIM_HEIGHT_IN = 0;
export const MAX_TRIM_HEIGHT_IN = 24;

const INCHES_PER_FOOT = 12;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function isValidTrimHeight(heightIn: number): boolean {
  return (
    Number.isFinite(heightIn) && heightIn > MIN_TRIM_HEIGHT_IN && heightIn <= MAX_TRIM_HEIGHT_IN
  );
}

/**
 * The paintable face area of a trim run, in square feet.
 *
 * Deliberately the FACE only — run × height — and not a developed width that would follow the
 * profile around every ogee and cove. Painters bid the face; a coverage allowance for profile
 * lives in the rate, not in the measurement. Inventing a multiplier here would silently inflate
 * every trim line by a factor nobody chose.
 */
export function trimAreaSqft(runLnft: number, heightIn: number): number {
  return round1((runLnft * heightIn) / INCHES_PER_FOOT);
}
