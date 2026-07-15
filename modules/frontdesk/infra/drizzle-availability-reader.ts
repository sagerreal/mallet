import { sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asUserId, type OrgId, type UserId } from "@mallet/shared/types";
import type {
  AvailabilityReader,
  AvailabilitySnapshot,
  CrewDaySchedule,
} from "../domain/availability";
import type { BookedVisit } from "../app/slots";
import type { CrewLoad } from "../app/dispatch";

// Only these visit statuses consume capacity — a canceled visit frees its slot again, and a
// completed visit in the future can't exist, but excluding it is defense-in-depth.
const ACTIVE_VISIT_STATUSES = ["pending", "in_progress"] as const;

// Postgres `time` reads back as "HH:MM:SS"; the app's canonical is "HH:MM" — normalize here at the
// read boundary (same rule as job-mapper's toHHMM). null start stays null (unplaced-time visit).
const toHHMM = (t: string | null): string | null => (t ? t.slice(0, 5) : null);

// Raw shape of one booked-visit row. `type` (not interface) to satisfy execute<T>'s Record bound.
type VisitRaw = {
  scheduledDate: string | null;
  scheduledStart: string | null;
  durationMinutes: number | null;
};

// Raw shape of one crew_schedules row. `type` to satisfy execute<T>'s Record bound.
type CrewScheduleRaw = {
  userId: string;
  weekday: number;
  openHour: number;
  closeHour: number;
};

// Raw shape of one same-day active visit row for proximity dispatch. `type` to satisfy execute<T>'s
// Record bound. assigneeUserId is the crew member assigned to the visit; lat/lng are null when the
// visit was created without a geocoded address.
type SameDayVisitRaw = {
  assigneeUserId: string;
  lat: number | null;
  lng: number | null;
};

/**
 * AvailabilityReader adapter over the jobs schedule. Two org-scoped queries (no N+1):
 *   1. booked visits whose scheduled_date is in the requested range (active statuses only), and
 *   2. the org's field-crew headcount (users.is_field_crew).
 * The pure computeSlots turns this snapshot into offerable windows.
 *
 * Constructed with a tenant-scoped tx (withTenant already set app.current_org_id); RLS scopes every
 * statement and the explicit org_id predicates add defense-in-depth + make the tenant boundary
 * visible in the SQL (same pattern as DrizzleLeadSummaryReader).
 */
export class DrizzleAvailabilityReader implements AvailabilityReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async read(range: { fromDate: string; toDate: string }): Promise<AvailabilitySnapshot> {
    const [visits, crewCount] = await Promise.all([
      this.readVisits(range),
      this.readCrewCount(),
    ]);
    return { crewCount, visits };
  }

  // Booked visits with a placed date inside [fromDate, toDate], active statuses only, org-scoped and
  // soft-delete filtered. A null-time visit is included (it still consumes morning capacity — see
  // computeSlots' null-start rule).
  private async readVisits(range: { fromDate: string; toDate: string }): Promise<BookedVisit[]> {
    const statusList = sql.join(
      ACTIVE_VISIT_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    const rows = await this.tx.execute<VisitRaw>(sql`
      SELECT
        v.scheduled_date    AS "scheduledDate",
        v.scheduled_start   AS "scheduledStart",
        v.duration_minutes  AS "durationMinutes"
      FROM job_visits v
      WHERE v.org_id = ${this.orgId}
        AND v.deleted_at IS NULL
        AND v.scheduled_date IS NOT NULL
        AND v.scheduled_date BETWEEN ${range.fromDate} AND ${range.toDate}
        AND v.status IN (${statusList})
    `);
    return rows.filter((r) => r.scheduledDate !== null).map(toBookedVisit);
  }

  // Field-crew headcount: members flagged is_field_crew, org-scoped. This is the parallelism the
  // slot math divides capacity by — each field-crew member can run one visit per window.
  private async readCrewCount(): Promise<number> {
    const rows = await this.tx.execute<{ count: number }>(sql`
      SELECT count(*)::int AS "count"
      FROM users u
      WHERE u.org_id = ${this.orgId}
        AND u.is_field_crew = true
    `);
    return Number(rows[0]?.count ?? 0);
  }

  // Field-crew user ids in a STABLE order (created_at, then id as a tiebreaker), org-scoped. Used by
  // book_visit to assign a voice booking to the first field crew so it lands on the board. One
  // org-scoped query (no N+1); empty when the org has no field crew.
  async readFieldCrewIds(): Promise<UserId[]> {
    const rows = await this.tx.execute<{ id: string }>(sql`
      SELECT u.id AS "id"
      FROM users u
      WHERE u.org_id = ${this.orgId}
        AND u.is_field_crew = true
      ORDER BY u.created_at ASC, u.id ASC
    `);
    return rows.map((r) => asUserId(r.id));
  }

  // Every crew_schedules row for the org's FIELD crew, org-scoped. One join query (no N+1): the
  // join to users restricts to is_field_crew so a schedule left behind by a role change never leaks
  // into the slot math. The raw override rows are returned as-is — a weekday with no row is simply
  // absent; the slot math (Task 2.2) applies the org-hours FALLBACK for those, not this reader.
  // Ordered (user_id, weekday) for a deterministic, testable result.
  async readCrewSchedules(): Promise<CrewDaySchedule[]> {
    const rows = await this.tx.execute<CrewScheduleRaw>(sql`
      SELECT
        cs.user_id     AS "userId",
        cs.weekday     AS "weekday",
        cs.open_hour   AS "openHour",
        cs.close_hour  AS "closeHour"
      FROM crew_schedules cs
      JOIN users u ON u.org_id = cs.org_id AND u.id = cs.user_id
      WHERE cs.org_id = ${this.orgId}
        AND u.is_field_crew = true
      ORDER BY cs.user_id ASC, cs.weekday ASC
    `);
    return rows.map(toCrewDaySchedule);
  }

  // All field-crew members with their active same-day visits (and any geocoded points) on `date`.
  // Two org-scoped queries (no N+1): one for field-crew ids (reusing the is_field_crew predicate),
  // one for active same-day visits with assignee + point. Every field crew must appear in the result
  // (idle crew → empty sameDayJobs) so chooseCrew can select them — a crew absent from the list
  // could never be assigned. Org-scoped via RLS + explicit org_id predicates.
  async readSameDayCrewLoads(date: string): Promise<CrewLoad[]> {
    const statusList = sql.join(
      ACTIVE_VISIT_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );

    const [crewRows, visitRows] = await Promise.all([
      this.tx.execute<{ id: string }>(sql`
        SELECT u.id AS "id"
        FROM users u
        WHERE u.org_id = ${this.orgId}
          AND u.is_field_crew = true
        ORDER BY u.created_at ASC, u.id ASC
      `),
      this.tx.execute<SameDayVisitRaw>(sql`
        SELECT
          v.assignee_user_id  AS "assigneeUserId",
          v.lat               AS "lat",
          v.lng               AS "lng"
        FROM job_visits v
        WHERE v.org_id = ${this.orgId}
          AND v.deleted_at IS NULL
          AND v.scheduled_date = ${date}
          AND v.status IN (${statusList})
          AND v.assignee_user_id IS NOT NULL
      `),
    ]);

    return buildCrewLoads(crewRows.map((r) => asUserId(r.id)), visitRows);
  }
}

// Map a raw crew_schedules row to the pure CrewDaySchedule DTO. weekday/hours are already integers
// from Postgres; Number() guards against a string coming back from the driver's numeric handling.
const toCrewDaySchedule = (r: CrewScheduleRaw): CrewDaySchedule => ({
  userId: asUserId(r.userId),
  weekday: Number(r.weekday),
  openHour: Number(r.openHour),
  closeHour: Number(r.closeHour),
});

// Map a raw visit row to the pure BookedVisit DTO. A null duration falls back to 0 (the slot math
// buckets by window, not by elapsed minutes, so the exact duration only matters for future overlap
// refinements — a null is safe today).
const toBookedVisit = (r: VisitRaw): BookedVisit => ({
  date: r.scheduledDate as string,
  startHHMM: toHHMM(r.scheduledStart),
  durationMinutes: r.durationMinutes ?? 0,
});

// Build one CrewLoad per field-crew id from the two flat query results. Every field crew id appears
// exactly once (idle crew → sameDayJobs: []). A visit row is attributed to its assignee only when
// that assignee is a known field-crew id (defense-in-depth: non-crew assignees are dropped).
// The point is non-null only when BOTH lat and lng are present — a visit with one null coordinate
// cannot be used as a proximity anchor and its point is treated as null.
const buildCrewLoads = (crewIds: readonly UserId[], visits: readonly SameDayVisitRaw[]): CrewLoad[] => {
  const visitsByUser = new Map<UserId, { readonly point: { lat: number; lng: number } | null }[]>();
  for (const id of crewIds) {
    visitsByUser.set(id, []);
  }
  for (const v of visits) {
    const userId = v.assigneeUserId as UserId;
    const bucket = visitsByUser.get(userId);
    if (bucket === undefined) continue; // non-field-crew assignee — skip
    const point = v.lat !== null && v.lng !== null ? { lat: v.lat, lng: v.lng } : null;
    bucket.push({ point });
  }
  return crewIds.map((userId) => ({
    userId,
    sameDayJobs: visitsByUser.get(userId) ?? [],
  }));
};
