import type { JobId, LeadId, ServiceId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { RoomQuantitiesReader, PaintingQuantityKind } from "@mallet/measurements";
import type { RateServicesReader, RateService } from "../domain/rate-services-reader";

export interface JobLeadReader {
  // Just enough of a job to resolve its lead — never the full aggregate, so this use-case does
  // not need jobs' whole JobRepository surface (mirrors modules/quoting's ServiceNameReader-style
  // narrow ports). Returns null when the job does not exist (or is not this org's).
  findLeadId(jobId: JobId): Promise<LeadId | null>;
}

export interface BuildFromMeasurementsCommand {
  readonly jobId: JobId;
}

export interface SeedLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly measuredKind: PaintingQuantityKind;
  readonly roomName: string;
  // The pricebook service this line was priced from — free to carry now (the reader already
  // selects it), future linkage (e.g. edit-delta mining, service-level reporting) needs it.
  readonly serviceId: ServiceId;
}

export interface MeasuredGap {
  readonly kind: PaintingQuantityKind;
  readonly label: string;
}

export interface BuildFromMeasurementsResult {
  readonly leadId: LeadId;
  readonly seedLines: readonly SeedLine[];
  readonly gaps: readonly MeasuredGap[];
  readonly unconfirmedRooms: readonly string[];
}

// Human labels for a gaps entry — the office-facing name for each measured kind, not the DB enum.
const KIND_LABELS: Record<PaintingQuantityKind, string> = {
  walls_sqft: "Walls",
  ceiling_sqft: "Ceiling",
  baseboard_lnft: "Baseboard",
  crown_lnft: "Crown",
  doors_count: "Doors",
  windows_count: "Windows",
};

// Picks, for each measured kind, the lowest-position ACTIVE service priced against it — mirrors
// how the pricebook list orders services for display: (position, then name) — see
// drizzle-service-repository.ts's list() comment — so the service an office sees at the top of a
// kind's group is the one that gets used.
//
// The tie-break is explicit here (position, then name, then id) rather than relying on the
// reader returning services in that order: two UI-created services both default to position 0,
// so a same-position tie is common, not an edge case, and the winner must be the SAME regardless
// of which order the reader happens to hand them back in — this comparison is independent of
// input order (verified in build-from-measurements.test.ts by feeding the same two services in
// both array orders and asserting the same winner).
const isLowerRanked = (a: RateService, b: RateService): boolean => {
  if (a.position !== b.position) return a.position < b.position;
  if (a.name !== b.name) return a.name < b.name;
  return a.id < b.id;
};

const lowestPositionByKind = (
  services: readonly RateService[],
): Map<PaintingQuantityKind, RateService> => {
  const byKind = new Map<PaintingQuantityKind, RateService>();
  for (const svc of services) {
    const current = byKind.get(svc.measuredBy);
    if (!current || isLowerRanked(svc, current)) {
      byKind.set(svc.measuredBy, svc);
    }
  }
  return byKind;
};

/**
 * Turns a job's scanned rooms into estimate seed lines the composer can drop straight into a
 * draft (see modules/quoting/app/draft-estimate.ts's EstimateLineInput). One line per
 * (room, measured kind) pair that has both a resolved quantity and an active priced service;
 * everything else becomes a gap the office has to fill in by hand, or is silently skipped
 * (zero/absent quantities never produce a line — there is nothing to charge for).
 *
 * costCents semantics (verified against EstimateLine/DraftEstimateCommand, modules/quoting/domain
 * /estimate.ts): `amount()` computes `quantity * rate` only — cost is never separately scaled by
 * quantity anywhere in quoting/jobs/invoicing. `EstimateLine.create` validates `cost` with the
 * exact same shape as `rate` ("cost cannot be negative", no distinct "total" semantics), and
 * pricebook.costCents is itself stored PER SERVICE UNIT (see app/(office)/settings/pricebook-seed.ts
 * — e.g. a $2400 water heater install carries a $1180 costCents, clearly per-unit, not a line
 * total). So costCents here mirrors rateCents: PER-UNIT, taken straight from the service's
 * costCents with no quantity multiplication — line-level cost totals are a presentation concern
 * for whatever reads the eventual EstimateLine, exactly like rate.
 */
export class BuildFromMeasurementsUseCase {
  constructor(
    private readonly jobs: JobLeadReader,
    private readonly rooms: RoomQuantitiesReader,
    private readonly rates: RateServicesReader,
  ) {}

  async exec(cmd: BuildFromMeasurementsCommand): Promise<Result<BuildFromMeasurementsResult, AppError>> {
    const leadId = await this.jobs.findLeadId(cmd.jobId);
    if (!leadId) return err(notFound("job"));

    const [rooms, services] = await Promise.all([
      this.rooms.readForJob(cmd.jobId),
      this.rates.listMeasuredByActive(),
    ]);

    const serviceByKind = lowestPositionByKind(services);
    const seenKinds = new Set<PaintingQuantityKind>();
    const seedLines: SeedLine[] = [];
    const unconfirmedRooms: string[] = [];

    for (const room of rooms) {
      if (room.hasUnconfirmed) unconfirmedRooms.push(room.roomName);

      for (const quantity of room.quantities) {
        seenKinds.add(quantity.kind);
        // Zero/absent quantities seed nothing — there is nothing to charge for. `readForJob`
        // already excludes null values, so only the zero case needs guarding here.
        if (quantity.value === 0) continue;

        const service = serviceByKind.get(quantity.kind);
        if (!service) continue; // no active priced service for this kind — surfaced as a gap below

        seedLines.push({
          description: `${room.roomName} — ${service.name}`,
          quantity: quantity.value,
          rateCents: service.unitPriceCents,
          costCents: service.costCents,
          measuredKind: quantity.kind,
          roomName: room.roomName,
          serviceId: service.id,
        });
      }
    }

    const gaps: MeasuredGap[] = [];
    for (const kind of seenKinds) {
      if (!serviceByKind.has(kind)) {
        gaps.push({ kind, label: KIND_LABELS[kind] });
      }
    }

    return ok({ leadId, seedLines, gaps, unconfirmedRooms });
  }
}
