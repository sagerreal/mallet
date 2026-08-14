import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId, notFound, ok, err } from "@mallet/shared/types";
import type { Result, AppError } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
// Through the jobs barrel — the sanctioned cross-module seam (lint enforces index-only imports).
// The measurements→jobs edge joins the existing jobs↔quoting barrel cycle; it resolves because
// every side binds its classes lazily inside procedure bodies.
import { DrizzleJobRepository } from "@mallet/jobs";
import { DrizzleMeasurementRepository } from "../infra/drizzle-measurement-repository";
import type { RoomCaptureWithQuantities } from "../domain/measurement-repository";
import { IngestScanUseCase } from "../app/ingest-scan";
import { RescanRoomUseCase } from "../app/rescan-room";
import { CreateManualRoomUseCase } from "../app/create-manual-room";
import { OverrideQuantityUseCase } from "../app/override-quantity";
import { ConfirmQuantityUseCase } from "../app/confirm-quantity";
import { SetTrimHeightUseCase } from "../app/set-trim-height";
import { ListRoomsUseCase } from "../app/list-rooms";
import { RenameRoomUseCase } from "../app/rename-room";
import { ArchiveRoomUseCase } from "../app/archive-room";
import { AddDeductionUseCase } from "../app/add-deduction";
import { ArchiveDeductionUseCase } from "../app/archive-deduction";
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
  "soffit_sqft",
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

const setTrimHeightInput = z.object({
  captureId: z.string().uuid(),
  kind: paintingQuantityKind,
  // Inches. Null clears it — the room goes back to being priced by the foot. Bounds are enforced
  // in the use-case (and again by the DB CHECK), not duplicated as zod refinements, so there is
  // one place the rule is written down.
  heightIn: z.number().nullable(),
});

const renameRoomInput = z.object({
  captureId: z.string().uuid(),
  roomName: z.string().min(1).max(80),
});

const archiveRoomInput = z.object({
  captureId: z.string().uuid(),
});

/** Feet in, metres stored — the painter's unit at the boundary, SI underneath. */
const FEET_PER_METER = 3.280839895;

// The client names WALLS and a HEIGHT. It never sends an area: that is derived from the
// capture's own geometry on every read, so a re-scan re-derives instead of pricing a stale
// number — the same law as site_captures.areaSqft.
const addDeductionInput = z.object({
  captureId: z.string().uuid(),
  reason: z.string().min(1).max(60),
  kind: z.enum(["whole_wall", "band"]),
  wallIndexes: z.array(z.number().int().nonnegative()).min(1).max(64),
  // Null for whole_wall. 10 metres is the ceiling the use-case enforces, restated here in feet so
  // an obviously-wrong unit is refused at the boundary rather than inside.
  heightFt: z.number().positive().max(32).nullable(),
});

const removeDeductionInput = z.object({
  // Carried so the response can return the whole room, and so the tech's job assignment is
  // checked against the capture rather than trusting a bare deduction id.
  captureId: z.string().uuid(),
  deductionId: z.string().uuid(),
});

/**
 * Re-reads a capture after a deduction write so the response carries a freshly derived net.
 * Returns a Result so the caller keeps the same orThrow shape as every other procedure.
 */
const reloadCapture = async (
  repo: DrizzleMeasurementRepository,
  captureId: string,
): Promise<Result<RoomCaptureWithQuantities, AppError>> => {
  const reloaded = await repo.getCapture(captureId);
  return reloaded === null ? err(notFound("room capture not found")) : ok(reloaded);
};

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

// Field access: room capture is FIELD work — the person standing in the room scans it. The
// scan/room-CRUD procedures below are anyRole with the same assignment gate the field router
// uses (a tech may act only on jobs they are ON — Job.isAssignedTo, the domain's rule).
// Owner/office pass through. Quantity confirm/override and the whole site-tracer surface stay
// ownerOrOffice: resolving numbers into the record and aerial takeoff are desk work.
const assertOnJobIfTech = async (
  tx: TenantTx,
  principal: Principal,
  jobId: string,
): Promise<void> => {
  if (principal.role !== "tech") return;
  const job = await new DrizzleJobRepository(tx, principal.orgId).findById(asJobId(jobId));
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedTo(principal.userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
};

// Capture-scoped procedures (rescan/rename/archive) carry no jobId — resolve the capture to its
// job FIRST, then ask the same assignment question. A missing capture is NOT_FOUND here rather
// than deeper in the use-case so an unassigned tech probing ids learns nothing extra.
const assertOnCaptureJobIfTech = async (
  tx: TenantTx,
  principal: Principal,
  repo: DrizzleMeasurementRepository,
  captureId: string,
): Promise<void> => {
  if (principal.role !== "tech") return;
  const capture = await repo.getCapture(captureId);
  if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "room capture not found" });
  await assertOnJobIfTech(tx, principal, capture.capture.props.jobId);
};

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here. The repo is
// built on ctx.tx for every procedure — that per-call transaction is what makes each
// multi-statement use-case (create-capture-plus-quantities, supersede) atomic.
export const createMeasurementRouter = () =>
  router({
    ingestScan: anyRole
      .input(ingestScanInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        await assertOnJobIfTech(ctx.tx, ctx.principal, input.jobId);
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

    rescan: anyRole
      .input(rescanInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        await assertOnCaptureJobIfTech(ctx.tx, ctx.principal, repo, input.captureId);
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

    createManualRoom: anyRole
      .input(createManualRoomInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        await assertOnJobIfTech(ctx.tx, ctx.principal, input.jobId);
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

    list: anyRole
      .input(listInput)
      .output(z.array(roomCaptureDTO))
      .query(async ({ ctx, input }) => {
        await assertOnJobIfTech(ctx.tx, ctx.principal, input.jobId);
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListRoomsUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({ jobId: asJobId(input.jobId) }, ctx.principal.orgId);
        return orThrow(result).map(toRoomCaptureDTO);
      }),

    /**
     * Record wall area that is NOT painted — the tile band, the fully-tiled shower wall.
     *
     * anyRole, and deliberately: the person standing in the bathroom holding the phone that just
     * scanned it is the one who can see what is tiled. Gated on the tech being ON the job, same as
     * renameRoom. The height arrives in FEET because that is what the picker offers and what a
     * painter says; metres are an internal storage unit and never reach the client.
     */
    addDeduction: anyRole
      .input(addDeductionInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        await assertOnCaptureJobIfTech(ctx.tx, ctx.principal, repo, input.captureId);
        const useCase = new AddDeductionUseCase(repo, ctx.deps.ids);
        const result = await useCase.exec(
          {
            captureId: input.captureId,
            reason: input.reason,
            kind: input.kind,
            wallIndexes: input.wallIndexes,
            heightM: input.heightFt === null ? null : input.heightFt / FEET_PER_METER,
          },
          ctx.principal.orgId,
        );
        orThrow(result);
        // The WHOLE room comes back, not the deduction: adding one changes netWallsSqft, and a
        // caller that had to recompute the net client-side could disagree with the estimate.
        return toRoomCaptureDTO(orThrow(await reloadCapture(repo, input.captureId)));
      }),

    /** Put deducted wall area back. anyRole for the same reason as addDeduction. */
    removeDeduction: anyRole
      .input(removeDeductionInput)
      .output(roomCaptureDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        await assertOnCaptureJobIfTech(ctx.tx, ctx.principal, repo, input.captureId);
        const useCase = new ArchiveDeductionUseCase(repo);
        orThrow(await useCase.exec({ deductionId: input.deductionId }, ctx.principal.orgId));
        return toRoomCaptureDTO(orThrow(await reloadCapture(repo, input.captureId)));
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

    // Same authority as confirm/override: reading the numbers is field work, writing them into
    // the record is desk work. A tech who measures a 5¼" base tells the office, exactly as they
    // already do for a corrected wall.
    setTrimHeight: ownerOrOffice
      .input(setTrimHeightInput)
      .output(quantityDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetTrimHeightUseCase(repo);
        const result = await useCase.exec(
          { captureId: input.captureId, kind: input.kind, heightIn: input.heightIn },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    renameRoom: anyRole
      .input(renameRoomInput)
      .output(renamedRoomDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        await assertOnCaptureJobIfTech(ctx.tx, ctx.principal, repo, input.captureId);
        const useCase = new RenameRoomUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { captureId: input.captureId, roomName: input.roomName },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    archiveRoom: anyRole
      .input(archiveRoomInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        await assertOnCaptureJobIfTech(ctx.tx, ctx.principal, repo, input.captureId);
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
