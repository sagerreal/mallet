import type { Result, AppError } from "@mallet/shared/types";
import { notFound, validation, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type { MeasurementRepository, QuantityStatus, StoredQuantity } from "../domain/measurement-repository";

export interface OverrideQuantityCommand {
  readonly captureId: string;
  readonly kind: PaintingQuantityKind;
  readonly value: number;
}

// User-edits a quantity's value. On a scanned capture this diverges the working value from the
// derived one (status 'override', derivedValue left untouched so the original scan reading is
// never lost). A manual capture has no derived value to diverge from, so it stays 'confirmed'.
export class OverrideQuantityUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: OverrideQuantityCommand, orgId: string): Promise<Result<StoredQuantity, AppError>> {
    if (!Number.isFinite(cmd.value) || cmd.value < 0) {
      return err(validation("override value must be a finite number >= 0", "value"));
    }

    const existing = await this.repo.getCapture(cmd.captureId);
    if (existing === null) return err(notFound("room capture not found"));

    const status: QuantityStatus = existing.capture.props.source === "manual" ? "confirmed" : "override";

    const affected = await this.repo.setQuantity(cmd.captureId, cmd.kind, { value: cmd.value, status });
    if (affected === 0) return err(notFound("room capture not found"));

    const previous = existing.quantities.find((q) => q.kind === cmd.kind);

    logger.info({ captureId: cmd.captureId, kind: cmd.kind, orgId }, "measurements.quantity_overridden");

    return ok({
      kind: cmd.kind,
      value: cmd.value,
      derivedValue: previous?.derivedValue ?? null,
      status,
      // Overriding the run says nothing about how tall the trim is — same rule as confirm.
      heightIn: previous?.heightIn ?? null,
    });
  }
}
