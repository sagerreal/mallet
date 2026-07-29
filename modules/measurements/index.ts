// Public surface for the measurements module — the only sanctioned import seam.
export { createMeasurementRouter } from "./api/measurement-router";
export type { RoomCaptureDTO, QuantityDTO } from "./api/measurement-dto";
export type { RoomCapture, RoomCaptureProps, RoomCaptureSource } from "./domain/room-capture";
export type {
  MeasurementRepository,
  RoomCaptureWithQuantities,
  StoredQuantity,
  QuantityStatus,
} from "./domain/measurement-repository";
export type { PaintingQuantity, PaintingQuantityKind } from "./domain/derive-painting";
export { IngestScanUseCase } from "./app/ingest-scan";
export { RescanRoomUseCase } from "./app/rescan-room";
export { CreateManualRoomUseCase } from "./app/create-manual-room";
export { OverrideQuantityUseCase } from "./app/override-quantity";
export { ConfirmQuantityUseCase } from "./app/confirm-quantity";
export { ListRoomsUseCase } from "./app/list-rooms";
export { RenameRoomUseCase } from "./app/rename-room";
export { ArchiveRoomUseCase } from "./app/archive-room";
export { DrizzleMeasurementRepository } from "./infra/drizzle-measurement-repository";
