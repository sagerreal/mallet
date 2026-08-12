import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { Phone, isOk, toPage, asLeadId, asCompanyId, money } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleLeadRepository } from "../infra/drizzle-lead-repository";
import { DrizzleCardOnFileReader } from "../infra/drizzle-card-on-file-reader";
import { LEAD_SORTS } from "../infra/lead-sorts";
import { LEAD_VIEWS, LEAD_SCOPES } from "../infra/lead-views";
import { DrizzleEstimateRepository } from "@mallet/quoting";
import { DrizzleJobRepository } from "@mallet/jobs";
import { EnsureCustomerUseCase } from "../app/ensure-customer";
import { ListLeadsUseCase } from "../app/list-leads";
import { Lead, LEAD_STAGES, type LeadStage } from "../domain/lead";
import { DrizzleLeadNoteRepository } from "../infra/drizzle-lead-note-repository";
import { AddLeadNoteUseCase } from "../app/add-lead-note";
import { ListLeadNotesUseCase } from "../app/list-lead-notes";
import { RemoveLeadNoteUseCase } from "../app/remove-lead-note";
import { LEAD_NOTE_KINDS, LEAD_NOTE_MAX, type LeadNote } from "../domain/lead-note";

// DTOs — the wire contract, deliberately separate from the domain. Money is flattened to a
// plain cents object; Phone/branded ids serialize as strings.
const stageEnum = z.enum(LEAD_STAGES as unknown as [LeadStage, ...LeadStage[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

const leadDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.string().nullable(),
  stage: stageEnum,
  value: moneyDTO,
  unread: z.boolean(),
  companyId: z.string().uuid().nullable(),
  role: z.string().nullable(),
  customFields: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().max(500) })).max(20).nullable(),
  notes: z.string().nullable(),
  // Why the customer went elsewhere. Written when a quote is declined; was dropped by the
  // store's payload builder, so "why did we lose this?" had no durable answer.
  lossReason: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: z.string(),
  // The list's DEFAULT ordering is `lastActivity` → updated_at, and until this shipped the
  // Latest column had no way to show the value the rows were already sorted by.
  updatedAt: z.string(),
  /**
   * The customer's card on file — PRESENTATIONAL facts only (brand, last four, which payment
   * saved it), joined from payment_profiles on the LIST read and null everywhere else. The
   * Stripe pointers that could actually charge it never leave the invoicing module; this field
   * exists so Money's "Charge ···· 4242" and the close-out's charge button can render from the
   * store. Mutation responses answer null and the store's reconcile deliberately does not adopt
   * it (reconcileLeadFromDTO starts from `current`), so an edit never erases a known card.
   */
  card: z
    .object({ brand: z.string(), last4: z.string(), via: z.enum(["payment", "deposit"]) })
    .nullable(),
});

// create extends the base DTO with a `created` flag so callers can distinguish a genuine
// new insert from a dedupe hit (ON CONFLICT DO NOTHING returning the existing row).
const createLeadDTO = leadDTO.extend({ created: z.boolean() });

// One entry in the customer activity trail. Shapes 1:1 onto the store's LeadNote so the existing
// note feed renders a server row and an optimistic one identically.
const leadNoteDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  kind: z.enum(LEAD_NOTE_KINDS),
  body: z.string(),
  author: z.string().nullable(),
  direction: z.string().nullable(),
  outcome: z.string().nullable(),
  durationLabel: z.string().nullable(),
  via: z.string().nullable(),
  overnight: z.boolean(),
  createdAt: z.string(),
});

const toLeadNoteDTO = (note: LeadNote) => {
  const p = note.props;
  return {
    id: p.id,
    leadId: p.leadId as string,
    kind: p.kind,
    body: p.body,
    author: p.author,
    direction: p.direction,
    outcome: p.outcome,
    durationLabel: p.durationLabel,
    via: p.via,
    overnight: p.overnight,
    createdAt: p.createdAt.toISOString(),
  };
};

const createInput = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(320).optional(),
  source: z.string().max(255).optional(),
  companyId: z.string().uuid().nullable().optional(),
  role: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).optional(),
  address: z.string().max(500).optional(),
});

const importRowInput = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(40).nullable(), // raw string; server parses leniently, never rejects the batch
  email: z.string().max(320).nullable(), // raw string; server validates leniently, never rejects the batch
  source: z.string().max(255).nullable(),
  address: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
});
const importInput = z.object({ rows: z.array(importRowInput).min(1).max(500) });

const importResultDTO = z.object({
  created: z.number().int(),
  deduped: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  stage: stageEnum.optional(),
  unreadOnly: z.boolean().optional(),
  /** Named sort — never a column name. Absent keeps the historical newest-first ordering. */
  sort: z.enum(LEAD_SORTS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  /** Free-text across name, phone, email and address. Runs in the database. */
  search: z.string().trim().min(1).max(200).optional(),
  /** Narrow to one lead source. */
  source: z.string().max(120).optional(),
  /** One Pipeline board column (New leads / Quoting / Out / Won). */
  view: z.enum(LEAD_VIEWS).optional(),
  /** A saved worklist — owes money, no job in 12 months. Combinable with the filters above. */
  scope: z.enum(LEAD_SCOPES).optional(),
});

const countInput = z.object({
  stage: stageEnum.optional(),
  unreadOnly: z.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  source: z.string().max(120).optional(),
  // The count must take the same narrowing as the list, or the header says "50 of 606" while the
  // list is showing the 12 customers who owe money.
  scope: z.enum(LEAD_SCOPES).optional(),
});

const paginatedLeadDTO = z.object({
  items: z.array(leadDTO),
  nextCursor: z.string().nullable(),
});

// `card` rides only where a batched profiles read supplies it (list); every mutation response
// passes nothing and answers null — see the DTO comment for why that cannot erase a store card.
const toLeadDTO = (lead: Lead, card: { brand: string; last4: string; via: "payment" | "deposit" } | null = null) => {
  const p = lead.props;
  return {
    card,
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    source: p.source,
    stage: p.stage,
    value: { cents: p.value, currency: "USD" as const },
    unread: p.unread,
    companyId: p.companyId,
    role: p.role,
    customFields: (p.customFields as { label: string; value: string }[] | null) ?? null,
    notes: p.notes,
    lossReason: p.lossReason,
    address: p.address,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
};

const updateInput = z.object({
  leadId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  source: z.string().max(255).nullable().optional(),
  stage: stageEnum.optional(),
  valueCents: z.number().int().min(0).max(100_000_00).optional(),
  unread: z.boolean().optional(),
  companyId: z.string().uuid().nullable().optional(),
  role: z.string().max(255).nullable().optional(),
  customFields: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().max(500) })).max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  lossReason: z.string().max(200).nullable().optional(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createLeadRouter = () =>
  router({
    update: ownerOrOffice
      .input(updateInput)
      .output(leadDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const lead = await repo.findById(asLeadId(input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "customer not found" });
        const now = ctx.deps.clock.now();
        let updated = lead;
        if (input.stage !== undefined) updated = updated.moveStage(input.stage, now);
        if (input.unread === false) updated = updated.markRead(now);
        // Patch scalar fields through the domain's patch method so invariants are enforced there.
        if (
          input.name !== undefined ||
          input.phone !== undefined ||
          input.email !== undefined ||
          input.source !== undefined ||
          input.valueCents !== undefined ||
          input.companyId !== undefined ||
          input.role !== undefined ||
          input.customFields !== undefined ||
          input.address !== undefined ||
          input.lossReason !== undefined
        ) {
          let phone: Phone | null | undefined = undefined;
          if (input.phone !== undefined) {
            if (input.phone === null) {
              phone = null;
            } else {
              const parsed = Phone.parse(input.phone);
              if (!isOk(parsed)) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.message });
              phone = parsed.value;
              // `leads_org_phone_uidx` forbids two live customers sharing a number. Checked HERE so
              // the refusal can name who already has it — left to Postgres it surfaces as a bare
              // constraint violation, which the store reports as "check your connection" while the
              // typed number silently vanishes.
              const holder = await repo.findByPhone(parsed.value);
              if (holder && holder.props.id !== lead.props.id) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: `${holder.props.name} already has that number. Open them instead, or give this customer a different one.`,
                });
              }
            }
          }
          const patched = updated.patch(
            {
              name: input.name,
              phone,
              email: input.email,
              source: input.source,
              value: input.valueCents !== undefined ? money(input.valueCents) : undefined,
              companyId: input.companyId !== undefined
                ? input.companyId !== null
                  ? asCompanyId(input.companyId)
                  : null
                : undefined,
              role: input.role,
              customFields: input.customFields,
              address: input.address,
              lossReason: input.lossReason,
            },
            now,
          );
          if (!isOk(patched)) throw new TRPCError({ code: "BAD_REQUEST", message: patched.error.message });
          updated = patched.value;
        }
        await repo.save(updated);
        const patchedFields = (Object.keys(input) as Array<keyof typeof input>).filter(
          (k) => k !== "leadId" && input[k] !== undefined,
        );
        logger.info({ leadId: input.leadId, orgId: ctx.principal.orgId, fields: patchedFields }, "lead.updated");
        return toLeadDTO(updated);
      }),

    archive: ownerOrOffice
      .input(z.object({ leadId: z.string().uuid() }))
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const { leadId } = input;
        // Capture the clock once so both the lead archive and the estimate cascade share the same
        // timestamp — atomically consistent within the tenant tx.
        const now = ctx.deps.clock.now();
        const count = await repo.archive(asLeadId(leadId), now);
        if (count === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "customer not found or already archived" });
        }
        // Cascade: archive all non-deleted estimates for this lead atomically in the same tx.
        // This prevents orphaned "—" cards from appearing in the pipeline Out/Won rails.
        // Intentionally NOT reversed on lead restore — an unarchived customer's quotes stay
        // archived; the office re-sends if needed.
        const estimateRepo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const archivedCount = await estimateRepo.archiveByLead(asLeadId(leadId), now);
        // Cascade jobs too (same tx, same clock): an archived customer's ACTIVE jobs + their visits
        // are soft-deleted so they don't linger as orphans in the Jobs count and on the board.
        // Terminal (complete/canceled) jobs are preserved as history — mirrors the estimate cascade
        // preserving accepted quotes. Also not reversed on restore (same policy as estimates).
        const jobRepo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const archivedJobs = await jobRepo.archiveByLead(asLeadId(leadId), now);
        // Log after the cascade completes so the entry only fires on clean exit — if a cascade
        // throws, the tx rolls back and no misleading audit entry is left behind.
        logger.info({ leadId, orgId: ctx.principal.orgId }, "lead.archived");
        if (archivedCount > 0) {
          logger.info({ leadId, orgId: ctx.principal.orgId, archivedCount }, "lead.archived: estimates cascaded");
        }
        if (archivedJobs > 0) {
          logger.info({ leadId, orgId: ctx.principal.orgId, archivedJobs }, "lead.archived: jobs cascaded");
        }
        return { ok: true };
      }),

    restore: ownerOrOffice
      .input(z.object({ leadId: z.string().uuid() }))
      .output(leadDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const { leadId } = input;
        const now = ctx.deps.clock.now();
        // restore() returns the lead if it was archived and is now restored; null means it was
        // already active (no-op). Fall back to findById to return the current state either way.
        const restored = await repo.restore(asLeadId(leadId), now);
        if (restored) {
          logger.info({ leadId, orgId: ctx.principal.orgId }, "lead.restored");
          return toLeadDTO(restored);
        }
        const existing = await repo.findById(asLeadId(leadId));
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "customer not found" });
        return toLeadDTO(existing);
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(createLeadDTO)
      .mutation(async ({ ctx, input }) => {
        let phone: Phone | null = null;
        if (input.phone) {
          const parsed = Phone.parse(input.phone);
          if (!isOk(parsed)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.message });
          }
          phone = parsed.value;
        }
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new EnsureCustomerUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        const result = await useCase.exec({
          name: input.name,
          phone,
          email: input.email ?? null,
          source: input.source ?? null,
          companyId: input.companyId ? asCompanyId(input.companyId) : null,
          role: input.role ?? null,
          notes: input.notes?.trim() || null,
          address: input.address?.trim() || null,
        });
        const { lead, created } = orThrow(result);
        logger.info(
          { leadId: lead.props.id, orgId: ctx.principal.orgId, created },
          created ? "lead.created" : "lead.deduped",
        );
        return { ...toLeadDTO(lead), created };
      }),

    importCustomers: ownerOrOffice
      .input(importInput)
      .output(importResultDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new EnsureCustomerUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        let created = 0;
        let deduped = 0;
        let failed = 0;
        const errors: { index: number; message: string }[] = [];

        for (let i = 0; i < input.rows.length; i++) {
          const r = input.rows[i]!;
          // Lenient phone parse: an unreadable phone is dropped, not fatal (name is the only requirement).
          let phone: Phone | null = null;
          if (r.phone) {
            const parsed = Phone.parse(r.phone);
            if (isOk(parsed)) phone = parsed.value;
          }
          // Lenient email validation: a malformed email is dropped, not fatal — same partial-success
          // contract as phone, so one bad email can't reject the whole batch at the Zod boundary.
          let email: string | null = null;
          if (r.email) {
            const e = r.email.trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e;
          }
          // exec returns a Result — NEVER throws for validation, so one bad row can't roll back the tx.
          const result = await useCase.exec({
            name: r.name,
            phone,
            email,
            source: r.source,
            companyId: null,
            role: null,
            notes: r.notes?.trim() || null,
            address: r.address?.trim() || null,
          });
          if (isOk(result)) {
            result.value.created ? (created += 1) : (deduped += 1);
          } else {
            failed += 1;
            errors.push({ index: i, message: result.error.message });
          }
        }

        logger.info({ orgId: ctx.principal.orgId, created, deduped, failed }, "customers.imported");
        return { created, deduped, failed, errors };
      }),

    get: ownerOrOffice
      .input(z.object({ leadId: z.string().uuid() }))
      .output(leadDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const lead = await repo.findById(asLeadId(input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "customer not found" });
        return toLeadDTO(lead);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedLeadDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListLeadsUseCase(repo);
        const page = await useCase.exec({
          sort: input.sort,
          sortDir: input.sortDir,
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { stage: input.stage, unreadOnly: input.unreadOnly, search: input.search, source: input.source, view: input.view, scope: input.scope },
        });
        // One batched card-on-file read for the page — never per-row (same batching rule the
        // invoice list applies to lead names).
        const cards = await new DrizzleCardOnFileReader(ctx.tx, ctx.principal.orgId).byLeadIds(
          page.items.map((l) => l.props.id),
        );
        return {
          items: page.items.map((l) => toLeadDTO(l, cards.get(l.props.id) ?? null)),
          nextCursor: page.nextCursor,
        };
      }),

    /**
     * The TRUE number of customers matching a filter.
     *
     * Shares its predicates with list() through the repository, so the "n of N" a header shows is
     * two halves of one question rather than two questions that happen to look alike.
     */
    /** Every Pipeline column's count — the board shows all four, so they come back together. */
    viewCounts: ownerOrOffice
      .output(z.record(z.enum(LEAD_VIEWS), z.number().int()))
      .query(async ({ ctx }) => new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).viewCounts()),

    /** Filter-dropdown options and their counts, so the dropdown describes the BOOK, not a page. */
    facets: ownerOrOffice
      .output(
        z.object({
          stages: z.record(z.string(), z.number().int()),
          sources: z.array(z.object({ source: z.string(), n: z.number().int() })),
        }),
      )
      .query(async ({ ctx }) =>
        new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).facets(),
      ),

    count: ownerOrOffice
      .input(countInput)
      .output(z.object({ total: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        return {
          total: await repo.count({
            stage: input.stage,
            unreadOnly: input.unreadOnly,
            search: input.search,
            source: input.source,
            scope: input.scope,
          }),
        };
      }),

    /**
     * The customer's activity trail — typed notes, logged calls, sent texts.
     *
     * Before this the whole trail lived in the browser's store and nowhere else, so a gate code
     * typed into the Notes composer survived until the next refetch and then vanished.
     */
    listNotes: ownerOrOffice
      .input(z.object({ leadId: z.string().uuid() }))
      .output(z.object({ items: z.array(leadNoteDTO) }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleLeadNoteRepository(ctx.tx, ctx.principal.orgId);
        const notes = await new ListLeadNotesUseCase(repo).exec(asLeadId(input.leadId));
        return { items: notes.map(toLeadNoteDTO) };
      }),

    addNote: ownerOrOffice
      .input(
        z.object({
          // Client-authored so the store can hand the id out synchronously — the home queue's
          // 30s Undo deletes exactly the note a Send appended.
          id: z.string().uuid(),
          leadId: z.string().uuid(),
          kind: z.enum(LEAD_NOTE_KINDS),
          body: z.string().max(LEAD_NOTE_MAX),
          author: z.string().max(120).nullable().optional(),
          direction: z.string().max(20).nullable().optional(),
          outcome: z.string().max(120).nullable().optional(),
          durationLabel: z.string().max(20).nullable().optional(),
          via: z.string().max(60).nullable().optional(),
          overnight: z.boolean().optional(),
        }),
      )
      .output(leadNoteDTO)
      .mutation(async ({ ctx, input }) => {
        const useCase = new AddLeadNoteUseCase(
          new DrizzleLeadNoteRepository(ctx.tx, ctx.principal.orgId),
          new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId),
        );
        const result = await useCase.exec({
          id: input.id,
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          kind: input.kind,
          body: input.body,
          author: input.author ?? null,
          direction: input.direction ?? null,
          outcome: input.outcome ?? null,
          durationLabel: input.durationLabel ?? null,
          via: input.via ?? null,
          overnight: input.overnight ?? false,
          now: new Date(),
        });
        return toLeadNoteDTO(orThrow(result));
      }),

    removeNote: ownerOrOffice
      .input(z.object({ noteId: z.string().uuid() }))
      .output(z.object({ removed: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        const useCase = new RemoveLeadNoteUseCase(
          new DrizzleLeadNoteRepository(ctx.tx, ctx.principal.orgId),
        );
        orThrow(await useCase.exec(input.noteId));
        return { removed: true as const };
      }),
  });
