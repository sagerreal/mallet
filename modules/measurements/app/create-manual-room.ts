import type { JobId, Result, AppError } from "@mallet/shared/types";
import { asOrgId, validation, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { RoomCapture } from "../domain/room-capture";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import type { MeasurementRepository, RoomCaptureWithQuantities, StoredQuantity } from "../domain/measurement-repository";

// The full fixed set of painting quantity kinds a room capture tracks (mirrors
// derivePaintingQuantities' output shape) — every manual room gets a row for each of these,
// confirmed where the caller supplied a value, needs_confirm (null) otherwise.
const ALL_PAINTING_QUANTITY_KINDS: readonly PaintingQuantityKind[] = [
  "walls_sqft",
  "ceiling_sqft",
  "baseboard_lnft",
  "crown_lnft",
  "doors_count",
  "windows_count",
];

export interface CreateManualRoomQuantityInput {
  readonly kind: PaintingQuantityKind;
  readonly value: number;
}

export interface CreateManualRoomCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly jobId: JobId;
  readonly roomName: string;
  readonly quantities: readonly CreateManualRoomQuantityInput[];
}

// Creates a manually-measured room: no geometry, no derivation. Each caller-supplied quantity is
// recorded as confirmed; any kind the caller didn't supply is left needs_confirm with a null
// value — the room stays flaggable in the UI rather than silently defaulting to zero.
export class CreateManualRoomUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateManualRoomCommand, orgId: string): Promise<Result<RoomCaptureWithQuantities, AppError>> {
    for (const q of cmd.quantities) {
      if (!Number.isFinite(q.value) || q.value < 0) {
        return err(validation(`quantity value for "${q.kind}" must be a finite number >= 0`, q.kind));
      }
    }

    const now = this.clock.now();
    const captureResult = RoomCapture.create({
      id: cmd.id ?? this.ids.newId(),
      orgId: asOrgId(orgId),
      jobId: cmd.jobId,
      roomName: cmd.roomName,
      source: "manual",
      rawPayload: null,
      geometry: null,
      capturedAt: now,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (!captureResult.ok) return err(captureResult.error);
    const capture = captureResult.value;

    // createCapture's port signature only carries the two states a pure derivation can produce
    // (derived | needs_confirm) — a manual room has no derivation, so every row starts
    // needs_confirm here; provided values are then layered on via setQuantity, which does
    // support the wider 'confirmed' status.
    const initialQuantities: PaintingQuantity[] = ALL_PAINTING_QUANTITY_KINDS.map((kind) => ({
      kind,
      value: null,
      status: "needs_confirm",
    }));
    await this.repo.createCapture(capture, initialQuantities);

    const provided = new Map(cmd.quantities.map((q) => [q.kind, q.value]));
    for (const [kind, value] of provided) {
      await this.repo.setQuantity(capture.props.id, kind, { value, status: "confirmed" });
    }

    const storedQuantities: StoredQuantity[] = ALL_PAINTING_QUANTITY_KINDS.map((kind) => {
      const value = provided.get(kind);
      return value === undefined
        ? { kind, value: null, derivedValue: null, status: "needs_confirm" as const }
        : { kind, value, derivedValue: null, status: "confirmed" as const };
    });

    logger.info({ captureId: capture.props.id, jobId: cmd.jobId, orgId }, "measurements.manual_room_created");

    return ok({ capture, quantities: storedQuantities });
  }
}
