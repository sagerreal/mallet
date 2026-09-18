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
  DuplicateCaptureError,
  JobNotFoundError,
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
      if (e instanceof DuplicateCaptureError) {
        // Defensive, NOT a retry path: `next.props.id` is freshly minted by `this.ids.newId()`
        // on every call to exec(), so a genuine client retry can never collide with it — a
        // real retry instead dies earlier, at `supersede`'s SupersedeTargetError CONFLICT
        // (the old capture is already superseded by the first attempt's success). This branch
        // exists only so an id-generator collision (or a future caller reusing an id) degrades
        // to returning the existing row instead of an unhandled throw.
        const existing = await this.repo.getCapture(e.id);
        if (existing === null) {
          return err(conflict("room capture could not be retrieved after a duplicate id conflict"));
        }
        logger.info({ captureId: e.id, supersedes: cmd.captureId, orgId }, "measurements.room_rescan_deduped");
        return ok(existing);
      }
      // JobNotFound cannot happen on rescan in practice — the new capture's jobId is copied
      // from the OLD capture, which already resolved via repo.getCapture above — but caught
      // defensively so a future refactor can't turn this into an unhandled throw.
      if (e instanceof JobNotFoundError) {
        return err(notFound("job not found"));
      }
      throw e;
    }

    // Sorted alphabetically by kind to match the repo's read-path ordering (`ORDER BY kind` in
    // attachQuantities) — see the identical comment in ingest-scan.ts.
    const storedQuantities: StoredQuantity[] = quantities
      .map((q) => ({
        kind: q.kind,
        value: q.value,
        derivedValue: q.derivedValue,
        status: q.status,
        // A fresh derivation has no height: the scanner reports a perimeter, not how tall the
        // trim standing on it is. Null until somebody types it on the room card.
        heightIn: null,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind));

    logger.info({ captureId: next.props.id, supersedes: cmd.captureId, orgId }, "measurements.room_rescanned");

    // Deductions are DELIBERATELY not carried over. They key on WALL INDEXES into the geometry
    // they were made against; a re-scan produces different geometry, where index 2 may be a
    // different wall or no wall at all. Carrying them would silently deduct the wrong surface, so
    // the painter re-taps against what was actually scanned.
    return ok({ capture: next, quantities: storedQuantities, deductions: [] });
  }
}
