import type { JobId, LeadId, ServiceId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type {
  RoomQuantitiesReader,
  SiteQuantitiesReader,
  SiteQuantitiesForJob,
} from "@mallet/measurements";
import type { RateService, MeasuredQuantityKind } from "../domain/rate-services-reader";
import type { RateServicesReader } from "../domain/rate-services-reader";

export interface JobLeadReader {
  // Just enough of a job to resolve its lead — never the full aggregate, so this use-case does
  // not need jobs' whole JobRepository surface (mirrors modules/quoting's ServiceNameReader-style
  // narrow ports). Returns null when the job does not exist (or is not this org's).
  findLeadId(jobId: JobId): Promise<LeadId | null>;
}

export interface BuildFromMeasurementsCommand {
  readonly jobId: JobId;
  // Optional per-capture filter: when present, only rooms/sites whose CAPTURE name (the
  // room's roomName, the site's stored name — NOT the pitch-decorated sourceName) is in
  // this set contribute seed lines, gaps and unconfirmed flags. Absent = whole job,
  // exactly the pre-filter behavior (additive, backward-compatible). The composer's
  // "Seed lines" per-surface action is the caller.
  readonly sourceNames?: readonly string[];
}

export interface SeedLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly measuredKind: MeasuredQuantityKind;
  // The measured thing this line was priced from — a room's name for painting kinds, a traced
  // surface's name for site kinds. This is the line's provenance: the description leads with it,
  // so the office can see "Driveway — Seal coating" came from the Driveway trace.
  readonly sourceName: string;
  // The pricebook service this line was priced from — free to carry now (the reader already
  // selects it), future linkage (e.g. edit-delta mining, service-level reporting) needs it.
  readonly serviceId: ServiceId;
}

export interface MeasuredGap {
  readonly kind: MeasuredQuantityKind;
  readonly label: string;
}

export interface BuildFromMeasurementsResult {
  readonly leadId: LeadId;
  readonly seedLines: readonly SeedLine[];
  readonly gaps: readonly MeasuredGap[];
  readonly unconfirmedRooms: readonly string[];
}

// Human labels for a gaps entry — the office-facing name for each measured kind, not the DB enum.
const KIND_LABELS: Record<MeasuredQuantityKind, string> = {
  walls_sqft: "Walls",
  ceiling_sqft: "Ceiling",
  soffit_sqft: "Soffit / bulkhead",
  baseboard_lnft: "Baseboard",
  crown_lnft: "Crown",
  doors_count: "Doors",
  windows_count: "Windows",
  site_sqft: "Site area",
  site_lnft: "Site perimeter",
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
): Map<MeasuredQuantityKind, RateService> => {
  const byKind = new Map<MeasuredQuantityKind, RateService>();
  for (const svc of services) {
    if (svc.measuredBy === "hour") continue; // hourly services are labor, not measured rates
    const current = byKind.get(svc.measuredBy);
    if (!current || isLowerRanked(svc, current)) {
      byKind.set(svc.measuredBy, svc);
    }
  }
  return byKind;
};

// The line's leading source label. Pitched surfaces name their pitch — the quantity is the
// CORRECTED roof area, not the traced footprint, and the line should say which slope it was
// corrected at ("Main roof at 6/12 — Shingle install").
const siteSourceName = (site: SiteQuantitiesForJob): string =>
  site.surface === "pitched" && site.pitchRise !== null
    ? `${site.name} at ${site.pitchRise}/12`
    : site.name;

// The measurable dimensions one capture offers: the working area always (pitch-corrected for
// pitched surfaces), the traced perimeter when the capture has one (manual entries do not — a
// missing perimeter is "never captured", not a gap, mirroring the rooms' null-quantity rule).
const siteQuantities = (
  site: SiteQuantitiesForJob,
): { kind: MeasuredQuantityKind; value: number }[] => {
  const quantities: { kind: MeasuredQuantityKind; value: number }[] = [
    { kind: "site_sqft", value: site.areaSqft },
  ];
  if (site.perimeterLnft !== null) {
    quantities.push({ kind: "site_lnft", value: site.perimeterLnft });
  }
  return quantities;
};

/**
 * Turns a job's measurements — scanned rooms AND traced site surfaces — into estimate seed
 * lines the composer can drop straight into a draft (see modules/quoting/app/draft-estimate.ts's
 * EstimateLineInput). One line per (source, measured kind) pair that has both a resolved
 * quantity and an active priced service; everything else becomes a gap the office has to fill
 * in by hand, or is silently skipped (zero/absent quantities never produce a line — there is
 * nothing to charge for). Site lines use the capture's WORKING area (pitch-corrected for
 * pitched surfaces — the source label carries the pitch) and its traced perimeter.
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
    private readonly sites: SiteQuantitiesReader,
    private readonly rates: RateServicesReader,
  ) {}

  async exec(cmd: BuildFromMeasurementsCommand): Promise<Result<BuildFromMeasurementsResult, AppError>> {
    const leadId = await this.jobs.findLeadId(cmd.jobId);
    if (!leadId) return err(notFound("job"));

    const [allRooms, allSites, services] = await Promise.all([
      this.rooms.readForJob(cmd.jobId),
      this.sites.readForJob(cmd.jobId),
      this.rates.listMeasuredByActive(),
    ]);

    // Capture-name filter (trimmed exact match — the names come from the same rows the
    // composer panel lists, so no fuzzier matching is warranted). A name that matches
    // nothing simply contributes nothing; the caller sees an empty seed, not an error.
    const nameFilter =
      cmd.sourceNames === undefined ? null : new Set(cmd.sourceNames.map((n) => n.trim()));
    const rooms =
      nameFilter === null ? allRooms : allRooms.filter((r) => nameFilter.has(r.roomName.trim()));
    const sites =
      nameFilter === null ? allSites : allSites.filter((s) => nameFilter.has(s.name.trim()));

    const serviceByKind = lowestPositionByKind(services);
    const seenKinds = new Set<MeasuredQuantityKind>();
    const seedLines: SeedLine[] = [];
    const unconfirmedRooms: string[] = [];

    const seed = (sourceName: string, kind: MeasuredQuantityKind, value: number): void => {
      seenKinds.add(kind);
      // Zero/absent quantities seed nothing — there is nothing to charge for. Both readers
      // already exclude null values, so only the zero case needs guarding here.
      if (value === 0) return;

      const service = serviceByKind.get(kind);
      if (!service) return; // no active priced service for this kind — surfaced as a gap below

      seedLines.push({
        description: `${sourceName} — ${service.name}`,
        quantity: value,
        rateCents: service.unitPriceCents,
        costCents: service.costCents,
        measuredKind: kind,
        sourceName,
        serviceId: service.id,
      });
    };

    for (const room of rooms) {
      if (room.hasUnconfirmed) unconfirmedRooms.push(room.roomName);
      for (const quantity of room.quantities) {
        seed(room.roomName, quantity.kind, quantity.value);
      }
    }

    for (const site of sites) {
      const sourceName = siteSourceName(site);
      for (const quantity of siteQuantities(site)) {
        seed(sourceName, quantity.kind, quantity.value);
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
