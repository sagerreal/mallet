import type { JobId } from "@mallet/shared/types";
import type { PaintingQuantityKind } from "./derive-painting";
import type { MeasurementRepository, QuantityStatus } from "./measurement-repository";
import { isTrimRunKind, trimAreaSqft, TRIM_AREA_KIND_BY_RUN, type TrimAreaKind } from "./trim-area";

// Narrow read seam for the future "Build the price" phase (quoting) to consume room
// quantities without depending on the measurements module's internals — mirrors
// modules/jobs/domain/estimate-reader.ts's reader-port pattern. Quoting will depend on this
// port in phase 3; measurements NEVER imports quoting.
export interface RoomQuantity {
  readonly kind: PaintingQuantityKind | TrimAreaKind;
  readonly value: number;
  readonly status: QuantityStatus;
}

export interface RoomQuantitiesForJob {
  readonly roomName: string;
  // True when this room still has at least one unresolved (needs_confirm, null-value) row —
  // "Build the price" uses this to mark the resulting estimate draft rather than silently
  // pricing an incomplete room.
  readonly hasUnconfirmed: boolean;
  // Only non-null quantities — an unresolved needs_confirm row is represented solely via
  // `hasUnconfirmed`, never as a null-valued entry here.
  readonly quantities: readonly RoomQuantity[];
}

export interface RoomQuantitiesReader {
  readForJob(jobId: JobId): Promise<RoomQuantitiesForJob[]>;
}

// Concrete adapter over MeasurementRepository.listByJob — constructor-DI so callers (a future
// quoting use-case) can be wired to this without knowing the repository exists.
export class MeasurementRoomQuantitiesReader implements RoomQuantitiesReader {
  constructor(private readonly repo: MeasurementRepository) {}

  async readForJob(jobId: JobId): Promise<RoomQuantitiesForJob[]> {
    const rooms = await this.repo.listByJob(jobId);

    return rooms.map((room) => ({
      roomName: room.capture.props.roomName,
      hasUnconfirmed: room.quantities.some((q) => q.status === "needs_confirm"),
      quantities: room.quantities
        .filter((q) => q.value !== null)
        .flatMap((q): RoomQuantity[] => {
          const value = q.value as number;
          const run: RoomQuantity = { kind: q.kind, value, status: q.status };
          // A trim run with a typed height can be charged two ways, so it OFFERS both and lets
          // the pricer choose: 38.4 feet of base, or the 16.8 sq ft of face that 5¼" makes of
          // it. Which one becomes a line depends on what the shop actually sells, which is a
          // pricebook question this reader has no business answering — see
          // BuildFromMeasurementsUseCase, where exactly one of the pair survives.
          if (!isTrimRunKind(q.kind) || q.heightIn === null) return [run];
          return [
            run,
            {
              kind: TRIM_AREA_KIND_BY_RUN[q.kind],
              value: trimAreaSqft(value, q.heightIn),
              status: q.status,
            },
          ];
        }),
    }));
  }
}
