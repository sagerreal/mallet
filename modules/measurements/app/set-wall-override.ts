import type { Result, AppError } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository } from "../domain/measurement-repository";
import type { RoomCapture } from "../domain/room-capture";
import { roomUp, wallDimensions } from "../domain/wall-deductions";

export interface SetWallOverrideCommand {
  readonly captureId: string;
  readonly wallIndex: number;
  /** The painter's area for this wall; null clears the edit and the scanner's number returns. */
  readonly sqft: number | null;
}

export interface WallOverrideResult {
  readonly wallOverrides: Readonly<Record<number, number>>;
  readonly wallsSqft: number;
  /** needs_confirm when a lost wall is still unanswered — the edits are saved, the sum is not yet a fact. */
  readonly wallsStatus: "derived" | "override" | "needs_confirm";
}

// The derivation's own constant (derive-painting.ts) — a truncated copy here made the
// recomputed tenth disagree with the original on ordinary room sizes.
const SQ_METERS_TO_SQFT = 10.763910417;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * "The scanner said wall 3 is 49.7 but I measured 52."
 *
 * The painter's number for ONE wall, the scanner's for the rest — walls_sqft becomes their SUM,
 * status `override` so the audit trail says a human touched it (and what the scanner measured is
 * still on every surface as "measured N"). Clearing the last edit restores the derived total and
 * the derived status: an untouched room must be indistinguishable from one never edited.
 *
 * The alternative this replaces is typing a corrected TOTAL over walls_sqft — which worked, but
 * lost the story: nobody could later see WHICH wall the scanner got wrong, and the per-wall
 * breakdown printed measured numbers that no longer added to the total above them.
 */
export class SetWallOverrideUseCase {
  constructor(private readonly repo: MeasurementRepository) {}

  async exec(cmd: SetWallOverrideCommand, orgId: string): Promise<Result<WallOverrideResult, AppError>> {
    if (cmd.sqft !== null && (!Number.isFinite(cmd.sqft) || cmd.sqft <= 0)) {
      return err(validation("an edited wall needs a real area — a wall that isn't painted is a deduction", "sqft"));
    }

    const existing = await this.repo.getCapture(cmd.captureId);
    if (existing === null) return err(notFound("room capture not found"));
    const capture = existing.capture;

    const geometry = capture.props.geometry;
    if (capture.props.source !== "roomplan_v1" || geometry === null) {
      return err(validation("a hand-entered room has no walls to edit — change its wall area directly", "captureId"));
    }

    // Validate the INTENT against a read (a real wall, a real area)…
    const now = new Date();
    const next = capture.setWallOverride(cmd.wallIndex, cmd.sqft, now);
    if (!next.ok) return err(next.error);

    // …but write ATOMICALLY and total from what actually landed: two people editing two walls
    // must both survive, so the repo patches one key and returns the final map. Null = the
    // capture is gone or was re-scanned out from under this card — refuse loudly; a success
    // here would be an edit that silently never surfaces anywhere.
    const overrides = await this.repo.patchWallOverride(cmd.captureId, cmd.wallIndex, cmd.sqft);
    if (overrides === null) {
      return err(notFound("this room was re-scanned — open the new scan and edit there"));
    }

    // The new total: the painter's number where one exists, the scanner's (unrounded, same as
    // the original derivation) everywhere else. A wall the scanner LOST counts only when the
    // painter has answered it — otherwise the room still has an unmeasured wall and a confident
    // total would be the undercount-as-fact derive-painting's law exists to prevent (the real
    // scan that taught us: 14 of 15 walls lost; one edited wall must not price a 600 sq ft room
    // at 78).
    const up = roomUp(geometry);
    let unanswered = 0;
    const total = round1(
      geometry.walls.reduce((sum, wall, index) => {
        const override = overrides[index];
        if (override !== undefined) return sum + override;
        const areaM2 = wallDimensions(wall, up).areaM2;
        if (areaM2 <= 0) {
          unanswered += 1;
          return sum;
        }
        return sum + areaM2 * SQ_METERS_TO_SQFT;
      }, 0),
    );
    const untouched = Object.keys(overrides).length === 0;
    const wallsQuantity = existing.quantities.find((q) => q.kind === "walls_sqft");
    const derived = wallsQuantity?.derivedValue ?? null;

    // Restoring an untouched room must restore its REAL prior state: a failed scan's walls were
    // needs_confirm (derivedValue null), and "derived" with a null value would be a third state
    // nothing else produces. And while ANY lost wall is still unanswered, the total stays an
    // open question — the per-wall edits are saved, the sum is not yet a fact.
    const patch = untouched
      ? { value: derived, status: derived !== null ? ("derived" as const) : ("needs_confirm" as const) }
      : unanswered > 0
        ? { value: null, status: "needs_confirm" as const }
        : { value: total, status: "override" as const };

    const savedQuantity = await this.repo.setQuantity(cmd.captureId, "walls_sqft", patch);
    if (savedQuantity === 0) return err(notFound("room capture not found"));

    logger.info(
      { captureId: cmd.captureId, wallIndex: cmd.wallIndex, cleared: cmd.sqft === null, orgId },
      "measurements.wall_override_set",
    );

    return ok({
      wallOverrides: overrides,
      wallsSqft: untouched ? (derived ?? total) : total,
      wallsStatus: patch.status,
    });
  }
}
