import type { JobId } from "@mallet/shared/types";
import type { PaintingQuantityKind } from "./derive-painting";
import type { MeasurementRepository, QuantityStatus } from "./measurement-repository";

// Narrow read seam for the future "Build the price" phase (quoting) to consume room
// quantities without depending on the measurements module's internals — mirrors
// modules/jobs/domain/estimate-reader.ts's reader-port pattern. Quoting will depend on this
// port in phase 3; measurements NEVER imports quoting.
export interface RoomQuantity {
  readonly kind: PaintingQuantityKind;
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
        .map((q) => ({ kind: q.kind, value: q.value as number, status: q.status })),
    }));
  }
}
