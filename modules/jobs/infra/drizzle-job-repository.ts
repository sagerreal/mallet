import { and, desc, eq, exists, getTableColumns, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { jobs, jobVisits, jobLines, jobAddons, jobVerifyAnswers, jobPhotos, leads, estimates } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import { keysetAfterSort, orderFor, decodeSortCursor, encodeSortCursor, sortValueOf, sortValueColumn } from "@mallet/shared/db/sort-page";
import { jobSortSpec, type JobSort } from "./job-sorts";
import { viewCondition, visitsBetween, type JobView } from "./job-views";
import {
  buildPage,
  decodeCursor,
  isOk,
  asJobId,
  type OrgId,
  type JobId,
  type LeadId,
  type EstimateId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Job, JobChecklistProps } from "../domain/job";
import type { JobSignature } from "../domain/job-signature";
import type { JobRepository, JobFilter, JobExecution, CallbackScanRow, AutopsyPairRow, AdoptEstimatePatch, JobPricingPatch } from "../domain/job-repository";
import { flipScopeVisitJob, appendPendingVisit } from "./job-convert";
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "../domain/job-execution";
import { toDomain, type JobVisitRow } from "./job-mapper";
import { lineToDomain, addonToDomain, verifyToDomain, photoToDomain, type JobLineRow, type JobAddonRowWithSigner, type JobVerifyAnswerRow, type JobPhotoRow } from "./job-execution-mapper";

// Real persistence. Constructed with a tenant-scoped tx (withTenant set app.current_org_id), so
// RLS appends org_id = current_org_id() to every statement — this class never filters by org
// itself. orgId only stamps written rows and scopes the number sequence.
export class DrizzleJobRepository implements JobRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async nextNumber(): Promise<string> {
    await this.tx.execute(sql`
      insert into number_sequences (org_id, kind) values (${this.orgId}, 'job')
      on conflict (org_id, kind) do nothing
    `);
    const rows = (await this.tx.execute(sql`
      update number_sequences set next_val = next_val + 1, updated_at = now()
      where org_id = ${this.orgId} and kind = 'job'
      returning next_val - 1 as allocated
    `)) as unknown as { allocated: number }[];
    const allocated = rows[0]?.allocated ?? 1000;
    return `JOB-${allocated}`;
  }

  private mutableColumns(job: Job) {
    const p = job.props;
    return {
      num: p.num,
      leadId: p.leadId,
      sourceEstimateId: p.sourceEstimateId,
      assigneeUserId: p.assigneeUserId,
      title: p.title,
      status: p.status,
      scheduledStart: p.scheduledStart,
      scheduledEnd: p.scheduledEnd,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      canceledAt: p.canceledAt,
      cancelReason: p.cancelReason,
      totalCents: p.total,
      taxBps: p.taxBps,
      taxCents: p.tax,
      notes: p.notes,
      addr: p.addr,
      phone: p.phone,
      completion: p.completion,
      invRequested: p.invRequested,
      scope: p.scope,
      callbackOf: p.callbackOf,
      callbackReason: p.callbackReason,
      svc: p.svc,
      kind: p.kind,
      // Deep-copy out of the immutable domain props into a plain mutable JSON blob.
      checklist: p.checklist
        ? { name: p.checklist.name, items: p.checklist.items.map((it) => ({ ...it })) }
        : null,
      requiredCerts: p.requiredCerts ? [...p.requiredCerts] : null,
      updatedAt: p.updatedAt,
    };
  }

  async save(job: Job): Promise<void> {
    const p = job.props;
    const mutable = this.mutableColumns(job);
    await this.tx
      .insert(jobs)
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, ...mutable })
      .onConflictDoUpdate({ target: jobs.id, set: mutable });

    const keptIds: string[] = [];
    for (const visit of p.visits) {
      keptIds.push(visit.props.id);
      await this.upsertVisit(p.id, p.orgId, visit, p.updatedAt);
    }

    // Soft-delete any visits that were removed from the aggregate.
    const removeConds = [eq(jobVisits.jobId, p.id), isNull(jobVisits.deletedAt)];
    if (keptIds.length > 0) removeConds.push(notInArray(jobVisits.id, keptIds));
    await this.tx.update(jobVisits).set({ deletedAt: p.updatedAt }).where(and(...removeConds));
  }

  private async upsertVisit(
    jobId: string,
    orgId: OrgId,
    visit: import("../domain/job").JobVisit,
    updatedAt: Date,
  ): Promise<void> {
    const vp = visit.props;
    const columns = {
      assigneeUserId: vp.assigneeUserId,
      scheduledDate: vp.scheduledDate,
      scheduledStart: vp.scheduledStart,
      scheduledEnd: vp.scheduledEnd,
      durationMinutes: vp.durationMinutes,
      lat: vp.lat ?? null,
      lng: vp.lng ?? null,
      status: vp.status,
      enrouteAt: vp.enrouteAt,
      startedAt: vp.startedAt,
      completedAt: vp.completedAt,
      notes: vp.notes,
      position: vp.position,
      updatedAt,
      deletedAt: null as Date | null,
    };
    await this.tx
      .insert(jobVisits)
      .values({ id: vp.id, orgId, jobId, createdAt: updatedAt, ...columns })
      .onConflictDoUpdate({ target: jobVisits.id, set: columns });
  }

  // Plain insert for a manually-created (non-estimate) job. Reuses save() so visits (if any)
  // persist too; the client-authored id makes this idempotent under retry.
  async insertManual(job: Job): Promise<void> {
    await this.save(job);
  }

  // Soft-delete a job. Returns rows affected (0 = not found / already archived).
  // WHERE includes org_id for tenant safety (belt-and-suspenders alongside RLS) and
  // deleted_at IS NULL so a double-archive is a no-op rather than a timestamp clobber.
  async archive(id: JobId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobs)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)))
      .returning({ id: jobs.id });
    return rows.length;
  }

  // Cascade soft-delete of a lead's ACTIVE jobs + their visits when the customer is archived.
  // Only scheduled/in_progress jobs are swept — terminal complete/canceled jobs are preserved as
  // history, exactly as the estimate cascade preserves accepted quotes. Explicit orgId filter is
  // defense-in-depth on top of RLS. Visits of the swept jobs are cleared too, so no orphan visit
  // lingers on the board pointing at an archived job. Returns the number of jobs archived.
  async archiveByLead(leadId: LeadId, now: Date): Promise<number> {
    const archived = await this.tx
      .update(jobs)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobs.orgId, this.orgId),
          eq(jobs.leadId, leadId),
          isNull(jobs.deletedAt),
          inArray(jobs.status, ["scheduled", "in_progress"]),
        ),
      )
      .returning({ id: jobs.id });
    const jobIds = archived.map((r) => r.id);
    if (jobIds.length > 0) {
      await this.tx
        .update(jobVisits)
        .set({ deletedAt: now })
        .where(
          and(
            eq(jobVisits.orgId, this.orgId),
            inArray(jobVisits.jobId, jobIds),
            isNull(jobVisits.deletedAt),
          ),
        );
    }
    return jobIds.length;
  }

  // Idempotent create keyed on the source estimate: ON CONFLICT DO NOTHING (does NOT abort the
  // surrounding transaction the way a raised unique-violation would), returning whether a row was
  // inserted. A false result means an active job already exists for this estimate — the caller
  // re-fetches it in the still-valid transaction. Matches the ensureCustomer pattern.
  async insertForEstimate(job: Job): Promise<boolean> {
    const p = job.props;
    const inserted = await this.tx
      .insert(jobs)
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, ...this.mutableColumns(job) })
      .onConflictDoNothing({
        target: [jobs.orgId, jobs.sourceEstimateId],
        where: sql`source_estimate_id is not null and deleted_at is null`,
      })
      .returning({ id: jobs.id });
    if (inserted.length === 0) return false; // lost the race — the winner is re-fetched with its own visits
    // Persist the aggregate's visits in the same savepoint; without this the caller's seeded
    // visit would be a phantom that the next hydrator sweep removes.
    for (const visit of p.visits) {
      await this.upsertVisit(p.id, p.orgId, visit, p.updatedAt);
    }
    return true;
  }

  /**
   * Link a FIELD-BORN estimate to the job it was signed on (the reverse of insertForEstimate's
   * office direction: there the estimate exists first and mints the job; here the job existed
   * first and the on-site sign minted the estimate). Write-once: only fills a NULL
   * source_estimate_id — an existing link is a different sale record and must not be clobbered.
   * Returns rows affected (0 = job missing, archived, or already linked).
   *
   * Concrete-repository method, not part of the JobRepository port: it exists solely for the
   * field-sign transport composition, and the port's ~16 in-memory fakes have no use for it.
   */
  async setSourceEstimate(jobId: JobId, estimateId: EstimateId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobs)
      .set({ sourceEstimateId: estimateId, updatedAt: now })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.orgId, this.orgId),
          isNull(jobs.sourceEstimateId),
          isNull(jobs.deletedAt),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length;
  }

  /**
   * Convert a scope-visit job into the sold work IN PLACE (see the port doc; the SQL and the
   * guard rationale live in job-convert.ts). Flip, swap the lines, append ONE pending visit —
   * all in the caller's tx, so any failure rolls the whole conversion back.
   */
  async adoptEstimateOnJob(
    orgId: OrgId,
    jobId: JobId,
    patch: AdoptEstimatePatch,
    lines: readonly JobLine[],
    now: Date,
  ): Promise<boolean> {
    const flipped = await flipScopeVisitJob(this.tx, orgId, jobId, patch, now);
    if (!flipped) return false;
    // The sold scope replaces whatever the walkthrough carried — same swap the on-site pricing
    // path uses, inside the same tx as the flip.
    //
    // The ACCEPTED ESTIMATE's total is passed through rather than derived from the lines: it is
    // tax-INCLUSIVE and may carry a discount, and the job's lines are neither, so the line sum is
    // a pre-tax, pre-discount subtotal (measured against the live DB: a $400 quote at 10% tax
    // stores 44000 against a 40000 line sum). What the customer accepted is what the job owes.
    await this.replaceLines(jobId, lines, now, patch.totalCents);
    await appendPendingVisit(this.tx, orgId, jobId, now);
    return true;
  }

  async findById(id: JobId): Promise<Job | null> {
    const rows = await this.tx
      .select({ job: jobs, visit: jobVisits })
      .from(jobs)
      .leftJoin(
        jobVisits,
        and(
          eq(jobVisits.orgId, jobs.orgId),
          eq(jobVisits.jobId, jobs.id),
          isNull(jobVisits.deletedAt),
        ),
      )
      .where(and(eq(jobs.id, id), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)));
    const header = rows[0]?.job;
    if (!header) return null;
    const visitRows = rows.map((r) => r.visit).filter((v): v is JobVisitRow => v !== null);
    return toDomain(header, visitRows);
  }

  async findBySourceEstimate(estimateId: EstimateId): Promise<Job | null> {
    const rows = await this.tx
      .select({ job: jobs, visit: jobVisits })
      .from(jobs)
      .leftJoin(
        jobVisits,
        and(
          eq(jobVisits.orgId, jobs.orgId),
          eq(jobVisits.jobId, jobs.id),
          isNull(jobVisits.deletedAt),
        ),
      )
      .where(and(eq(jobs.sourceEstimateId, estimateId), isNull(jobs.deletedAt)));
    const header = rows[0]?.job;
    if (!header) return null;
    const visitRows = rows.map((r) => r.visit).filter((v): v is JobVisitRow => v !== null);
    return toDomain(header, visitRows);
  }

  /**
   * How many jobs match, ignoring pagination.
   *
   * Shares listConds with list() deliberately. A count built from a second, hand-copied predicate
   * is a count that drifts from its list the first time a filter changes — and a header reading
   * "220 of 1,521" is only worth showing if the 1,521 is the same question as the 220.
   */
  /**
   * Every view's count in ONE round trip.
   *
   * Six correlated subqueries in a single SELECT rather than six queries: the Jobs screen shows
   * all six numbers at once in the filter dropdown, and six sequential round trips on one pooled
   * connection is the difference between the dropdown opening instantly and visibly filling in.
   */
  async viewCounts(
    today: string,
    base?: JobFilter,
  ): Promise<{ counts: Record<JobView, number>; todayCents: number; needsSlotCents: number; needsInvoiceCents: number }> {
    const baseConds = this.listConds({ ...base, view: undefined });
    const one = (v: JobView) =>
      sql<number>`count(*) filter (where ${viewCondition(v, this.tx, { today })})::int`;
    const rows = await this.tx
      .select({
        needsSlot: one("needsSlot"),
        today: one("today"),
        week: one("week"),
        upcoming: one("upcoming"),
        needsInvoice: one("needsInvoice"),
        done: one("done"),
        archived: one("archived"),
        // Today's money, summed in the same query rather than by adding up loaded rows. The
        // headline figure read the store, so on a shop with more jobs than one page it stated a
        // number derived from whichever 500 happened to be cached.
        todayCents: sql<number>`coalesce(sum(${jobs.totalCents}) filter (where ${viewCondition("today", this.tx, { today })}), 0)::int`,
        // The Dashboard's "Needs a slot" and "To bill" figures, summed here for the same reason:
        // they were added up from the loaded page, so on a shop with more jobs than one page they
        // stated a fraction of the real money as fact.
        needsSlotCents: sql<number>`coalesce(sum(${jobs.totalCents}) filter (where ${viewCondition("needsSlot", this.tx, { today })}), 0)::int`,
        needsInvoiceCents: sql<number>`coalesce(sum(${jobs.totalCents}) filter (where ${viewCondition("needsInvoice", this.tx, { today })}), 0)::int`,
      })
      .from(jobs)
      .where(and(...baseConds));
    const r = rows[0];
    return {
      todayCents: r?.todayCents ?? 0,
      needsSlotCents: r?.needsSlotCents ?? 0,
      needsInvoiceCents: r?.needsInvoiceCents ?? 0,
      counts: {
      needsSlot: r?.needsSlot ?? 0,
      today: r?.today ?? 0,
      week: r?.week ?? 0,
      upcoming: r?.upcoming ?? 0,
      needsInvoice: r?.needsInvoice ?? 0,
      done: r?.done ?? 0,
      archived: r?.archived ?? 0,
      },
    };
  }

  async count(filter?: JobFilter): Promise<number> {
    const rows = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(...this.listConds(filter)));
    return rows[0]?.n ?? 0;
  }

  private listConds(filter?: JobFilter): SQL[] {
    const conds: SQL[] = [isNull(jobs.deletedAt)];
    if (filter?.status) conds.push(eq(jobs.status, filter.status));
    // The nav badge's "open jobs". Terminal statuses are excluded rather than a status matched,
    // because the badge means "still to do", not "in one particular state".
    if (filter?.activeOnly) conds.push(notInArray(jobs.status, ["complete", "canceled"]));
    if (filter?.view && filter.today) {
      conds.push(viewCondition(filter.view, this.tx, { today: filter.today }));
    }
    if (filter?.visitFrom && filter?.visitTo) {
      // EXISTS, not a join: a job with three visits in the range must come back once, and a join
      // would return it three times and break the keyset.
      conds.push(visitsBetween(this.tx, filter.visitFrom, filter.visitTo));
    }
    if (filter?.search) {
      // Escape the LIKE wildcards before wrapping in our own. Without this a customer typing "%"
      // matches every job in the org, and "_" matches any single character — the search silently
      // stops filtering and nobody can tell why.
      const term = filter.search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = `%${term}%`;
      // Customer name is searched through an EXISTS subquery rather than a join. A join would
      // multiply job rows and break the keyset, whereas EXISTS is a filter and leaves the
      // ordering — and therefore the cursor — untouched. It matters that this is here at all:
      // the client-side search it replaces covered customer name, and dropping it would be a
      // regression the office would notice on the first search.
      const cond = or(
        ilike(jobs.title, like),
        ilike(jobs.num, like),
        exists(
          this.tx
            .select({ one: sql`1` })
            .from(leads)
            .where(and(eq(leads.orgId, jobs.orgId), eq(leads.id, jobs.leadId), ilike(leads.name, like))),
        ),
      );
      if (cond) conds.push(cond);
    }
    if (filter?.openOrCompletedBetween) {
      // Open work, plus work FINISHED inside the caller's own day — the field agenda's shape.
      // Half-open [from, to) so a job completed at exactly midnight belongs to one day only.
      // `canceled` is never included: a called-off job is not something you did today.
      const { from, to } = filter.openOrCompletedBetween;
      const cond = or(
        inArray(jobs.status, ["scheduled", "in_progress"]),
        and(eq(jobs.status, "complete"), gte(jobs.completedAt, from), lt(jobs.completedAt, to)),
      );
      if (cond) conds.push(cond);
    }
    if (filter?.assigneeUserId) conds.push(eq(jobs.assigneeUserId, filter.assigneeUserId));
    if (filter?.leadId) conds.push(eq(jobs.leadId, filter.leadId));
    if (filter?.assignedUserId) {
      // Visit-aware assignment — the SQL twin of Job.isAssignedTo: the job-level
      // assignee OR the assignee of any active (non-canceled, non-deleted) visit.
      const cond = or(
        eq(jobs.assigneeUserId, filter.assignedUserId),
        exists(
          this.tx
            .select({ one: sql`1` })
            .from(jobVisits)
            .where(
              and(
                eq(jobVisits.orgId, jobs.orgId),
                eq(jobVisits.jobId, jobs.id),
                eq(jobVisits.assigneeUserId, filter.assignedUserId),
                ne(jobVisits.status, "canceled"),
                isNull(jobVisits.deletedAt),
              ),
            ),
        ),
      );
      if (cond) conds.push(cond);
    }
    return conds;
  }

  list(
    page: CursorPage,
    filter?: JobFilter,
    sort?: JobSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Job>> {
    return this.loadPage(this.listConds(filter), page, sort, sortDir);
  }

  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.loadPage([isNull(jobs.deletedAt), eq(jobs.leadId, leadId)], page);
  }

  // ── job execution data (Phase 5) ─────────────────────────────────────────

  /**
   * Add-on columns plus the name on the addendum the customer signed.
   *
   * LEFT JOIN, not inner: almost every add-on has no approval estimate (proposed, declined, or
   * approved before the evidence columns existed), and an inner join would drop them from the
   * job entirely — found work vanishing off a sheet is the exact failure this whole flow is
   * about. The signer is READ rather than copied onto job_addons so the signed amount and the
   * name it belongs to stay in one place.
   */
  private addonSelection() {
    return this.tx
      .select({ ...getTableColumns(jobAddons), approvalSignerName: estimates.signerName })
      .from(jobAddons)
      .leftJoin(
        estimates,
        and(
          eq(estimates.orgId, jobAddons.orgId),
          eq(estimates.id, jobAddons.approvalEstimateId),
          isNull(estimates.deletedAt),
        ),
      );
  }

  async listExecution(jobId: JobId): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }> {
    const [lineRows, addonRows, answerRows, photoRows] = await Promise.all([
      this.tx
        .select()
        .from(jobLines)
        .where(and(eq(jobLines.jobId, jobId), isNull(jobLines.deletedAt)))
        .orderBy(jobLines.position, jobLines.createdAt),
      this.addonSelection()
        .where(and(eq(jobAddons.jobId, jobId), isNull(jobAddons.deletedAt)))
        .orderBy(jobAddons.position, jobAddons.createdAt),
      this.tx
        .select()
        .from(jobVerifyAnswers)
        .where(eq(jobVerifyAnswers.jobId, jobId)),
      this.tx
        .select()
        .from(jobPhotos)
        .where(and(eq(jobPhotos.jobId, jobId), isNull(jobPhotos.deletedAt)))
        .orderBy(jobPhotos.position, jobPhotos.createdAt),
    ]);
    return {
      lines: (lineRows as JobLineRow[]).map(lineToDomain),
      addons: (addonRows as JobAddonRowWithSigner[]).map(addonToDomain),
      verifyAnswers: (answerRows as JobVerifyAnswerRow[]).map(verifyToDomain),
      photos: (photoRows as JobPhotoRow[]).map(photoToDomain),
    };
  }

  // Batched twin of listExecution for list surfaces (myDay): 4 IN-clause queries for the
  // whole page instead of 4 per job. Same ordering and soft-delete filters per collection.
  async listExecutionForJobs(jobIds: readonly JobId[]): Promise<Map<string, JobExecution>> {
    const byJob = new Map<string, JobExecution>();
    for (const id of jobIds) {
      byJob.set(id, { lines: [], addons: [], verifyAnswers: [], photos: [] });
    }
    if (jobIds.length === 0) return byJob;

    const ids = [...jobIds];
    const [lineRows, addonRows, answerRows, photoRows] = await Promise.all([
      this.tx
        .select()
        .from(jobLines)
        .where(and(inArray(jobLines.jobId, ids), isNull(jobLines.deletedAt)))
        .orderBy(jobLines.position, jobLines.createdAt),
      this.addonSelection()
        .where(and(inArray(jobAddons.jobId, ids), isNull(jobAddons.deletedAt)))
        .orderBy(jobAddons.position, jobAddons.createdAt),
      this.tx
        .select()
        .from(jobVerifyAnswers)
        .where(inArray(jobVerifyAnswers.jobId, ids)),
      this.tx
        .select()
        .from(jobPhotos)
        .where(and(inArray(jobPhotos.jobId, ids), isNull(jobPhotos.deletedAt)))
        .orderBy(jobPhotos.position, jobPhotos.createdAt),
    ]);

    for (const row of lineRows as JobLineRow[]) byJob.get(row.jobId)?.lines.push(lineToDomain(row));
    for (const row of addonRows as JobAddonRowWithSigner[]) byJob.get(row.jobId)?.addons.push(addonToDomain(row));
    for (const row of answerRows as JobVerifyAnswerRow[]) {
      byJob.get(row.jobId)?.verifyAnswers.push(verifyToDomain(row));
    }
    for (const row of photoRows as JobPhotoRow[]) byJob.get(row.jobId)?.photos.push(photoToDomain(row));
    return byJob;
  }

  /**
   * Re-derive `jobs.total_cents` from the job's own live lines, in ONE statement.
   *
   * WHY THIS EXISTS. `total_cents` was written once — at create, from the accepted estimate — and
   * never again. Every line write since then left it behind: JOB-2545 in the pilot org carried a
   * single $185 line and a stored total of $0, and so did JOB-2544 and JOB-1015. A job that has
   * been priced has to know its own price, because the stored number is what Money's ready-to-bill
   * rollup sums, what the `noPrice` view filters on, and what the Amount sort orders by. All three
   * were quietly reporting zero on work the shop had already sold.
   *
   * THE FORMULA is `Σ round(quantity × rate_cents)` — rounded PER LINE, not on the sum. That is
   * exactly `lineAmountCents` in modules/jobs/domain/job-signature.ts (what the field modal totals
   * on screen and what the customer signs) and exactly the estimate repository's own SQL. Three
   * places, one arithmetic: a signed $185 and a stored $185 must be the same $185.
   *
   * TAX. `total_cents` is tax-INCLUSIVE (see CreateJobFromEstimateUseCase.mint: "The total is
   * tax-INCLUSIVE, so this records the split rather than adding anything to what is owed"). On the
   * field and price-builder paths the tax the tech quoted is already inside the line rates
   * (job-signature.ts says so explicitly and records taxCents as 0), so the line sum IS the
   * tax-inclusive total and nothing is added here. The one path where that is NOT true — the
   * estimate→job sale, whose total carries the estimate's tax and any discount, neither of which
   * is reconstructible from the job's lines — passes its own figure through replaceLines instead.
   *
   * `override` is that figure. It is applied in the SAME statement rather than as a follow-up
   * UPDATE so there is never an instant, even inside the transaction, where the row states a total
   * nobody agreed to.
   */
  private async syncTotalFromLines(
    jobId: JobId,
    now: Date,
    override?: number,
    pricing?: JobPricingPatch,
  ): Promise<void> {
    const derived = sql<number>`coalesce((
      select sum(round(jl.quantity * jl.rate_cents))::int
      from job_lines jl
      where jl.job_id = ${jobId} and jl.org_id = ${this.orgId} and jl.deleted_at is null
    ), 0)`;
    await this.tx
      .update(jobs)
      .set({
        totalCents: override ?? derived,
        // Same statement as the total for the same reason: the rates and the figure they produced
        // must never be observable apart, not even mid-transaction.
        ...(pricing
          ? { discBps: pricing.discBps, taxBps: pricing.taxBps, taxCents: pricing.taxCents }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)));
  }

  async addLine(line: JobLine, now: Date): Promise<void> {
    const p = line.props;
    await this.tx.insert(jobLines).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      description: p.description,
      quantity: p.quantity,
      rateCents: p.rate,
      costCents: p.cost,
      taxable: p.taxable,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
    await this.syncTotalFromLines(asJobId(p.jobId), now);
  }

  async updateLine(line: JobLine, now: Date): Promise<number> {
    const p = line.props;
    const rows = await this.tx
      .update(jobLines)
      .set({
        description: p.description,
        quantity: p.quantity,
        rateCents: p.rate,
        costCents: p.cost,
        taxable: p.taxable,
        position: p.position,
        updatedAt: now,
      })
      .where(and(eq(jobLines.id, p.id), eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt)))
      .returning({ id: jobLines.id });
    if (rows.length > 0) await this.syncTotalFromLines(asJobId(p.jobId), now);
    return rows.length;
  }

  async removeLine(jobId: JobId, lineId: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobLines)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobLines.id, lineId),
          eq(jobLines.jobId, jobId),
          eq(jobLines.orgId, this.orgId),
          isNull(jobLines.deletedAt),
        ),
      )
      .returning({ id: jobLines.id });
    if (rows.length > 0) await this.syncTotalFromLines(jobId, now);
    return rows.length;
  }

  // Bulk-replace the job's lines. Soft-deletes every current (non-deleted) line for the job,
  // then inserts the new set, then re-derives jobs.total_cents from what is now there (see
  // syncTotalFromLines — this is the write that used to be missing, so a job priced through the
  // price builder, the field sign-off or the estimate conversion kept a stored total of $0
  // forever). All three statements run in the same tenant tx; the ownerOrOffice orgTx re-throw
  // guard rolls the whole swap back on any failure, so the lines and the total can never disagree.
  // org-scoped by both the implicit RLS tx and the explicit eq(orgId) filter (defense-in-depth +
  // index use).
  //
  // An EMPTY set zeroes the total, deliberately: clearing a job's price is un-pricing it, and
  // leaving the old headline behind would bill the customer for lines that no longer exist.
  //
  // `totalCents` overrides the derivation for the accepted-estimate paths — see the port doc.
  async replaceLines(
    jobId: JobId,
    lines: readonly JobLine[],
    now: Date,
    totalCents?: number,
    pricing?: JobPricingPatch,
  ): Promise<void> {
    await this.tx
      .update(jobLines)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(jobLines.jobId, jobId), eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt)));
    if (lines.length > 0) {
      await this.tx.insert(jobLines).values(
        lines.map((line) => {
          const p = line.props;
          return {
            id: p.id,
            orgId: this.orgId,
            jobId: p.jobId,
            description: p.description,
            quantity: p.quantity,
            rateCents: p.rate,
            costCents: p.cost,
            taxable: p.taxable,
            position: p.position,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }
    await this.syncTotalFromLines(jobId, now, totalCents, pricing);
  }

  /**
   * Write the on-glass signature onto the job.
   *
   * Runs in the same tenant tx as the replaceLines call that precedes it, so a failed line write
   * takes the signature down with it — a signature referring to prices that never persisted is
   * worse than no signature, because it looks like proof of a number nobody agreed to.
   *
   * org-scoped by both RLS and the explicit eq(orgId), like every write here.
   */
  async saveOnSiteSignature(
    jobId: JobId,
    signature: JobSignature,
    signedByUserId: string | null,
    now: Date,
  ): Promise<void> {
    await this.tx
      .update(jobs)
      .set({
        signerName: signature.signerName,
        signatureSvg: signature.signatureSvg,
        signerIp: signature.signerIp,
        signerUserAgent: signature.signerUserAgent,
        signedAt: signature.signedAt,
        signedSnapshot: signature.snapshot,
        signedByUserId,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)));
  }

  async addAddon(addon: JobAddon, now: Date): Promise<void> {
    const p = addon.props;
    await this.tx.insert(jobAddons).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      description: p.description,
      quantity: p.quantity,
      rateCents: p.rate,
      costCents: p.cost,
      isOptional: p.isOptional,
      invoiceSkip: p.invoiceSkip,
      status: p.status,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
  }

  // See the port doc. `status = 'proposed'` in the WHERE is the guard that keeps a declined or
  // already-signed add-on out of a fresh signature; the returned ids let the caller check that
  // every line it just had signed for actually moved.
  async approveAddons(
    jobId: JobId,
    addonIds: readonly string[],
    approval: { byUserId: string | null; estimateId: string; at: Date },
    now: Date,
  ): Promise<string[]> {
    if (addonIds.length === 0) return [];
    const rows = await this.tx
      .update(jobAddons)
      .set({
        status: "approved",
        approvedByUserId: approval.byUserId,
        approvedAt: approval.at,
        approvalEstimateId: approval.estimateId,
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobAddons.id, [...addonIds]),
          eq(jobAddons.jobId, jobId),
          eq(jobAddons.orgId, this.orgId),
          eq(jobAddons.status, "proposed"),
          isNull(jobAddons.deletedAt),
        ),
      )
      .returning({ id: jobAddons.id });
    return rows.map((r) => r.id);
  }

  async setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobAddons)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(jobAddons.id, addonId),
          eq(jobAddons.jobId, jobId),
          eq(jobAddons.orgId, this.orgId),
          isNull(jobAddons.deletedAt),
        ),
      )
      .returning({ id: jobAddons.id });
    return rows.length;
  }

  async setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobAddons)
      .set({ invoiceSkip, updatedAt: now })
      .where(
        and(
          eq(jobAddons.id, addonId),
          eq(jobAddons.jobId, jobId),
          eq(jobAddons.orgId, this.orgId),
          isNull(jobAddons.deletedAt),
        ),
      )
      .returning({ id: jobAddons.id });
    return rows.length;
  }

  async upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void> {
    const p = answer.props;
    await this.tx
      .insert(jobVerifyAnswers)
      .values({
        orgId: this.orgId,
        jobId: p.jobId,
        itemId: p.itemId,
        state: p.state,
        via: p.via,
        reason: p.reason,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [jobVerifyAnswers.orgId, jobVerifyAnswers.jobId, jobVerifyAnswers.itemId],
        set: { state: p.state, via: p.via, reason: p.reason, updatedAt: now },
      });
  }

  async removeVerifyAnswer(jobId: JobId, itemId: string): Promise<number> {
    const rows = await this.tx
      .delete(jobVerifyAnswers)
      .where(
        and(
          eq(jobVerifyAnswers.jobId, jobId),
          eq(jobVerifyAnswers.itemId, itemId),
          eq(jobVerifyAnswers.orgId, this.orgId),
        ),
      )
      .returning({ id: jobVerifyAnswers.id });
    return rows.length;
  }

  async addPhoto(photo: JobPhoto, now: Date): Promise<void> {
    const p = photo.props;
    await this.tx.insert(jobPhotos).values({
      id: p.id,
      orgId: this.orgId,
      jobId: p.jobId,
      storagePath: p.storagePath,
      caption: p.caption,
      verifyPass: p.verifyPass,
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
  }

  async removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number> {
    const rows = await this.tx
      .update(jobPhotos)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobPhotos.id, photoId),
          eq(jobPhotos.jobId, jobId),
          eq(jobPhotos.orgId, this.orgId),
          isNull(jobPhotos.deletedAt),
        ),
      )
      .returning({ id: jobPhotos.id });
    return rows.length;
  }

  async listConfirmedCallbacksWithOriginals(since: Date): Promise<AutopsyPairRow[]> {
    // Query 1: confirmed callbacks created on/after `since`.
    const callbackRows = await this.tx
      .select({
        id: jobs.id,
        num: jobs.num,
        svc: jobs.svc,
        completedAt: jobs.completedAt,
        callbackOf: jobs.callbackOf,
      })
      .from(jobs)
      .where(
        and(
          isNull(jobs.deletedAt),
          eq(jobs.orgId, this.orgId),
          eq(jobs.callbackReason, "callback"),
          isNotNull(jobs.callbackOf),
          gte(jobs.createdAt, since),
        ),
      );

    const originalIds = [...new Set(callbackRows.map((r) => r.callbackOf).filter((id): id is string => id !== null))];
    if (originalIds.length === 0) return [];

    // Query 2: load originals by id, same org, non-deleted.
    const originalRows = await this.tx
      .select({
        id: jobs.id,
        num: jobs.num,
        svc: jobs.svc,
        completedAt: jobs.completedAt,
        checklist: jobs.checklist,
      })
      .from(jobs)
      .where(and(inArray(jobs.id, originalIds), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)));

    // Build lookup map and stitch pairs in memory (no N+1).
    const originalsById = new Map(
      originalRows.map((r) => [
        r.id,
        {
          id: asJobId(r.id),
          num: r.num,
          svc: r.svc ?? null,
          completedAt: r.completedAt ?? null,
          checklist: (r.checklist ?? null) as JobChecklistProps | null,
        },
      ]),
    );

    const pairs: AutopsyPairRow[] = [];
    for (const cb of callbackRows) {
      const original = cb.callbackOf ? originalsById.get(cb.callbackOf) : undefined;
      if (!original) continue; // original missing or deleted — drop the pair
      pairs.push({
        callback: {
          id: asJobId(cb.id),
          num: cb.num,
          svc: cb.svc ?? null,
          completedAt: cb.completedAt ?? null,
        },
        original,
      });
    }
    return pairs;
  }

  async listRecentForCallbackScan(since: Date): Promise<CallbackScanRow[]> {
    const rows = await this.tx
      .select({
        id: jobs.id,
        num: jobs.num,
        leadId: jobs.leadId,
        svc: jobs.svc,
        status: jobs.status,
        completedAt: jobs.completedAt,
        scheduledStart: jobs.scheduledStart,
        createdAt: jobs.createdAt,
        callbackOf: jobs.callbackOf,
        callbackReason: jobs.callbackReason,
      })
      .from(jobs)
      // kind='work' only: an estimate visit is a sales walkthrough, not work that can "not hold".
      // Without this, a voice-booked estimate (kind='estimate', svc='Water heater repair') that
      // completes becomes a callback ORIGINAL, and the real repair booked days later gets flagged
      // as "the original work didn't hold" — a false accusation against a job that never existed.
      .where(and(isNull(jobs.deletedAt), gte(jobs.createdAt, since), eq(jobs.orgId, this.orgId), eq(jobs.kind, "work")));
    return rows.map((r) => ({
      ...r,
      id: asJobId(r.id),
      callbackOf: r.callbackOf ? asJobId(r.callbackOf) : null,
    }));
  }

  /**
   * One page of job headers, ordered by the requested sort.
   *
   * `sort` is optional so every existing caller keeps the old newest-first behaviour untouched;
   * only callers that ask for a sort get the new path. The cursor MUST be built from the same
   * sort that produced it — a created_at cursor means nothing in a scheduled-date ordering — so
   * the two branches below never mix.
   */
  private async loadPage(
    baseConds: SQL[],
    page: CursorPage,
    sort?: JobSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Job>> {
    const conds = [...baseConds];
    const spec = sort ? jobSortSpec(sort, sortDir) : null;

    if (page.cursor) {
      if (spec) {
        const c = decodeSortCursor(page.cursor);
        // A malformed cursor is ignored rather than fatal: the caller gets page one, which is
        // wrong but harmless, where throwing would break a list on a stale bookmark.
        if (c) {
          const after = keysetAfterSort(spec, jobs.id, c);
          if (after) conds.push(after);
        }
      } else {
        const cursor = decodeCursor(page.cursor);
        if (isOk(cursor)) conds.push(keysetBefore(jobs.createdAt, jobs.id, cursor.value));
      }
    }

    // Paginate job headers first, then batch-load their visits in one query (no N+1).
    //
    // The sorted path selects the sort column a SECOND time, cast to text, and builds the cursor
    // from that. A timestamptz round-tripped through a JS Date loses microseconds, and a cursor
    // built from the truncated value matches its own row again — every page then repeats the
    // previous page's last row. Invisible on whole-second seed data, guaranteed on real data.
    //
    // Sorting by CUSTOMER joins leads. Safe here, and only here: jobs → leads is many-to-ONE, so
    // the join returns exactly one row per job and the keyset is undisturbed (verified: 1,524 jobs
    // in, 1,524 out). The alternative — a correlated subquery in ORDER BY — cannot use an index
    // and measured a sequential scan at 53ms on 1,521 jobs against 6ms for the join, which is the
    // difference between fine today and a timeout at 40,000.
    const joinsCustomer = sort === "customer";
    const selected = spec
      ? joinsCustomer
        ? await this.tx
            .select({ row: jobs, sortValue: sortValueColumn(spec) })
            .from(jobs)
            .innerJoin(leads, and(eq(leads.orgId, jobs.orgId), eq(leads.id, jobs.leadId)))
            .where(and(...conds))
            .orderBy(...orderFor(spec, jobs.id))
            .limit(page.limit + 1)
        : await this.tx
            .select({ row: jobs, sortValue: sortValueColumn(spec) })
            .from(jobs)
            .where(and(...conds))
            .orderBy(...orderFor(spec, jobs.id))
            .limit(page.limit + 1)
      : null;
    const headers = selected
      ? selected.map((r) => r.row)
      : await this.tx
          .select()
          .from(jobs)
          .where(and(...conds))
          .orderBy(desc(jobs.createdAt), desc(jobs.id))
          .limit(page.limit + 1);

    const ids = headers.map((h) => h.id);
    const visitRows: JobVisitRow[] = ids.length
      ? await this.tx
          .select()
          .from(jobVisits)
          .where(and(inArray(jobVisits.jobId, ids), isNull(jobVisits.deletedAt)))
      : [];

    const visitsByJob = new Map<string, JobVisitRow[]>();
    for (const v of visitRows) {
      const bucket = visitsByJob.get(v.jobId) ?? [];
      bucket.push(v);
      visitsByJob.set(v.jobId, bucket);
    }

    const rebuilt = headers.map((h) => toDomain(h, visitsByJob.get(h.id) ?? []));
    if (!sort) {
      return buildPage(rebuilt, page, (job) => ({ createdAt: job.props.createdAt, id: job.props.id }));
    }
    // Sorted path builds its own cursor from the SORT column, not created_at. Read it off the raw
    // header row rather than the domain object so the value is exactly what the ORDER BY compared.
    const hasMore = rebuilt.length > page.limit;
    const items = hasMore ? rebuilt.slice(0, page.limit) : rebuilt;
    const last = selected ? selected[items.length - 1] : null;
    const nextCursor =
      hasMore && last ? encodeSortCursor({ value: last.sortValue, id: last.row.id }) : null;
    return { items, nextCursor };
  }
}
