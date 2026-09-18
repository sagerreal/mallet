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

import { useState } from "react";
import type { RoomWall } from "@/lib/store/types";

const fmt1 = (n: number): string => n.toFixed(1);

/** 10.5 ft → 10' 6". A painter reads feet and inches, never a decimal foot. */
export function feetInches(ft: number): string {
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches === 12 ? `${whole + 1}' 0"` : `${whole}' ${inches}"`;
}

export function wallLabel(w: RoomWall): string {
  // The EDITED number leads once a painter has spoken — every surface printing this wall
  // (breakdown, deduction picker, scan viewer) must agree, or the same wall reads as two facts
  // one screen apart. The scanner's dims stay for an unedited wall.
  if (w.overrideSqft != null) return `Wall ${w.index + 1} · ${fmt1(w.overrideSqft)} sq ft (edited)`;
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
  /**
   * Record the painter's area for one wall (null clears the edit). Present → every wall line
   * becomes editable. Rejections must reach the user: the promise rethrows.
   */
  onEditWall?: (index: number, sqft: number | null) => Promise<void>;
}

/**
 * The one string for a wall in every state. The EDIT is checked first: typing an area for a
 * wall the scanner lost is the repair path for a failed scan, and "didn't capture" over a
 * number the painter just typed would be the card denying its own data.
 */
function wallLineLabel(w: RoomWall): string {
  if (w.overrideSqft != null) return `Wall ${w.index + 1} · ${w.overrideSqft.toFixed(1)} sq ft`;
  if (wallDidNotCapture(w)) return `Wall ${w.index + 1} · didn't capture`;
  return wallLabel(w);
}

/**
 * One wall's line: the label, and — when editing is on — a tap-to-edit affordance. An edited
 * wall says so and keeps the scanner's number beside it ("edited · measured 49.7"), the same
 * audit shape as an overridden total: the correction never eats the measurement.
 */
function WallLine({
  w,
  onEdit,
}: {
  w: RoomWall;
  onEdit?: (index: number, sqft: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const edited = w.overrideSqft != null;
  const label = wallLineLabel(w);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setOpen(false);
      setError(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setError(`"${trimmed}" isn't an area. A wall that isn't painted is a deduction, not a zero.`);
      return;
    }
    try {
      await onEdit!(w.index, n);
      setOpen(false);
      setError(null);
    } catch {
      setError("Couldn't save this wall — check your connection and try again.");
    }
  }

  if (!onEdit) {
    return (
      <li className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-1) 0" }}>
        {label}
      </li>
    );
  }

  return (
    <li style={{ fontSize: "var(--type-sm)", padding: "var(--space-1) 0" }}>
      <button
        type="button"
        className="linklike"
        aria-expanded={open}
        onClick={() => {
          // Explicit target state, not a functional flip: tapping the label to CLOSE fires the
          // input's blur first, which already closed the editor — a flip would re-open it.
          const next = !open;
          setOpen(next);
          if (next) setDraft(w.overrideSqft != null ? String(w.overrideSqft) : "");
          setError(null);
        }}
        style={{ fontSize: "var(--type-sm)", padding: 0 }}
      >
        <span className={edited ? undefined : "muted"}>{label}</span>
      </button>
      {edited && !open && (
        <span className="muted" style={{ marginLeft: "var(--space-2)" }}>
          {wallDidNotCapture(w) ? "typed · scanner lost this wall" : `edited · measured ${w.sqft.toFixed(1)}`}
        </span>
      )}
      {open && (
        <WallLineEditor
          w={w}
          draft={draft}
          onDraft={setDraft}
          onCommit={() => void commit()}
          onClear={() => void onEdit(w.index, null).then(() => setOpen(false))}
        />
      )}
      {error && (
        <span role="alert" style={{ display: "block", color: "var(--red)", fontSize: "var(--type-sm)" }}>
          {error}
        </span>
      )}
    </li>
  );
}

function WallLineEditor({
  w,
  draft,
  onDraft,
  onCommit,
  onClear,
}: {
  w: RoomWall;
  draft: string;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onClear: () => void;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", marginLeft: "var(--space-2)" }}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Wall ${w.index + 1} area (sq ft)`}
        value={draft}
        autoFocus
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        onBlur={onCommit}
        className="field-compact"
        style={{ width: 90 }}
      />
      {w.overrideSqft != null && (
        <button
          type="button"
          className="linklike muted"
          style={{ fontSize: "var(--type-sm)", padding: 0 }}
          // preventDefault on mousedown keeps the input's blur-commit from firing (and
          // unmounting this button) before the click lands; activation itself is onClick, so
          // Enter/Space work — a clear you can't reach by keyboard isn't a control.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          Use measured {w.sqft.toFixed(1)}
        </button>
      )}
    </span>
  );
}

export function WallBreakdown({ walls, totalSqft, onEditWall }: WallBreakdownProps) {
  if (walls.length === 0) return null;
  // "Measured total" would be a lie the moment one wall carries the painter's number.
  const anyEdited = walls.some((w) => w.overrideSqft != null);

  return (
    <>
      <ul aria-label="Wall breakdown" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {walls.map((w) => (
          <WallLine key={w.index} w={w} onEdit={onEditWall} />
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
          {anyEdited ? "Total with edits" : "Measured total"} · {fmt1(totalSqft)} sq ft
        </p>
      )}
    </>
  );
}
