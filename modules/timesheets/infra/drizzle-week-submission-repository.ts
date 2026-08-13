import { and, eq } from "drizzle-orm";
import { timesheetSubmissions } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asOrgId, asUserId, type OrgId, type UserId } from "@mallet/shared/types";
import { WeekSubmission } from "../domain/week-submission";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";

type SubmissionRow = typeof timesheetSubmissions.$inferSelect;

// Corrupt data throws rather than silently coercing — same stance as the time-entry mapper.
const toDomain = (row: SubmissionRow): WeekSubmission => {
  const result = WeekSubmission.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    techUserId: asUserId(row.techUserId),
    weekStart: row.weekStart,
    submittedAt: row.submittedAt,
    reopenedAt: row.reopenedAt ?? null,
    reopenReason: row.reopenReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt timesheet_submission ${row.id}: ${result.error.message}`);
  return result.value;
};

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already sets
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and as defense-in-depth on every statement.
export class DrizzleWeekSubmissionRepository implements WeekSubmissionRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async findFor(techUserId: UserId, weekStart: string): Promise<WeekSubmission | null> {
    const rows = await this.tx
      .select()
      .from(timesheetSubmissions)
      .where(
        and(
          eq(timesheetSubmissions.orgId, this.orgId),
          eq(timesheetSubmissions.techUserId, techUserId),
          eq(timesheetSubmissions.weekStart, weekStart),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async claim(input: {
    id: string;
    orgId: string;
    techUserId: string;
    weekStart: string;
    submittedAt: Date;
  }): Promise<{ submission: WeekSubmission; created: boolean }> {
    // Claim-first on the unique (org, tech, week): the row either inserts or already exists —
    // a replayed submit can never mint a second attestation.
    const inserted = await this.tx
      .insert(timesheetSubmissions)
      .values({
        id: input.id,
        orgId: this.orgId,
        techUserId: input.techUserId,
        weekStart: input.weekStart,
        submittedAt: input.submittedAt,
      })
      .onConflictDoNothing({
        target: [
          timesheetSubmissions.orgId,
          timesheetSubmissions.techUserId,
          timesheetSubmissions.weekStart,
        ],
      })
      .returning();

    const row = inserted[0];
    if (row) return { submission: toDomain(row), created: true };

    const existing = await this.findFor(asUserId(input.techUserId), input.weekStart);
    if (!existing) {
      // The insert conflicted yet the row is invisible — only corruption or a cross-org
      // collision could produce this, and both deserve a loud stop.
      throw new Error(
        `timesheet_submission claim conflicted but no row found for tech ${input.techUserId} week ${input.weekStart}`,
      );
    }
    return { submission: existing, created: false };
  }

  async save(submission: WeekSubmission): Promise<void> {
    const p = submission.props;
    await this.tx
      .update(timesheetSubmissions)
      .set({
        submittedAt: p.submittedAt,
        reopenedAt: p.reopenedAt,
        reopenReason: p.reopenReason,
        updatedAt: p.updatedAt,
      })
      .where(
        and(eq(timesheetSubmissions.orgId, this.orgId), eq(timesheetSubmissions.id, p.id)),
      );
  }
}
