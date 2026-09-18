import type { Result, AppError } from "@mallet/shared/types";
import { notFound, validation, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository, StoredQuantity } from "../domain/measurement-repository";
import {
  isTrimRunKind,
  isValidTrimHeight,
  MAX_TRIM_HEIGHT_IN,
  type TrimRunKind,
} from "../domain/trim-area";
import type { PaintingQuantityKind } from "../domain/derive-painting";

export interface SetTrimHeightCommand {
  readonly captureId: string;
  readonly kind: PaintingQuantityKind;
  /** Inches. Null clears the height — the room goes back to being priced by the foot. */
  readonly heightIn: number | null;
}

/**
 * Records how tall a room's baseboard or crown is.
 *
 * Deliberately NOT part of confirm/override. A height is not the measurement — the run stays
 * whatever the scanner traced or the painter corrected it to. Folding the height into
 * setQuantity's patch would make typing "5.25" also a status transition, so a room where
 * somebody noted the base height would read as confirmed when nobody had checked the run at all.
 *
 * Setting a height on a kind that has no run is refused rather than ignored: walls and ceilings
 * are already areas, and silently dropping the write would leave the caller believing a number
 * had been saved.
 */
export class SetTrimHeightUseCase {
  constructor(private readonly repo: MeasurementRepository) {}

  async exec(cmd: SetTrimHeightCommand, orgId: string): Promise<Result<StoredQuantity, AppError>> {
    if (!isTrimRunKind(cmd.kind)) {
      return err(validation(`"${cmd.kind}" is not measured as a run, so it has no height`, "kind"));
    }
    if (cmd.heightIn !== null && !isValidTrimHeight(cmd.heightIn)) {
      return err(
        validation(`trim height must be more than 0 and at most ${MAX_TRIM_HEIGHT_IN} inches`, "heightIn"),
      );
    }

    const kind: TrimRunKind = cmd.kind;

    const existing = await this.repo.getCapture(cmd.captureId);
    if (existing === null) return err(notFound("room capture not found"));

    const quantity = existing.quantities.find((q) => q.kind === kind);
    if (quantity === undefined) return err(notFound(`no "${kind}" quantity on this room capture`));

    const affected = await this.repo.setTrimHeight(cmd.captureId, kind, cmd.heightIn);
    if (affected === 0) return err(notFound("room capture not found"));

    logger.info({ captureId: cmd.captureId, kind, orgId }, "measurements.trim_height_set");

    // The run and its status are untouched by design — only the height moved.
    return ok({
      kind,
      value: quantity.value,
      derivedValue: quantity.derivedValue,
      status: quantity.status,
      heightIn: cmd.heightIn,
    });
  }
}
