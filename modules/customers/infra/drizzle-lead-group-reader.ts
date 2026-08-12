import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { LeadId, OrgId } from "@mallet/shared/types";
import { LEAD_GROUPS, leadGroupCondition, type LeadGroup } from "./lead-views";

/**
 * modules/customers/infra/drizzle-lead-group-reader.ts
 * Which work group each customer on a page is in.
 *
 * A READER, not a field on `Lead`. The group is derived from estimates, visits and invoices — it
 * is a fact about the customer's WORK, not about the customer — so putting it on the domain object
 * would make every caller that builds a Lead responsible for a question it cannot answer. The list
 * asks for it; nothing else has to know it exists.
 *
 * One query per page, keyed on the ids already fetched, so it costs a single indexed lookup rather
 * than an EXISTS-per-row over the whole book.
 */
export class DrizzleLeadGroupReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /** `leadId → group` for the ids given. Ids not in the map are simply absent, never guessed. */
  async forLeads(ids: readonly LeadId[]): Promise<Map<string, LeadGroup>> {
    if (ids.length === 0) return new Map();

    // ONE scan with a CASE, in the same priority order the conditions encode. A query per group
    // would be seven round trips whose answers could disagree with each other mid-edit.
    const arms = LEAD_GROUPS.map((g) => sql`when ${leadGroupCondition(g, this.tx)} then ${g}`);
    const rows = await this.tx
      .select({
        id: leads.id,
        group: sql<string>`case ${sql.join(arms, sql` `)} end`,
      })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), isNull(leads.deletedAt), inArray(leads.id, [...ids])));

    const out = new Map<string, LeadGroup>();
    for (const r of rows) {
      if (r.group && (LEAD_GROUPS as readonly string[]).includes(r.group)) {
        out.set(r.id, r.group as LeadGroup);
      }
    }
    return out;
  }
}
