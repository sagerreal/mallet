import type { Result, AppError } from "@mallet/shared/types";
import { notFound, validation, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository, StoredDeduction } from "../domain/measurement-repository";
import { CaptureNotFoundError } from "../domain/measurement-repository";
import type { DeductionKind } from "../domain/wall-deductions";

export interface AddDeductionCommand {
  readonly captureId: string;
  readonly reason: string;
  readonly kind: DeductionKind;
  readonly wallIndexes: readonly number[];
  /** Band height in METRES. Null for whole_wall. */
  readonly heightM: number | null;
}

/** Matches the reason check constraint — validated here so the user gets a message, not a 500. */
const MAX_REASON = 60;
/** No room has a wall this tall; a band beyond it is a bad unit, not a tall room. */
const MAX_BAND_HEIGHT_M = 10;

/**
 * Records wall area a room does NOT get painted — the tile band, the fully-tiled shower wall.
 *
 * Stores INPUTS ONLY: which walls, and how high. The square footage is derived from the capture's
 * geometry on read (wall-deductions.ts), so a re-scan re-derives rather than leaving a stale
 * number priced into an estimate. The client never sends an area, for the same reason
 * site_captures.area_sqft is server-derived.
 *
 * A deduction is additive and independent — several can sit on one room (tile to 4ft on three
 * walls, plus the whole shower wall) and each keeps its own reason, which is the point: an
 * overridden walls_sqft loses WHY, and six weeks later nobody can tell tile from a mistake.
 */
export class AddDeductionUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddDeductionCommand, orgId: string): Promise<Result<StoredDeduction, AppError>> {
    const reason = cmd.reason.trim();
    if (reason.length === 0 || reason.length > MAX_REASON) {
      return err(validation(`reason must be 1-${MAX_REASON} characters`, "reason"));
    }

    if (cmd.wallIndexes.length === 0) {
      return err(validation("select at least one wall", "wallIndexes"));
    }
    if (cmd.wallIndexes.some((i) => !Number.isInteger(i) || i < 0)) {
      return err(validation("wall indexes must be whole numbers", "wallIndexes"));
    }

    // The kind/height pair is also a check constraint. Validated here so a mismatch is a typed
    // message rather than a constraint violation surfacing from the driver.
    if (cmd.kind === "whole_wall" && cmd.heightM !== null) {
      return err(validation("a whole-wall deduction takes no height", "heightM"));
    }
    if (cmd.kind === "band") {
      if (cmd.heightM === null || !Number.isFinite(cmd.heightM) || cmd.heightM <= 0) {
        return err(validation("a band needs a height above zero", "heightM"));
      }
      if (cmd.heightM > MAX_BAND_HEIGHT_M) {
        return err(validation("that height is not a room measurement", "heightM"));
      }
    }

    const capture = await this.repo.getCapture(cmd.captureId);
    if (capture === null) return err(notFound("room capture not found"));

    // A manual room has no geometry, so there are no walls to point at and nothing to derive an
    // area from. Refuse rather than store a deduction that can only ever compute to zero.
    if (capture.capture.props.source === "manual") {
      return err(validation("this room was entered by hand — edit its wall area directly", "captureId"));
    }

    // Duplicates collapse before storage: the same wall named twice is one wall, and the derived
    // area already de-duplicates. Storing the raw list would show "3 walls" on a 2-wall deduction.
    const deduction: StoredDeduction = {
      id: this.ids.newId(),
      reason,
      kind: cmd.kind,
      wallIndexes: [...new Set(cmd.wallIndexes)].sort((a, b) => a - b),
      heightM: cmd.heightM,
    };

    try {
      await this.repo.addDeduction(cmd.captureId, deduction);
    } catch (e: unknown) {
      // The capture was archived between the read above and this insert.
      if (e instanceof CaptureNotFoundError) return err(notFound("room capture not found"));
      throw e;
    }

    logger.info(
      { captureId: cmd.captureId, kind: cmd.kind, walls: deduction.wallIndexes.length, orgId },
      "measurements.deduction_added",
    );

    return ok(deduction);
  }
}
