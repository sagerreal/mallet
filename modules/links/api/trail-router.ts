import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { DrizzleTrailReader, TRAIL_CAP, type TrailKind } from "../infra/drizzle-trail-reader";

/**
 * modules/links/api/trail-router.ts
 * ONE read behind the customer › quote › job › invoice trail on all four sheets.
 *
 * A single procedure rather than four, because the trail is one idea: "what is this record attached
 * to". Four bespoke endpoints would drift into four different answers, which is exactly what the
 * screens did before — the quote sheet showed the customer's name as dead text, the job sheet showed
 * the job title where the name belonged, and none of them could reach the other three at all.
 *
 * READ-ONLY and org-scoped. `kind` names which of the four you are standing on; the reader decides
 * the scope from there (see its docstring — it is not the same scope on every sheet).
 */

export const TRAIL_KINDS = ["customer", "quote", "job", "invoice"] as const;

const customerDTO = z.object({ id: z.string().uuid(), name: z.string() });
const quoteDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  status: z.string(),
});
const jobDTO = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.string(),
  completedAt: z.string().nullable(),
});
const invoiceDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  status: z.string(),
  totalCents: z.number().int(),
  owedCents: z.number().int(),
  dueAt: z.string().nullable(),
});

export const trailDTO = z.object({
  customer: customerDTO.nullable(),
  quotes: z.array(quoteDTO),
  jobs: z.array(jobDTO),
  invoices: z.array(invoiceDTO),
  /** UNCAPPED totals — what the trail's label says. The arrays above stop at TRAIL_CAP. */
  counts: z.object({
    quotes: z.number().int(),
    jobs: z.number().int(),
    invoices: z.number().int(),
  }),
  /** So the client knows when its list is a truncation and should offer "see all". */
  cap: z.number().int(),
});

export const createTrailRouter = () =>
  router({
    /**
     * What this record is attached to. Absent relations come back as empty arrays with a zero
     * count — never omitted — so the client can state the absence ("no invoice") rather than
     * rendering nothing and leaving the user to wonder whether it failed to load.
     */
    forRecord: ownerOrOffice
      .input(
        z.object({
          kind: z.enum(TRAIL_KINDS),
          id: z.string().uuid(),
        }),
      )
      .output(trailDTO)
      .query(async ({ ctx, input }) => {
        const reader = new DrizzleTrailReader(ctx.tx, ctx.principal.orgId);
        const trail = await reader.forKind(input.kind as TrailKind, input.id);
        return {
          customer: trail.customer,
          quotes: [...trail.quotes],
          jobs: [...trail.jobs],
          invoices: [...trail.invoices],
          counts: trail.counts,
          cap: TRAIL_CAP,
        };
      }),
  });
