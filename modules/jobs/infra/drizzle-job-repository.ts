import { and, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { jobs, jobVisits } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type JobId,
  type LeadId,
  type EstimateId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Job } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import { toDomain, type JobVisitRow } from "./job-mapper";

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
    return inserted.length > 0;
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
    return this.loadPage(conds, page);
  }

  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.loadPage([isNull(jobs.deletedAt), eq(jobs.leadId, leadId)], page);
  }

  private async loadPage(baseConds: SQL[], page: CursorPage): Promise<Paginated<Job>> {
    const conds = [...baseConds];
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(
          sql`(${jobs.createdAt}, ${jobs.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
        );
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
