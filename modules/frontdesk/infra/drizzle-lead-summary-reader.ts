import { sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, LeadId } from "@mallet/shared/types";
import type { LeadSummaryReader } from "../domain/assistant";
import { formatOpenWork, type OpenWorkRow } from "./lead-open-work";

// The active statuses whose most-recent job becomes the caller's "open work". Canceled/complete
// jobs are excluded — the caller-context line should reflect work still on the books.
const ACTIVE_STATUSES = ["scheduled", "in_progress"] as const;

// Shape of the single-row result. leadName is null only when the lead does not exist (org miss).
// A `type` (not `interface`) so it satisfies the Record<string, unknown> constraint on execute<T>.
type SummaryRaw = {
  leadName: string | null;
  jobNum: string | null;
  jobStatus: string | null;
  scheduledStart: Date | null;
  jobLabel: string | null;
};

/**
 * LeadSummaryReader adapter: ONE query joining the lead's name to its single most-recent active
 * job (LEFT JOIN LATERAL … LIMIT 1), org-scoped. No N+1 — a lead with many jobs still costs one
 * round trip, keeping the caller-recognition step inside Vapi's 7.5s budget.
 *
 * Constructed with a tenant-scoped tx (RLS set); the explicit org_id predicates add
 * defense-in-depth and make the tenant boundary visible in the SQL (same pattern as the
 * messaging conversation reader).
 */
export class DrizzleLeadSummaryReader implements LeadSummaryReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async summarize(leadId: LeadId): Promise<{ name: string; openWork: string | null } | null> {
    const statusList = sql.join(
      ACTIVE_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );

    const rows = await this.tx.execute<SummaryRaw>(sql`
      SELECT
        l.name              AS "leadName",
        j.num               AS "jobNum",
        j.status            AS "jobStatus",
        j.scheduled_start   AS "scheduledStart",
        COALESCE(NULLIF(btrim(j.title), ''), NULLIF(btrim(j.svc), '')) AS "jobLabel"
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT jb.num, jb.status, jb.scheduled_start, jb.title, jb.svc
        FROM jobs jb
        WHERE jb.lead_id = l.id
          AND jb.org_id = ${this.orgId}
          AND jb.deleted_at IS NULL
          AND jb.status IN (${statusList})
        ORDER BY jb.scheduled_start DESC NULLS LAST, jb.created_at DESC
        LIMIT 1
      ) j ON TRUE
      WHERE l.id = ${leadId}
        AND l.org_id = ${this.orgId}
        AND l.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows[0];
    if (!row || row.leadName === null) return null;

    const openWorkRow: OpenWorkRow = {
      jobNum: row.jobNum,
      jobStatus: row.jobStatus,
      scheduledStart:
        row.scheduledStart === null
          ? null
          : row.scheduledStart instanceof Date
            ? row.scheduledStart
            : new Date(row.scheduledStart),
      jobLabel: row.jobLabel,
    };

    return { name: row.leadName, openWork: formatOpenWork(openWorkRow) };
  }
}
