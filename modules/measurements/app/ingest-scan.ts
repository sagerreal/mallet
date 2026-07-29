import type { JobId, Result, AppError } from "@mallet/shared/types";
import { asOrgId, conflict, notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { RoomCapture } from "../domain/room-capture";
import { parseNormalizedGeometry } from "../domain/normalized-geometry";
import { derivePaintingQuantities } from "../domain/derive-painting";
import {
  DuplicateCaptureError,
  JobNotFoundError,
  type MeasurementRepository,
  type RoomCaptureWithQuantities,
  type StoredQuantity,
} from "../domain/measurement-repository";

export interface IngestScanCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly jobId: JobId;
  readonly roomName: string;
  readonly capturedAt: Date;
  readonly rawPayload: unknown;
  readonly geometry: unknown; // untrusted wire payload — parsed by parseNormalizedGeometry
}

// Ingests a fresh RoomPlan scan: parse the wire geometry, derive painting quantities from it,
// build the RoomCapture aggregate, and persist both atomically via the repository.
export class IngestScanUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: IngestScanCommand, orgId: string): Promise<Result<RoomCaptureWithQuantities, AppError>> {
    const geometryResult = parseNormalizedGeometry(cmd.geometry);
    if (!geometryResult.ok) return err(geometryResult.error);
    const geometry = geometryResult.value;

    const now = this.clock.now();
    const captureResult = RoomCapture.create({
      id: cmd.id ?? this.ids.newId(),
      orgId: asOrgId(orgId),
      jobId: cmd.jobId,
      roomName: cmd.roomName,
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
    const capture = captureResult.value;

    const quantities = derivePaintingQuantities(geometry);

    try {
      await this.repo.createCapture(capture, quantities);
    } catch (e) {
      if (e instanceof DuplicateCaptureError) {
        // Retry-safe ingest: the same client-authored id was already persisted (flaky network,
        // app relaunch resubmitting) — return the existing capture instead of failing, so a
        // retry is truly idempotent (same DTO shape, not a second write).
        const existing = await this.repo.getCapture(e.id);
        if (existing === null) {
          // Freak race (concurrent archive) or an id collision with an unrelated org's capture
          // that RLS hides from getCapture — never silently succeed with no data to return.
          return err(conflict("room capture could not be retrieved after a duplicate id conflict"));
        }
        logger.info({ captureId: e.id, jobId: cmd.jobId, orgId }, "measurements.scan_ingest_deduped");
        return ok(existing);
      }
      if (e instanceof JobNotFoundError) {
        return err(notFound("job not found"));
      }
      throw e;
    }

    // Mirror what the repository does at persistence time: a derived quantity's derivedValue
    // starts equal to its value; a needs_confirm row (no confident derivation) starts null.
    // Sorted alphabetically by kind to match the repo's read-path ordering (`ORDER BY kind` in
    // attachQuantities) — this response is built in-memory, never re-read from the DB, so
    // without an explicit sort it would disagree with what a later getCapture() returns for the
    // same capture (e.g. the duplicate-id retry path below).
    const storedQuantities: StoredQuantity[] = quantities
      .map((q) => ({
        kind: q.kind,
        value: q.value,
        derivedValue: q.status === "needs_confirm" ? null : q.value,
        status: q.status,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind));

    logger.info({ captureId: capture.props.id, jobId: cmd.jobId, orgId }, "measurements.scan_ingested");

    return ok({ capture, quantities: storedQuantities });
  }
}
