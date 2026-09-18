import type { Result, AppError } from "@mallet/shared/types";
import { notFound, validation, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { SiteCapture, pitchCorrectedArea, type SiteSurface } from "../domain/site-capture";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface UpdateSiteCaptureCommand {
  readonly captureId: string;
  readonly name?: string;
  // Surface/pitch change: 'flat' clears the pitch, 'pitched' requires pitchRise. Sending
  // pitchRise alone re-pitches an already-pitched surface.
  readonly surface?: SiteSurface;
  readonly pitchRise?: number;
  // Manual area override — only honored for source 'manual'; a traced capture's area is always
  // recomputed from its stored footprint + pitch.
  readonly areaSqft?: number;
}

// Updates a site capture: rename, surface/pitch change (area recomputed server-side from the
// STORED footprint — never a client-sent area), or a typed area override for manual captures.
export class UpdateSiteCaptureUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: UpdateSiteCaptureCommand, orgId: string): Promise<Result<SiteCapture, AppError>> {
    const existing = await this.repo.getSiteCapture(cmd.captureId);
    if (existing === null) return err(notFound("site capture not found"));
    const current = existing.props;

    const surface = cmd.surface ?? current.surface;
    let pitchRise: number | null;
    if (surface === "flat") {
      pitchRise = null;
    } else if (cmd.pitchRise !== undefined) {
      pitchRise = cmd.pitchRise;
    } else if (cmd.surface === "pitched" && current.surface === "flat") {
      // Flipping flat -> pitched without a pitch would silently keep a null pitch; the domain
      // rejects that anyway, but name the real problem here.
      return err(validation("pitch is required when changing a surface to pitched", "pitchRise"));
    } else {
      pitchRise = current.pitchRise;
    }

    if (cmd.areaSqft !== undefined && current.source !== "manual") {
      return err(
        validation("area is derived from the trace for an aerial capture — change the pitch instead", "areaSqft"),
      );
    }

    // The working area: traced captures recompute from the stored footprint + (possibly new)
    // pitch; manual captures take the override when given, else keep the current value.
    let areaSqft: number;
    if (current.footprintSqft !== null) {
      areaSqft = pitchCorrectedArea(current.footprintSqft, surface === "pitched" ? (pitchRise ?? 0) : 0);
    } else {
      areaSqft = cmd.areaSqft ?? current.areaSqft;
    }

    const nextResult = SiteCapture.create({
      ...current,
      name: cmd.name ?? current.name,
      surface,
      pitchRise,
      areaSqft,
      updatedAt: this.clock.now(),
    });
    if (!nextResult.ok) return err(nextResult.error);
    const next = nextResult.value;

    const affected = await this.repo.updateSiteCapture(next);
    if (affected === 0) return err(notFound("site capture not found"));

    logger.info({ captureId: cmd.captureId, orgId }, "measurements.site_capture_updated");

    return ok(next);
  }
}
