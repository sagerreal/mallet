import type { Result, AppError } from "@mallet/shared/types";
import { conflict, notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { RoomCapture } from "../domain/room-capture";
import { parseNormalizedGeometry } from "../domain/normalized-geometry";
import { derivePaintingQuantities } from "../domain/derive-painting";
import {
  SupersedeTargetError,
  type MeasurementRepository,
  type RoomCaptureWithQuantities,
  type StoredQuantity,
} from "../domain/measurement-repository";

export interface RescanRoomCommand {
  readonly captureId: string;
  readonly rawPayload: unknown;
  readonly geometry: unknown; // untrusted wire payload — parsed by parseNormalizedGeometry
  readonly capturedAt: Date;
}

// Re-scans a room: the new capture inherits the job and room name of the capture it supersedes.
// Any quantity overrides on the old capture are intentionally dropped — a fresh scan starts from
// a clean derivation (Global Constraints, phase-1 plan).
export class RescanRoomUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RescanRoomCommand, orgId: string): Promise<Result<RoomCaptureWithQuantities, AppError>> {
    const geometryResult = parseNormalizedGeometry(cmd.geometry);
    if (!geometryResult.ok) return err(geometryResult.error);
    const geometry = geometryResult.value;

    const old = await this.repo.getCapture(cmd.captureId);
    if (old === null) return err(notFound("room capture not found"));

    const now = this.clock.now();
    const captureResult = RoomCapture.create({
      id: this.ids.newId(),
      orgId: old.capture.props.orgId,
      jobId: old.capture.props.jobId,
      roomName: old.capture.props.roomName,
      source: "roomplan_v1",
      rawPayload: cmd.rawPayload ?? null,
      geometry,
      capturedAt: cmd.capturedAt,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (!captureResult.ok) return err(captureResult.error);
    const next = captureResult.value;

    const quantities = derivePaintingQuantities(geometry);

    try {
      await this.repo.supersede(cmd.captureId, next, quantities);
    } catch (e) {
      if (e instanceof SupersedeTargetError) {
        return err(conflict("room capture is no longer current and cannot be superseded"));
      }
      throw e;
    }

    const storedQuantities: StoredQuantity[] = quantities.map((q) => ({
      kind: q.kind,
      value: q.value,
      derivedValue: q.status === "needs_confirm" ? null : q.value,
      status: q.status,
    }));

    logger.info({ captureId: next.props.id, supersedes: cmd.captureId, orgId }, "measurements.room_rescanned");

    return ok({ capture: next, quantities: storedQuantities });
  }
}
