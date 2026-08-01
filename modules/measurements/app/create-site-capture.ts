import type { JobId, Result, AppError } from "@mallet/shared/types";
import { asOrgId, notFound, validation, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import {
  SiteCapture,
  pitchCorrectedArea,
  type SiteCaptureSource,
  type SiteSurface,
  type SitePolygon,
} from "../domain/site-capture";
import { JobNotFoundError, type MeasurementRepository } from "../domain/measurement-repository";

export interface CreateSiteCaptureCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly jobId: JobId;
  readonly name: string;
  readonly source: SiteCaptureSource;
  readonly surface: SiteSurface;
  readonly pitchRise?: number; // required when surface is 'pitched'
  // Traced ('aerial_trace_v1') inputs — the server derives areaSqft from these:
  readonly polygon?: SitePolygon;
  readonly footprintSqft?: number;
  readonly perimeterLnft?: number;
  // Manual input — the typed working area, only honored when source is 'manual':
  readonly areaSqft?: number;
}

// Creates an outdoor site capture (driveway, patio, walkway, roof facet). For a traced capture
// the WORKING area is derived server-side from the traced footprint + pitch
// (pitchCorrectedArea) — a client-sent area is never trusted. For a manual capture the caller
// types the area directly and there is no trace to derive from.
export class CreateSiteCaptureUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateSiteCaptureCommand, orgId: string): Promise<Result<SiteCapture, AppError>> {
    let areaSqft: number;
    if (cmd.source === "aerial_trace_v1") {
      if (cmd.footprintSqft === undefined) {
        return err(validation("footprint is required for a traced capture", "footprintSqft"));
      }
      if (!Number.isFinite(cmd.footprintSqft) || cmd.footprintSqft <= 0) {
        return err(validation("footprint must be a finite number greater than 0", "footprintSqft"));
      }
      areaSqft = pitchCorrectedArea(cmd.footprintSqft, cmd.surface === "pitched" ? (cmd.pitchRise ?? 0) : 0);
    } else {
      if (cmd.areaSqft === undefined) {
        return err(validation("area is required for a manual capture", "areaSqft"));
      }
      areaSqft = cmd.areaSqft;
    }

    const now = this.clock.now();
    const captureResult = SiteCapture.create({
      id: cmd.id ?? this.ids.newId(),
      orgId: asOrgId(orgId),
      jobId: cmd.jobId,
      name: cmd.name,
      source: cmd.source,
      surface: cmd.surface,
      pitchRise: cmd.surface === "pitched" ? (cmd.pitchRise ?? null) : null,
      polygon: cmd.polygon ?? null,
      footprintSqft: cmd.footprintSqft ?? null,
      areaSqft,
      perimeterLnft: cmd.perimeterLnft ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (!captureResult.ok) return err(captureResult.error);
    const capture = captureResult.value;

    try {
      await this.repo.createSiteCapture(capture);
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        return err(notFound("job not found"));
      }
      throw e;
    }

    logger.info({ captureId: capture.props.id, jobId: cmd.jobId, orgId }, "measurements.site_capture_created");

    return ok(capture);
  }
}
