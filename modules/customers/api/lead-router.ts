import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { Phone, isOk, toPage, asLeadId, asCompanyId, money } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleLeadRepository } from "../infra/drizzle-lead-repository";
import { DrizzleEstimateRepository } from "@mallet/quoting";
import { EnsureCustomerUseCase } from "../app/ensure-customer";
import { ListLeadsUseCase } from "../app/list-leads";
import { Lead, LEAD_STAGES, type LeadStage } from "../domain/lead";

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
  notes: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: z.string(),
});

// create extends the base DTO with a `created` flag so callers can distinguish a genuine
// new insert from a dedupe hit (ON CONFLICT DO NOTHING returning the existing row).
const createLeadDTO = leadDTO.extend({ created: z.boolean() });

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
  // 500-row pilot ceiling: a single fetch is correct below this; above it, cursor iteration is needed.
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  stage: stageEnum.optional(),
  unreadOnly: z.boolean().optional(),
});

const paginatedLeadDTO = z.object({
  items: z.array(leadDTO),
  nextCursor: z.string().nullable(),
});

const toLeadDTO = (lead: Lead) => {
  const p = lead.props;
  return {
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
    notes: p.notes,
    address: p.address,
    createdAt: p.createdAt.toISOString(),
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
  address: z.string().max(500).nullable().optional(),
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
          input.address !== undefined
        ) {
          let phone: Phone | null | undefined = undefined;
          if (input.phone !== undefined) {
            if (input.phone === null) {
              phone = null;
            } else {
              const parsed = Phone.parse(input.phone);
              if (!isOk(parsed)) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.message });
              phone = parsed.value;
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
              address: input.address,
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
        // Log after the cascade completes so the entry only fires on clean exit — if archiveByLead
        // throws, the tx rolls back and no misleading audit entry is left behind.
        logger.info({ leadId, orgId: ctx.principal.orgId }, "lead.archived");
        if (archivedCount > 0) {
          logger.info({ leadId, orgId: ctx.principal.orgId, archivedCount }, "lead.archived: estimates cascaded");
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
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { stage: input.stage, unreadOnly: input.unreadOnly },
        });
        return { items: page.items.map(toLeadDTO), nextCursor: page.nextCursor };
      }),
  });
