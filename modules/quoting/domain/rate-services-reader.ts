import type { ServiceId } from "@mallet/shared/types";
// Type-only import of the measured-quantity kind. Mirrors pricebook/domain/service.ts's own
// type-only pin: PaintingQuantityKind is erased at compile time (verbatimModuleSyntax), so this
// never triggers the measurements barrel's runtime evaluation (createMeasurementRouter pulls the
// config validator and throws without DB env in unit tests).
import type { PaintingQuantityKind } from "@mallet/measurements";

export type { PaintingQuantityKind };

/** One active, measured-by pricebook service — just the fields BuildFromMeasurementsUseCase needs. */
export interface RateService {
  readonly id: ServiceId;
  readonly name: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly measuredBy: PaintingQuantityKind;
  readonly position: number;
}

/**
 * Narrow read seam over the pricebook module (mirrors modules/quoting/domain/service-name-reader.ts's
 * reader-port pattern): the "Build the price" flow needs only the active services that are priced
 * per a measured room quantity, never pricebook's full CRUD surface. Quoting depends on this port;
 * pricebook is never imported directly by quoting's app layer.
 */
export interface RateServicesReader {
  // Every ACTIVE service with a non-null measuredBy, org-scoped implicitly (tenant tx). Unordered
  // guarantee not required — BuildFromMeasurementsUseCase picks the lowest-position match per kind.
  listMeasuredByActive(): Promise<RateService[]>;
}
