import type { Result, AppError } from "@mallet/shared/types";
import { conflict, notFound, validation, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type { MeasurementRepository, StoredQuantity } from "../domain/measurement-repository";

export interface ConfirmQuantityCommand {
  readonly captureId: string;
  readonly kind: PaintingQuantityKind;
  readonly value: number;
}

// Accepts a value for a quantity the system couldn't derive with confidence (e.g. a vaulted
// ceiling). Only legal on a row currently 'needs_confirm' — confirming an already-resolved row
// would silently discard whatever state it was actually in, so that case is a surfaced error.
export class ConfirmQuantityUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ConfirmQuantityCommand, orgId: string): Promise<Result<StoredQuantity, AppError>> {
    if (!Number.isFinite(cmd.value) || cmd.value < 0) {
      return err(validation("confirm value must be a finite number >= 0", "value"));
    }

    const existing = await this.repo.getCapture(cmd.captureId);
    if (existing === null) return err(notFound("room capture not found"));

    const quantity = existing.quantities.find((q) => q.kind === cmd.kind);
    if (quantity === undefined) return err(notFound(`no "${cmd.kind}" quantity on this room capture`));
    if (quantity.status !== "needs_confirm") {
      return err(conflict("nothing to confirm", cmd.kind));
    }

    const affected = await this.repo.setQuantity(cmd.captureId, cmd.kind, { value: cmd.value, status: "confirmed" });
    if (affected === 0) return err(notFound("room capture not found"));

    logger.info({ captureId: cmd.captureId, kind: cmd.kind, orgId }, "measurements.quantity_confirmed");

    return ok({
      kind: cmd.kind,
      value: cmd.value,
      derivedValue: quantity.derivedValue,
      status: "confirmed",
      // Confirming a run says nothing about how tall the trim is — the stored height rides
      // through untouched rather than being reset by an unrelated edit.
      heightIn: quantity.heightIn,
    });
  }
}
