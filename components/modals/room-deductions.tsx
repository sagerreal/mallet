"use client";

/**
 * components/modals/room-deductions.tsx
 * "Not painted" — the wall area a room does not get, chosen by TAP on the scan already taken.
 *
 * WHY IT LOOKS LIKE THIS. walls_sqft is reported GROSS on purpose (derive-painting.ts: openings
 * are never deducted, because you cut in around a window and the cutting is the cost). Tile is the
 * opposite — a band nobody paints and nobody cuts around. The only lever before this was
 * overriding walls_sqft with a hand-worked number, which lost the REASON: six weeks later nobody
 * could tell tile from a mistake from a discount. Every deduction here carries its own reason and
 * shows its own arithmetic.
 *
 * THE PAINTER NEVER MEASURES. Wall widths come out of the capture, so selecting walls is a tap and
 * the ONLY input in the whole flow is a band's height — offered as presets, not a tape reading.
 *
 * NOT MIRRORS. A mirror is masked and cut around, exactly like the window beside it, so deducting
 * one would understate the paint and hide the labour. The rule is: deduct what you neither paint
 * nor cut around.
 */

import { useState } from "react";
import type { RoomCard, RoomWall } from "@/lib/store/types";
// One string for a wall everywhere: the breakdown under the Walls total and this picker must
// print the SAME wall the SAME way, or the same wall reads as two facts one screen apart.
import { wallLabel, wallDidNotCapture } from "./wall-breakdown";

/** Heights a painter actually says, so the common cases are one tap. Feet. */
const HEIGHT_PRESETS: readonly { label: string; ft: number }[] = [
  { label: "4 ft", ft: 4 },
  { label: "6 ft", ft: 6 },
];

/** Reasons that cover nearly every bathroom and kitchen, so the reason is a tap too. */
const REASON_PRESETS: readonly string[] = ["Tile wainscot", "Shower surround", "Backsplash"];

const fmt1 = (n: number): string => n.toFixed(1);

// ---------------------------------------------------------------------------
// One recorded deduction
// ---------------------------------------------------------------------------

function DeductionRow({
  reason,
  detail,
  sqft,
  onRemove,
  busy,
}: {
  reason: string;
  detail: string;
  sqft: number | null;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="rded-row">
      <div className="rded-what">
        <b>{reason}</b>
        <span className="rded-detail">{detail}</span>
      </div>
      {/* Null is not zero: a band with no height cannot be answered yet, and showing 0.0 would
          read as "nothing is tiled" on a room that is. */}
      <span className="rded-amt">{sqft === null ? "—" : `−${fmt1(sqft)}`}</span>
      <button
        type="button"
        className="rded-x"
        aria-label={`Remove ${reason}`}
        aria-disabled={busy ? true : undefined}
        onClick={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The add form — expands in flow, never floats
// ---------------------------------------------------------------------------

interface AddFormProps {
  walls: readonly RoomWall[];
  busy: boolean;
  onCancel: () => void;
  onAdd: (d: { reason: string; kind: "whole_wall" | "band"; wallIndexes: number[]; heightFt: number | null }) => void;
}

function AddDeductionForm({ walls, busy, onCancel, onAdd }: AddFormProps) {
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  // null = the whole wall goes; a number = a band that many feet up from the floor.
  const [heightFt, setHeightFt] = useState<number | null>(4);

  const toggle = (index: number) =>
    setPicked((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));

  // Live, from the scan's own widths — the painter sees the number change as they tap, which is
  // what makes "no measuring" believable rather than a claim.
  const preview = picked.reduce((sum, i) => {
    const w = walls.find((x) => x.index === i);
    if (!w) return sum;
    // A wall whose height rounded to 0.0 cannot be banded against — dividing by it printed
    // "−NaN sq ft" as the live preview. Its whole area is still an honest whole-wall number.
    if (heightFt === null) return sum + w.sqft;
    if (w.heightFt <= 0) return sum;
    return sum + (w.sqft / w.heightFt) * Math.min(heightFt, w.heightFt);
  }, 0);

  const ready = reason.trim().length > 0 && picked.length > 0;

  return (
    <div className="rded-form">
      <label className="rded-lbl" htmlFor="rded-reason">
        What is it
      </label>
      <input
        id="rded-reason"
        className="rded-input"
        value={reason}
        maxLength={60}
        placeholder="Tile wainscot"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="rded-presets">
        {REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}>
            {r}
          </button>
        ))}
      </div>

      <span className="rded-lbl">Which walls</span>
      <div className="rded-walls" role="group" aria-label="Walls">
        {walls.map((w) => (
          <label key={w.index} className="rded-wall">
            <input type="checkbox" checked={picked.includes(w.index)} onChange={() => toggle(w.index)} />
            <span>{wallLabel(w)}</span>
          </label>
        ))}
      </div>

      <span className="rded-lbl">How high</span>
      <div className="seg" role="group" aria-label="Height">
        {HEIGHT_PRESETS.map((h) => (
          <button key={h.ft} type="button" aria-pressed={heightFt === h.ft} onClick={() => setHeightFt(h.ft)}>
            {h.label}
          </button>
        ))}
        <button type="button" aria-pressed={heightFt === null} onClick={() => setHeightFt(null)}>
          Whole wall
        </button>
      </div>

      <div className="rded-preview">
        {picked.length === 0 ? (
          <span className="rded-detail">Pick the walls this covers.</span>
        ) : (
          <>
            <span className="rded-detail">
              {picked.length} {picked.length === 1 ? "wall" : "walls"}
              {heightFt === null ? "" : ` · ${heightFt} ft up`}
            </span>
            <b>−{fmt1(preview)} sq ft</b>
          </>
        )}
      </div>

      <div className="rded-actions">
        <button type="button" className="rded-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="rded-save"
          aria-disabled={!ready || busy ? true : undefined}
          onClick={(e) => {
            if (!ready || busy) {
              e.preventDefault();
              return;
            }
            onAdd({
              reason: reason.trim(),
              kind: heightFt === null ? "whole_wall" : "band",
              wallIndexes: [...picked].sort((a, b) => a - b),
              heightFt,
            });
          }}
        >
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export interface RoomDeductionsProps {
  room: RoomCard;
  readOnly: boolean;
  onAdd: (d: {
    reason: string;
    kind: "whole_wall" | "band";
    wallIndexes: number[];
    heightFt: number | null;
  }) => Promise<void>;
  onRemove: (deductionId: string) => Promise<void>;
}

export function RoomDeductions({ room, readOnly, onAdd, onRemove }: RoomDeductionsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A manual room has no geometry: no walls to point at, and nothing to derive an area from.
  // Its wall area is edited directly instead, so this section would be a dead control.
  //
  // Walls the scanner LOST (degenerate 0×0 polygons) are excluded the same way: the breakdown
  // one row up calls them "didn't capture", so offering the same wall here as a selectable
  // "0' 0" × 0' 0" · 0.0 sq ft" checkbox is two facts one screen apart — and deducting from a
  // wall with no area is meaningless (the server contributes 0 for it regardless).
  const capturedWalls = room.walls.filter((w) => !wallDidNotCapture(w));
  if (room.source === "manual" || capturedWalls.length === 0) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOpen(false);
    } catch {
      // The detail is a network or validation failure the painter cannot act on; what they CAN
      // do is try again. Never silent — a deduction that did not save changes what the job costs.
      setError("That didn't save — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rded">
      <div className="rded-head">
        <b>Not painted</b>
        {room.netWallsSqft !== null && (
          <span className="rded-net">
            Paintable walls <b>{fmt1(room.netWallsSqft)}</b> sq ft
          </span>
        )}
      </div>

      {room.deductions.length === 0 && !open && (
        <p className="rded-empty">Tile, a shower surround — wall the scan measured but nobody paints.</p>
      )}

      {room.deductions.map((d) => (
        <DeductionRow
          key={d.id}
          reason={d.reason}
          detail={`${d.wallIndexes.length} ${d.wallIndexes.length === 1 ? "wall" : "walls"}${
            d.kind === "whole_wall" ? "" : " · to " + fmt1((d.heightM ?? 0) * 3.280839895) + " ft"
          }`}
          sqft={d.sqft}
          busy={busy}
          onRemove={() => void run(() => onRemove(d.id))}
        />
      ))}

      {error && (
        <p className="rded-err" role="alert">
          {error}
        </p>
      )}

      {readOnly ? null : open ? (
        <AddDeductionForm
          walls={capturedWalls}
          busy={busy}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
          onAdd={(d) => void run(() => onAdd(d))}
        />
      ) : (
        <button type="button" className="rded-add" onClick={() => setOpen(true)}>
          Add
        </button>
      )}
    </div>
  );
}
