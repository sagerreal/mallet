import type { JobId, Result, AppError } from "@mallet/shared/types";
import { asOrgId, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { RoomCapture } from "../domain/room-capture";
import { parseNormalizedGeometry } from "../domain/normalized-geometry";
import { derivePaintingQuantities } from "../domain/derive-painting";
import type { MeasurementRepository, RoomCaptureWithQuantities, StoredQuantity } from "../domain/measurement-repository";

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
    await this.repo.createCapture(capture, quantities);

    // Mirror what the repository does at persistence time: a derived quantity's derivedValue
    // starts equal to its value; a needs_confirm row (no confident derivation) starts null.
    const storedQuantities: StoredQuantity[] = quantities.map((q) => ({
      kind: q.kind,
      value: q.value,
      derivedValue: q.status === "needs_confirm" ? null : q.value,
      status: q.status,
    }));

    logger.info({ captureId: capture.props.id, jobId: cmd.jobId, orgId }, "measurements.scan_ingested");

    return ok({ capture, quantities: storedQuantities });
  }
}
