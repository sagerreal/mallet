/**
 * components/modals/wall-breakdown.tsx
 * The working behind a room's walls total: one line per wall — dims × area — then the measured
 * total those lines add to.
 *
 * WHY IT EXISTS. The scan showed one number ("Walls · 307.2 sq ft") with no way to see where it
 * came from, and a total nobody can check is a total nobody trusts — the exact objection Garrett
 * raised about AI-generated estimates ("the salesperson reviews the numbers"). The per-wall areas
 * were never missing: every capture stores each wall's polygon, the server derives width/height/
 * area per wall on every read, and the deduction picker already lists them. This is the same data,
 * shown where the total is.
 *
 * A 0×0 wall is a CAPTURE FAILURE, not a small wall — RoomPlan returns degenerate polygons for
 * walls it lost (Owen's first real scan: 14 of 15), and that is also precisely when the total goes
 * needs_confirm. Naming the failed wall here is what finally makes that state legible.
 *
 * `wallLabel`/`feetInches` moved here from room-deductions so the SAME wall prints the SAME string
 * on both surfaces — the picker importing a label from the breakdown is the point, not an accident.
 */

import type { RoomWall } from "@/lib/store/types";

const fmt1 = (n: number): string => n.toFixed(1);

/** 10.5 ft → 10' 6". A painter reads feet and inches, never a decimal foot. */
export function feetInches(ft: number): string {
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches === 12 ? `${whole + 1}' 0"` : `${whole}' ${inches}"`;
}

export function wallLabel(w: RoomWall): string {
  return `Wall ${w.index + 1} · ${feetInches(w.widthFt)} × ${feetInches(w.heightFt)} · ${fmt1(w.sqft)} sq ft`;
}

/**
 * A wall the scanner lost. Keyed on AREA alone: a lost wall can come back as a collapsed
 * polygon with real-looking spans (12 ft of collinear vertices), and "12' 0" × 0' 0" ·
 * 0.0 sq ft" printed as a measurement is exactly the contradiction this surface exists to
 * remove. Zero area is no wall, whatever the spans say.
 */
export const wallDidNotCapture = (w: RoomWall): boolean => w.sqft === 0;

export interface WallBreakdownProps {
  walls: readonly RoomWall[];
  /** The derived walls_sqft — null while the total is still needs_confirm (nothing to add to). */
  totalSqft: number | null;
}

export function WallBreakdown({ walls, totalSqft }: WallBreakdownProps) {
  if (walls.length === 0) return null;

  return (
    <>
      <ul aria-label="Wall breakdown" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {walls.map((w) => (
          <li
            key={w.index}
            className="muted"
            style={{ fontSize: "var(--type-sm)", padding: "var(--space-1) 0" }}
          >
            {wallDidNotCapture(w) ? `Wall ${w.index + 1} · didn't capture` : wallLabel(w)}
          </li>
        ))}
      </ul>
      {/* Outside the list: a screen reader counting "3 items" on a 2-wall room is counting the
          total as a wall. */}
      {totalSqft != null && (
        <p
          style={{
            fontSize: "var(--type-sm)",
            fontWeight: 600,
            padding: "var(--space-1) 0",
            margin: "var(--space-1) 0 var(--space-3)",
            borderTop: "1px solid var(--line-2)",
          }}
        >
          Measured total · {fmt1(totalSqft)} sq ft
        </p>
      )}
    </>
  );
}
