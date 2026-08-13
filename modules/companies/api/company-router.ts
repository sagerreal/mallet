import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asCompanyId, toPage, isOk, type CompanyId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleCompanyRepository } from "../infra/drizzle-company-repository";
import { CreateCompanyUseCase } from "../app/create-company";
import { ListCompaniesUseCase } from "../app/list-companies";
import { UpdateCompanyUseCase } from "../app/update-company";
import { ArchiveCompanyUseCase } from "../app/archive-company";
import { companyDTO, toCompanyDTO } from "./company-dto";

const paginatedCompanyDTO = z.object({
  items: z.array(companyDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});

// Every field but `name` is OPTIONAL, and that is load-bearing on re-import: an ABSENT key means
// the sheet had no such column, so an existing account keeps what it already holds, while an
// explicit null means the user mapped the column and left the cell blank — a deliberate clear.
const importCompanyRowInput = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const importCompaniesInput = z.object({ rows: z.array(importCompanyRowInput).min(1).max(500) });

const importResultDTO = z.object({
  created: z.number().int(),
  /** Rows that matched an existing account and PATCHED it. */
  updated: z.number().int(),
  deduped: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
});

const createInput = z.object({
  // Client may author the id for optimistic UI (mirrors createTask/createVisit pattern).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(500),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  website: z.string().max(2048).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const updateInput = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).max(500).optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  website: z.string().max(2048).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const archiveInput = z.object({
  companyId: z.string().uuid(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createCompanyRouter = () =>
  router({
    list: ownerOrOffice
      .input(listInput)
      .output(paginatedCompanyDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListCompaniesUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        });
        return { items: page.items.map(toCompanyDTO), nextCursor: page.nextCursor };
      }),

    // Per-company money + people rollups, computed in SQL across the WHOLE book — the
    // Companies table joined two page-capped store collections and read a fraction of
    // reality (or "$0 open") for any account whose history predates the loaded page.
    rollups: ownerOrOffice
      .output(
        z.array(
          z.object({
            companyId: z.string().uuid(),
            people: z.number().int(),
            openPipeCents: z.number().int(),
            revenueWonCents: z.number().int(),
          }),
        ),
      )
      .query(async ({ ctx }) => {
        const orgId = ctx.principal.orgId;
        const rows = await ctx.tx.execute(sql`
          select l.company_id as "companyId",
                 count(distinct l.id)::int as "people",
                 coalesce(sum(
                   case when e.status = 'sent' and e.deleted_at is null
                     then (select coalesce(sum(round(el.quantity * el.rate_cents)), 0)
                             from estimate_lines el
                            where el.estimate_id = e.id and el.org_id = e.org_id and el.deleted_at is null
                              and (el.tier is null or el.tier = e.recommended_tier))
                     else 0 end), 0)::bigint as "openPipeCents",
                 coalesce(sum(
                   case when e.status = 'accepted' and e.deleted_at is null
                     then (select coalesce(sum(round(el.quantity * el.rate_cents)), 0)
                             from estimate_lines el
                            where el.estimate_id = e.id and el.org_id = e.org_id and el.deleted_at is null
                              and (el.tier is null or el.tier = e.recommended_tier))
                     else 0 end), 0)::bigint as "revenueWonCents"
            from leads l
            left join estimates e on e.lead_id = l.id and e.org_id = l.org_id
           where l.org_id = ${orgId} and l.company_id is not null and l.deleted_at is null
           group by l.company_id
        `);
        return (rows as unknown as { companyId: string; people: number; openPipeCents: string | number; revenueWonCents: string | number }[]).map(
          (r) => ({
            companyId: r.companyId,
            people: r.people,
            openPipeCents: Number(r.openPipeCents),
            revenueWonCents: Number(r.revenueWonCents),
          }),
        );
      }),

    /** Live company names, lowercased — powers the import confirm step's new/updated split. */
    importNames: ownerOrOffice
      .output(z.object({ names: z.array(z.string()) }))
      .query(async ({ ctx }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        // Paged in bulk: the confirm step needs the COMPLETE set, and a name is a few dozen bytes.
        const page = await repo.list(toPage({ limit: 500, cursor: null }));
        return { names: page.items.map((c) => c.props.name.trim().toLowerCase()) };
      }),

    // Bulk CSV import. Same contract as the pricebook importers: a name collision PATCHES the
    // existing account rather than creating a second one, and only the keys the sheet carries are
    // written (an absent key leaves the stored value alone).
    importCompanies: ownerOrOffice
      .input(importCompaniesInput)
      .output(importResultDTO)
      .mutation(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;
        const repo = new DrizzleCompanyRepository(ctx.tx, orgId);
        const createCompany = new CreateCompanyUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const updateCompany = new UpdateCompanyUseCase(repo, ctx.deps.clock);

        // The whole chunk's existing accounts in ONE read, keyed by lowercased name — resolving
        // per row would be an N+1 across 500 rows.
        const existing = new Map<string, CompanyId>();
        for (const company of await repo.findByNames(input.rows.map((r) => r.name))) {
          existing.set(company.props.name.trim().toLowerCase(), company.props.id);
        }

        let created = 0;
        let updated = 0;
        let failed = 0;
        const errors: { index: number; message: string }[] = [];

        /**
         * Overwrite an account this row's name already matches. Only the keys the SHEET carries
         * are passed — an absent key leaves the stored value alone (Company.patch ignores
         * undefined), so a phone-only sheet cannot wipe addresses and notes.
         */
        const patchExisting = (row: z.infer<typeof importCompanyRowInput>, companyId: CompanyId) =>
          updateCompany.exec(
            {
              companyId,
              ...(row.phone !== undefined ? { phone: row.phone } : {}),
              ...(row.email !== undefined ? { email: row.email } : {}),
              ...(row.website !== undefined ? { website: row.website } : {}),
              ...(row.address !== undefined ? { address: row.address } : {}),
              ...(row.notes !== undefined ? { notes: row.notes } : {}),
            },
            orgId,
          );

        for (let i = 0; i < input.rows.length; i++) {
          const row = input.rows[i]!;
          const key = row.name.trim().toLowerCase();
          const hit = existing.get(key);

          const result = hit
            ? await patchExisting(row, hit)
            : await createCompany.exec(
                {
                  name: row.name,
                  phone: row.phone ?? null,
                  email: row.email ?? null,
                  website: row.website ?? null,
                  address: row.address ?? null,
                  notes: row.notes ?? null,
                },
                orgId,
              );

          if (!isOk(result)) {
            failed += 1;
            errors.push({ index: i, message: result.error.message });
            continue;
          }

          if (hit) {
            updated += 1;
          } else {
            created += 1;
            // Fold the new account in so a later row in the SAME chunk naming it updates rather
            // than creating a second one.
            existing.set(key, result.value.props.id);
          }
        }

        logger.info({ orgId, created, updated, failed }, "companies.imported");
        return { created, updated, deduped: 0, failed, errors };
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(companyDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateCompanyUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            name: input.name,
            phone: input.phone ?? null,
            email: input.email ?? null,
            website: input.website ?? null,
            address: input.address ?? null,
            notes: input.notes ?? null,
          },
          ctx.principal.orgId,
        );
        return toCompanyDTO(orThrow(result));
      }),

    update: ownerOrOffice
      .input(updateInput)
      .output(companyDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateCompanyUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            companyId: asCompanyId(input.companyId),
            name: input.name,
            phone: input.phone,
            email: input.email,
            website: input.website,
            address: input.address,
            notes: input.notes,
          },
          ctx.principal.orgId,
        );
        return toCompanyDTO(orThrow(result));
      }),

    archive: ownerOrOffice
      .input(archiveInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveCompanyUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { companyId: asCompanyId(input.companyId) },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),
  });
