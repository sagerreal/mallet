import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { jobs, users } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { PurchaseOrder } from "../domain/purchase-order";
import { DrizzlePurchaseOrderRepository } from "../infra/drizzle-purchase-order-repository";
import { toDate } from "../infra/purchase-order-mapper";
import { PurchaseOrderAttachmentStorage } from "../infra/purchase-order-attachment-storage";
import { ListPurchaseOrdersUseCase } from "../app/list-purchase-orders";
import { CreatePurchaseOrderUseCase } from "../app/create-purchase-order";
import { UpdatePurchaseOrderUseCase } from "../app/update-purchase-order";
import { PlacePurchaseOrderUseCase } from "../app/place-purchase-order";
import { CancelPurchaseOrderUseCase } from "../app/cancel-purchase-order";
import { RemovePurchaseOrderUseCase } from "../app/remove-purchase-order";
import { AddPurchaseOrderNoteUseCase } from "../app/add-purchase-order-note";
import {
  purchaseOrderDTO,
  toPurchaseOrderDTO,
  purchaseOrderNoteDTO,
  toPurchaseOrderNoteDTO,
  type PurchaseOrderDTO,
  type PurchaseOrderDisplayExtras,
} from "./purchase-order-dto";

// ── wire input ────────────────────────────────────────────────────────────────

/** A free-text ship-to address — replaces the old 3-option picker. Trimmed; blank becomes null. */
const shipToAddressInput = z
  .string()
  .max(500)
  .nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

/** Calendar date, "YYYY-MM-DD" — orderedAt/expectedAt are postgres `date` columns, not instants. */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");

const lineInput = z.object({
  // An existing line's id to update it in place; omitted mints a new line via IdGenerator.
  id: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20),
  // Ceiling matches the int4 column it lands in (purchase_order_lines.unit_cost_millicents) —
  // without it a commercial RTU or boiler line over $21,474.83/unit fails as a raw Postgres
  // "integer out of range" 500 instead of a readable validation error. The column itself stays
  // int4; widening it is an additive migration and the owner's call, not this router's.
  unitCostMillicents: z.number().int().nonnegative().max(2_147_483_647),
});

const createInput = z.object({
  // Client may author the id for optimistic UI (mirrors createCompany/createTask).
  id: z.string().uuid().optional(),
  vendor: z.string().min(1).max(500),
  jobId: z.string().uuid().nullable(),
  expectedAt: dateOnly.nullable(),
  shipToAddress: shipToAddressInput,
  // orderedByUserId is NOT here: it is stamped server-side from ctx.principal.userId (see
  // `create` below), never accepted from the client — the same rule addNote's authorUserId
  // follows. A field that named who ordered a $2,140 purchase would let any caller claim it was
  // someone else. Read back via the DTO's orderedByUserId/orderedByName.
  freightCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
  lines: z.array(lineInput).optional(),
});

const updateInput = z.object({
  poId: z.string().uuid(),
  vendor: z.string().min(1).max(500).optional(),
  jobId: z.string().uuid().nullable().optional(),
  expectedAt: dateOnly.nullable().optional(),
  shipToAddress: shipToAddressInput.optional(),
  // orderedByUserId is likewise absent — stamped once at create and never re-targetable from the
  // client. Omitting the key from the command below leaves it untouched (Update…Command treats
  // `undefined` as "leave it").
  freightCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
  // Full replace of the line set. Absent leaves the existing lines untouched (see
  // UpdatePurchaseOrderUseCase's doc for why this is refused once the order is no longer a draft).
  lines: z.array(lineInput).optional(),
});

const poIdInput = z.object({ poId: z.string().uuid() });

const addNoteInput = z.object({
  poId: z.string().uuid(),
  // Matches the lead-note ceiling (LEAD_NOTE_MAX) — no established cap exists for a PO note, and
  // this is the same kind of free-text field.
  body: z.string().max(2000),
  // Present or absent as a WHOLE, same shape rule the DB's purchase_order_notes_shape_check
  // enforces (body or attachment, never neither).
  attachment: z
    .object({
      path: z.string().min(1).max(1024),
      type: z.string().min(1).max(120),
      name: z.string().min(1).max(200),
    })
    .optional(),
});

/**
 * What a PO note's attachment may BE. Same allowlist modules/customers/api/lead-note-dto.ts
 * exports as LEAD_ATTACHMENT_EXTS — the bytes share the same private bucket, so a type one
 * surface accepts and the other refuses would be a file that uploads here and will not open
 * there.
 */
export const PO_ATTACHMENT_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "pdf", "csv", "txt"] as const;

const noteUploadUrlInput = z.object({
  poId: z.string().uuid(),
  objectId: z.string().uuid(),
  ext: z.enum(PO_ATTACHMENT_EXTS),
});
const noteUploadUrlDTO = z.object({
  signedUrl: z.string(),
  token: z.string(),
  storagePath: z.string(),
});

const noteViewUrlInput = z.object({
  poId: z.string().uuid(),
  id: z.string().uuid(),
});
const noteViewUrlDTO = z.object({ url: z.string() });

// ── display-field joins ─────────────────────────────────────────────────────
//
// jobTitle/orderedByName are not domain state — they are resolved here, batched, exactly the way
// invoice-router.ts resolves customerName ("one batched lead read for the page, never a per-row
// query") and messaging-router.ts resolves message sender names off `users`. Falls back to the
// account email when a staffer has no display name yet (users.name is nullable), same as those.

const userNamesFor = async (
  tx: TenantTx,
  orgId: OrgId,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> => {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), inArray(users.id, wanted)));
  return new Map(rows.map((r) => [r.id, r.name ?? r.email]));
};

const jobTitlesFor = async (
  tx: TenantTx,
  orgId: OrgId,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string | null>> => {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), inArray(jobs.id, wanted)));
  return new Map(rows.map((r) => [r.id, r.title]));
};

const displayExtrasFor = async (
  tx: TenantTx,
  orgId: OrgId,
  orders: readonly PurchaseOrder[],
): Promise<ReadonlyMap<string, PurchaseOrderDisplayExtras>> => {
  const [jobTitleById, orderedByNameById] = await Promise.all([
    jobTitlesFor(tx, orgId, orders.map((po) => po.props.jobId)),
    userNamesFor(tx, orgId, orders.map((po) => po.props.orderedByUserId)),
  ]);
  return new Map(
    orders.map((po) => [
      po.props.id,
      {
        jobTitle: po.props.jobId ? (jobTitleById.get(po.props.jobId) ?? null) : null,
        orderedByName: po.props.orderedByUserId ? (orderedByNameById.get(po.props.orderedByUserId) ?? null) : null,
      },
    ]),
  );
};

/** One order's DTO, with its own display fields resolved. Used by every single-object mutation. */
const toDTOWithExtras = async (tx: TenantTx, orgId: OrgId, po: PurchaseOrder): Promise<PurchaseOrderDTO> => {
  const extras = await displayExtrasFor(tx, orgId, [po]);
  return toPurchaseOrderDTO(po, extras.get(po.props.id));
};

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
//
// Purchasing is an OFFICE surface end to end — every procedure runs on `ownerOrOffice`, so a
// tech gets FORBIDDEN rather than any purchasing data or action.
export const createPurchaseOrderRouter = () =>
  router({
    list: ownerOrOffice
      .output(z.object({ items: z.array(purchaseOrderDTO) }))
      .query(async ({ ctx }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const items = await new ListPurchaseOrdersUseCase(repo).exec();
        const extrasById = await displayExtrasFor(ctx.tx, ctx.principal.orgId, items);
        return { items: items.map((po) => toPurchaseOrderDTO(po, extrasById.get(po.props.id))) };
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(purchaseOrderDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreatePurchaseOrderUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(ctx.principal.orgId, {
          id: input.id,
          vendor: input.vendor,
          jobId: input.jobId,
          expectedAt: toDate(input.expectedAt),
          shipToAddress: input.shipToAddress,
          // Stamped from the caller, never from input — see createInput's comment.
          orderedByUserId: ctx.principal.userId,
          freightCents: input.freightCents,
          taxCents: input.taxCents,
          lines: input.lines,
        });
        return toDTOWithExtras(ctx.tx, ctx.principal.orgId, orThrow(result));
      }),

    update: ownerOrOffice
      .input(updateInput)
      .output(purchaseOrderDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdatePurchaseOrderUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(ctx.principal.orgId, {
          poId: input.poId,
          vendor: input.vendor,
          jobId: input.jobId,
          // undefined means "leave it"; only convert when the field was actually sent.
          expectedAt: input.expectedAt === undefined ? undefined : toDate(input.expectedAt),
          shipToAddress: input.shipToAddress,
          // orderedByUserId is deliberately absent — undefined here leaves it untouched.
          freightCents: input.freightCents,
          taxCents: input.taxCents,
          lines: input.lines,
        });
        return toDTOWithExtras(ctx.tx, ctx.principal.orgId, orThrow(result));
      }),

    place: ownerOrOffice
      .input(poIdInput)
      .output(purchaseOrderDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new PlacePurchaseOrderUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(ctx.principal.orgId, input.poId);
        return toDTOWithExtras(ctx.tx, ctx.principal.orgId, orThrow(result));
      }),

    cancel: ownerOrOffice
      .input(poIdInput)
      .output(purchaseOrderDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CancelPurchaseOrderUseCase(repo);
        const result = await useCase.exec(ctx.principal.orgId, input.poId);
        return toDTOWithExtras(ctx.tx, ctx.principal.orgId, orThrow(result));
      }),

    // Draft-only soft delete. Goes through RemovePurchaseOrderUseCase like every other mutation
    // here — never repo.softDelete directly — so the "must be a draft" refusal is enforced in
    // exactly one place.
    remove: ownerOrOffice
      .input(poIdInput)
      .output(z.object({ removed: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemovePurchaseOrderUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(ctx.principal.orgId, input.poId);
        return orThrow(result);
      }),

    addNote: ownerOrOffice
      .input(addNoteInput)
      .output(purchaseOrderNoteDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddPurchaseOrderNoteUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(ctx.principal.orgId, {
          poId: input.poId,
          body: input.body,
          // The AUTHOR is always the caller, never client input — same rule every other
          // *ByUserId field in this app follows (recordedByUserId, chargedByUserId,
          // signedByUserId, …): an actor field names who is acting right now, not who the
          // request claims acted.
          authorUserId: ctx.principal.userId,
          attachment: input.attachment ?? null,
        });
        const note = orThrow(result);
        const nameById = await userNamesFor(ctx.tx, ctx.principal.orgId, [note.authorUserId]);
        return toPurchaseOrderNoteDTO(note, note.authorUserId ? (nameById.get(note.authorUserId) ?? null) : null);
      }),

    listNotes: ownerOrOffice
      .input(poIdInput)
      .output(z.object({ items: z.array(purchaseOrderNoteDTO) }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        // Same guard noteUploadUrl uses: findById filters deleted_at, so a soft-deleted order's
        // note trail stops being servable the moment it's removed rather than staying reachable
        // by id forever.
        const po = await repo.findById(input.poId);
        if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "purchase order not found" });
        const notes = await repo.listNotes(input.poId);
        const nameById = await userNamesFor(
          ctx.tx,
          ctx.principal.orgId,
          notes.map((n) => n.authorUserId),
        );
        return {
          items: notes.map((n) => toPurchaseOrderNoteDTO(n, n.authorUserId ? (nameById.get(n.authorUserId) ?? null) : null)),
        };
      }),

    /**
     * Mint a signed, direct-to-storage upload URL for a PO note's attachment.
     *
     * The order is loaded first: a caller who cannot see it cannot mint a key inside its folder,
     * and RLS makes that a NOT_FOUND rather than a leak of whether the id exists.
     *
     * Self-disables like every other storage endpoint — with the Storage env absent the gateway
     * is null and this answers PRECONDITION_FAILED, so the composer can say the attach button is
     * unavailable instead of appearing to work and losing the file.
     */
    noteUploadUrl: ownerOrOffice
      .input(noteUploadUrlInput)
      .output(noteUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "file storage is not configured" });
        }
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        const po = await repo.findById(input.poId);
        if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "purchase order not found" });

        const storage = new PurchaseOrderAttachmentStorage(ctx.deps.photoStorageGateway);
        const result = await storage.createUploadUrl({
          orgId: ctx.principal.orgId,
          poId: input.poId,
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) {
          // The gateway already logged the provider detail; its message is written for a user.
          logger.warn({ poId: input.poId, orgId: ctx.principal.orgId }, "purchaseOrder.upload_url_failed");
          throw new TRPCError({ code: "BAD_GATEWAY", message: result.error.message });
        }
        return result.value;
      }),

    /**
     * Open one note's attachment.
     *
     * The caller names the NOTE, never the storage key: the row is resolved inside the tenant tx
     * and ITS stored path is what gets signed. So a forged path cannot be turned into a URL, and
     * a note id belonging to another org — or to a different order in this one — is a row this
     * query cannot see and answers NOT_FOUND.
     *
     * The link is short-lived rather than the bucket being public: a URL copied out of the
     * address bar must not still open a vendor receipt a year later.
     */
    noteViewUrl: ownerOrOffice
      .input(noteViewUrlInput)
      .output(noteViewUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "file storage is not configured" });
        }
        const repo = new DrizzlePurchaseOrderRepository(ctx.tx, ctx.principal.orgId);
        // Same guard noteUploadUrl uses — a soft-deleted order must stop minting working links
        // for its attachments, not just stop appearing in list().
        const po = await repo.findById(input.poId);
        if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "purchase order not found" });
        const notes = await repo.listNotes(input.poId);
        const attachment = notes.find((n) => n.id === input.id);
        if (!attachment?.attachmentPath) {
          throw new TRPCError({ code: "NOT_FOUND", message: "attachment not found" });
        }

        const storage = new PurchaseOrderAttachmentStorage(ctx.deps.photoStorageGateway);
        const result = await storage.createViewUrl(attachment.attachmentPath, {
          orgId: ctx.principal.orgId,
          poId: input.poId,
        });
        if (!result.ok) {
          logger.warn(
            { poId: input.poId, noteId: input.id, orgId: ctx.principal.orgId },
            "purchaseOrder.view_url_failed",
          );
          throw new TRPCError({ code: "BAD_GATEWAY", message: result.error.message });
        }
        return { url: result.value.url };
      }),
  });
