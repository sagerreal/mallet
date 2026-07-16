import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { jobs, jobVisits, jobLines, jobAddons, jobVerifyAnswers, jobPhotos } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
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
import type { Job } from "../domain/job";
import type { JobRepository, JobFilter, JobExecution, CallbackScanRow, AutopsyPairRow } from "../domain/job-repository";
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "../domain/job-execution";
import { toDomain, type JobVisitRow } from "./job-mapper";
import { lineToDomain, addonToDomain, verifyToDomain, photoToDomain, type JobLineRow, type JobAddonRow, type JobVerifyAnswerRow, type JobPhotoRow } from "./job-execution-mapper";

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
      notes: p.notes,
      scope: p.scope,
      callbackOf: p.callbackOf,
      callbackReason: p.callbackReason,
      svc: p.svc,
      kind: p.kind,
      // Deep-copy out of the immutable domain props into a plain mutable JSON blob.
      checklist: p.checklist
        ? { name: p.checklist.name, items: p.checklist.items.map((it) => ({ ...it })) }
        : null,
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
      .where(and(eq(jobs.id, id), isNull(jobs.deletedAt)));
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

  list(page: CursorPage, filter?: JobFilter): Promise<Paginated<Job>> {
    const conds: SQL[] = [isNull(jobs.deletedAt)];
    if (filter?.status) conds.push(eq(jobs.status, filter.status));
    if (filter?.assigneeUserId) conds.push(eq(jobs.assigneeUserId, filter.assigneeUserId));
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
    return this.loadPage(conds, page);
  }

  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.loadPage([isNull(jobs.deletedAt), eq(jobs.leadId, leadId)], page);
  }

  // ── job execution data (Phase 5) ─────────────────────────────────────────

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
      this.tx
        .select()
        .from(jobAddons)
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
      addons: (addonRows as JobAddonRow[]).map(addonToDomain),
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
      this.tx
        .select()
        .from(jobAddons)
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
    for (const row of addonRows as JobAddonRow[]) byJob.get(row.jobId)?.addons.push(addonToDomain(row));
    for (const row of answerRows as JobVerifyAnswerRow[]) {
      byJob.get(row.jobId)?.verifyAnswers.push(verifyToDomain(row));
    }
    for (const row of photoRows as JobPhotoRow[]) byJob.get(row.jobId)?.photos.push(photoToDomain(row));
    return byJob;
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
      position: p.position,
      createdAt: now,
      updatedAt: now,
    });
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
        position: p.position,
        updatedAt: now,
      })
      .where(and(eq(jobLines.id, p.id), eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt)))
      .returning({ id: jobLines.id });
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
    return rows.length;
  }

  // Bulk-replace the job's lines. Soft-deletes every current (non-deleted) line for the job,
  // then inserts the new set. Both statements run in the same tenant tx; the ownerOrOffice
  // orgTx re-throw guard rolls the whole swap back on any failure. org-scoped by both the
  // implicit RLS tx and the explicit eq(orgId) filter (defense-in-depth + index use).
  async replaceLines(jobId: JobId, lines: readonly JobLine[], now: Date): Promise<void> {
    await this.tx
      .update(jobLines)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(jobLines.jobId, jobId), eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt)));
    if (lines.length === 0) return;
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
          position: p.position,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
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
          checklist: (r.checklist ?? null) as import("../domain/job").JobChecklistProps | null,
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
      .where(and(isNull(jobs.deletedAt), gte(jobs.createdAt, since), eq(jobs.orgId, this.orgId)));
    return rows.map((r) => ({
      ...r,
      id: asJobId(r.id),
      callbackOf: r.callbackOf ? asJobId(r.callbackOf) : null,
    }));
  }

  private async loadPage(baseConds: SQL[], page: CursorPage): Promise<Paginated<Job>> {
    const conds = [...baseConds];
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(keysetBefore(jobs.createdAt, jobs.id, cursor.value));
      }
    }

    // Paginate job headers first, then batch-load their visits in one query (no N+1).
    const headers = await this.tx
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
    return buildPage(rebuilt, page, (job) => ({
      createdAt: job.props.createdAt,
      id: job.props.id,
    }));
  }
}
