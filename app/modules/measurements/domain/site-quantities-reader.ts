import type { JobId } from "@mallet/shared/types";
// The ONE edge-classification implementation (pure, dependency-free) — the same
// module the API mapper derives DTO edges with, so a quantity served here can
// never drift from what the tracer shows. See the site-capture.ts note: the
// domain declares its own class unions; this import is functions-only.
import { edgeTotalsFt, isClassified, roofComplexity } from "@/lib/measure/edge-classes";
import type { MeasurementRepository } from "./measurement-repository";
import type { SitePolygon, SiteSurface } from "./site-capture";

// The two dimensions a traced outdoor surface can price against — the site siblings of
// derive-painting's PaintingQuantityKind. `site_sqft` is the WORKING area (pitch-corrected for
// pitched surfaces — material covers the slope, not the footprint); `site_lnft` is the traced
// perimeter (absent for manual entries, which carry no polygon).
export type SiteQuantityKind = "site_sqft" | "site_lnft";

// Narrow read seam for "Build the price" (quoting) to consume site-capture quantities without
// depending on the measurements module's internals — the exact sibling of room-quantities-reader.ts,
// for the same reason: quoting depends on this port; measurements NEVER imports quoting.
/** Per-class roof linears (plan-view ft, 2dp) — derived from the stored polygon on every
 * read, exactly as the DTO mapper derives them; never persisted, never client-trusted. */
export interface SiteEdgeQuantities {
  readonly eaveFt: number;
  readonly rakeFt: number;
  readonly ridgeFt: number;
  readonly hipFt: number;
  readonly valleyFt: number;
}

/** Hip/valley counts for the roofing recipes' waste derivation. */
export interface SiteComplexityQuantities {
  readonly hips: number;
  readonly valleys: number;
  readonly cutUp: boolean;
}

export interface SiteQuantitiesForJob {
  readonly name: string;
  readonly surface: SiteSurface;
  // rise-per-12 for a pitched surface (so the seed line can say which pitch the corrected
  // area was computed at); null for flat.
  readonly pitchRise: number | null;
  // The working area — already pitch-corrected by the domain for pitched surfaces. Never the
  // raw footprint: charging material off the plan view under-bills every sloped roof.
  readonly areaSqft: number;
  // Traced edge length; null for manual entries (no polygon → no perimeter to offer).
  readonly perimeterLnft: number | null;
  // Classed roof linears + complexity; null when the capture is unclassified (legacy traces,
  // flat surfaces, manual entries) — recipe components that need them skip LOUDLY downstream.
  readonly edges: SiteEdgeQuantities | null;
  readonly complexity: SiteComplexityQuantities | null;
}

export interface SiteQuantitiesReader {
  readForJob(jobId: JobId): Promise<SiteQuantitiesForJob[]>;
}

// Concrete adapter over MeasurementRepository.listSiteCaptures (non-archived captures only,
// same contract siteList serves) — constructor-DI so quoting's use-case can be wired to this
// without knowing the repository exists, mirroring MeasurementRoomQuantitiesReader.
export class MeasurementSiteQuantitiesReader implements SiteQuantitiesReader {
  constructor(private readonly repo: MeasurementRepository) {}

  async readForJob(jobId: JobId): Promise<SiteQuantitiesForJob[]> {
    const captures = await this.repo.listSiteCaptures(jobId);

    return captures.map((capture) => ({
      name: capture.props.name,
      surface: capture.props.surface,
      pitchRise: capture.props.pitchRise,
      areaSqft: capture.props.areaSqft,
      perimeterLnft: capture.props.perimeterLnft,
      edges: deriveEdges(capture.props.polygon),
      complexity: deriveComplexity(capture.props.polygon),
    }));
  }
}

const deriveEdges = (polygon: SitePolygon | null): SiteEdgeQuantities | null =>
  polygon !== null && isClassified(polygon.edgeClasses, polygon.interiorLines)
    ? edgeTotalsFt(polygon.vertices, polygon.edgeClasses, polygon.interiorLines)
    : null;

const deriveComplexity = (polygon: SitePolygon | null): SiteComplexityQuantities | null =>
  polygon !== null && isClassified(polygon.edgeClasses, polygon.interiorLines)
    ? roofComplexity(polygon.edgeClasses, polygon.interiorLines)
    : null;
