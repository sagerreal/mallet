import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId } from "@mallet/shared/types";
import { DrizzleMeasurementRepository } from "../infra/drizzle-measurement-repository";
import { IngestScanUseCase } from "../app/ingest-scan";
import { RescanRoomUseCase } from "../app/rescan-room";
import { CreateManualRoomUseCase } from "../app/create-manual-room";
import { OverrideQuantityUseCase } from "../app/override-quantity";
import { ConfirmQuantityUseCase } from "../app/confirm-quantity";
import { ListRoomsUseCase } from "../app/list-rooms";
import { RenameRoomUseCase } from "../app/rename-room";
import { ArchiveRoomUseCase } from "../app/archive-room";
import { CreateSiteCaptureUseCase } from "../app/create-site-capture";
import { ListSiteCapturesUseCase } from "../app/list-site-captures";
import { UpdateSiteCaptureUseCase } from "../app/update-site-capture";
import { ArchiveSiteCaptureUseCase } from "../app/archive-site-capture";
import {
  quantityDTO,
  roomCaptureDTO,
  toRoomCaptureDTO,
  siteCaptureDTO,
  sitePolygonDTO,
  toSiteCaptureDTO,
} from "./measurement-dto";

const paintingQuantityKind = z.enum([
  "walls_sqft",
  "ceiling_sqft",
  "baseboard_lnft",
  "crown_lnft",
  "doors_count",
  "windows_count",
]);

const ingestScanInput = z.object({
  // Client may author the id for optimistic UI (mirrors createCompany/createTask pattern).
  id: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  roomName: z.string().min(1).max(80),
  capturedAt: z.string().datetime(),
  rawPayload: z.unknown(),
  // Untrusted wire payload — parsed/validated by parseNormalizedGeometry inside the use-case.
  geometry: z.unknown(),
});

const rescanInput = z.object({
  captureId: z.string().uuid(),
  rawPayload: z.unknown(),
  geometry: z.unknown(),
  capturedAt: z.string().datetime(),
});

const createManualRoomInput = z.object({
  id: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  roomName: z.string().min(1).max(80),
  quantities: z.array(
    z.object({
      kind: paintingQuantityKind,
      value: z.number(),
    }),
  ),
});

const listInput = z.object({
  jobId: z.string().uuid(),
});

const overrideQuantityInput = z.object({
  captureId: z.string().uuid(),
  kind: paintingQuantityKind,
  value: z.number(),
});

const confirmQuantityInput = z.object({
  captureId: z.string().uuid(),
  kind: paintingQuantityKind,
  value: z.number(),
});

const renameRoomInput = z.object({
  captureId: z.string().uuid(),
  roomName: z.string().min(1).max(80),
});

const archiveRoomInput = z.object({
  captureId: z.string().uuid(),
});

// The client sends the trace (footprint/perimeter/polygon) or, for a manual entry, the typed
// area — never both. The server derives the working area for a trace (pitchCorrectedArea in
// the use-case); a client-sent areaSqft on a traced capture is rejected there.
const siteCreateInput = z.object({
  id: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  name: z.string().min(1).max(80),
  source: z.enum(["aerial_trace_v1", "manual"]),
  surface: z.enum(["flat", "pitched"]),
  pitchRise: z.number().int().min(1).max(24).optional(),
  polygon: sitePolygonDTO.optional(),
  footprintSqft: z.number().positive().optional(),
  perimeterLnft: z.number().positive().optional(),
  areaSqft: z.number().positive().optional(),
});

const siteListInput = z.object({
  jobId: z.string().uuid(),
});

const siteUpdateInput = z.object({
  captureId: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  surface: z.enum(["flat", "pitched"]).optional(),
  pitchRise: z.number().int().min(1).max(24).optional(),
  areaSqft: z.number().positive().optional(),
});

const siteArchiveInput = z.object({
  captureId: z.string().uuid(),
});

const renamedRoomDTO = z.object({
  captureId: z.string().uuid(),
  roomName: z.string(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here. The repo is
// built on ctx.tx for every procedure — that per-call transaction is what makes each
// multi-statement use-case (create-capture-plus-quantities, supersede) atomic.
export const createMeasurementRouter = () =>
  router({
    ingestScan: ownerOrOffice
      .input(ingestScanInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new IngestScanUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            jobId: asJobId(input.jobId),
            roomName: input.roomName,
            capturedAt: new Date(input.capturedAt),
            rawPayload: input.rawPayload,
            geometry: input.geometry,
          },
          ctx.principal.orgId,
        );
        return toRoomCaptureDTO(orThrow(result));
      }),

    rescan: ownerOrOffice
      .input(rescanInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RescanRoomUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            captureId: input.captureId,
            rawPayload: input.rawPayload,
            geometry: input.geometry,
            capturedAt: new Date(input.capturedAt),
          },
          ctx.principal.orgId,
        );
        return toRoomCaptureDTO(orThrow(result));
      }),

    createManualRoom: ownerOrOffice
      .input(createManualRoomInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateManualRoomUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            jobId: asJobId(input.jobId),
            roomName: input.roomName,
            quantities: input.quantities,
          },
          ctx.principal.orgId,
        );
        return toRoomCaptureDTO(orThrow(result));
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(z.array(roomCaptureDTO))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListRoomsUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({ jobId: asJobId(input.jobId) }, ctx.principal.orgId);
        return orThrow(result).map(toRoomCaptureDTO);
      }),

    overrideQuantity: ownerOrOffice
      .input(overrideQuantityInput)
      .output(quantityDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new OverrideQuantityUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { captureId: input.captureId, kind: input.kind, value: input.value },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    confirmQuantity: ownerOrOffice
      .input(confirmQuantityInput)
      .output(quantityDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ConfirmQuantityUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { captureId: input.captureId, kind: input.kind, value: input.value },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    renameRoom: ownerOrOffice
      .input(renameRoomInput)
      .output(renamedRoomDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RenameRoomUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { captureId: input.captureId, roomName: input.roomName },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    archiveRoom: ownerOrOffice
      .input(archiveRoomInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveRoomUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({ captureId: input.captureId }, ctx.principal.orgId);
        return orThrow(result);
      }),

    // ── site captures (aerial takeoff — outdoor surfaces) ──────────────────────

    siteCreate: ownerOrOffice
      .input(siteCreateInput)
      .output(siteCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateSiteCaptureUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            jobId: asJobId(input.jobId),
            name: input.name,
            source: input.source,
            surface: input.surface,
            pitchRise: input.pitchRise,
            polygon: input.polygon,
            footprintSqft: input.footprintSqft,
            perimeterLnft: input.perimeterLnft,
            areaSqft: input.areaSqft,
          },
          ctx.principal.orgId,
        );
        return toSiteCaptureDTO(orThrow(result));
      }),

    siteList: ownerOrOffice
      .input(siteListInput)
      .output(z.array(siteCaptureDTO))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListSiteCapturesUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({ jobId: asJobId(input.jobId) }, ctx.principal.orgId);
        return orThrow(result).map(toSiteCaptureDTO);
      }),

    siteUpdate: ownerOrOffice
      .input(siteUpdateInput)
      .output(siteCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateSiteCaptureUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            captureId: input.captureId,
            name: input.name,
            surface: input.surface,
            pitchRise: input.pitchRise,
            areaSqft: input.areaSqft,
          },
          ctx.principal.orgId,
        );
        return toSiteCaptureDTO(orThrow(result));
      }),

    siteArchive: ownerOrOffice
      .input(siteArchiveInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveSiteCaptureUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({ captureId: input.captureId }, ctx.principal.orgId);
        return orThrow(result);
      }),
  });
