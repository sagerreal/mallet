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
export type { TrimRunKind, TrimAreaKind } from "./domain/trim-area";
export {
  TRIM_RUN_KINDS,
  TRIM_AREA_KINDS,
  TRIM_AREA_KIND_BY_RUN,
  isTrimRunKind,
  isValidTrimHeight,
  trimAreaSqft,
  MAX_TRIM_HEIGHT_IN,
} from "./domain/trim-area";
export { IngestScanUseCase } from "./app/ingest-scan";
export { RescanRoomUseCase } from "./app/rescan-room";
export { CreateManualRoomUseCase } from "./app/create-manual-room";
export { OverrideQuantityUseCase } from "./app/override-quantity";
export { ConfirmQuantityUseCase } from "./app/confirm-quantity";
export { SetTrimHeightUseCase } from "./app/set-trim-height";
export type { SetTrimHeightCommand } from "./app/set-trim-height";
export { ListRoomsUseCase } from "./app/list-rooms";
export { RenameRoomUseCase } from "./app/rename-room";
export { ArchiveRoomUseCase } from "./app/archive-room";
export { DrizzleMeasurementRepository } from "./infra/drizzle-measurement-repository";
export type { SiteCaptureDTO, SitePolygonDTO } from "./api/measurement-dto";
export type {
  SiteCapture,
  SiteCaptureProps,
  SiteCaptureSource,
  SiteSurface,
  SitePolygon,
  SitePolygonVertex,
  SitePolygonView,
} from "./domain/site-capture";
export { pitchCorrectedArea } from "./domain/site-capture";
export { CreateSiteCaptureUseCase } from "./app/create-site-capture";
export { ListSiteCapturesUseCase } from "./app/list-site-captures";
export { UpdateSiteCaptureUseCase } from "./app/update-site-capture";
export { ArchiveSiteCaptureUseCase } from "./app/archive-site-capture";
export type { RoomQuantitiesReader, RoomQuantitiesForJob, RoomQuantity } from "./domain/room-quantities-reader";
export { MeasurementRoomQuantitiesReader } from "./domain/room-quantities-reader";
export type { SiteQuantitiesReader, SiteQuantitiesForJob, SiteQuantityKind } from "./domain/site-quantities-reader";
export { MeasurementSiteQuantitiesReader } from "./domain/site-quantities-reader";
