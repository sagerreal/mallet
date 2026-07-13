import { and, desc, eq, isNull, or, gte, ne, sql } from "drizzle-orm";
import { quotingRules, pricebookItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  asQuotingRuleId,
  asOrgId,
  asUserId,
  asServiceId,
  asEstimateId,
  type OrgId,
  type QuotingRuleId,
} from "@mallet/shared/types";
import { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { matchRules, DEFAULT_RULE_MATCH_LIMIT, type RuleCandidate } from "../domain/rule-match";

type QuotingRuleRow = typeof quotingRules.$inferSelect;

// Per-org rule sets are tiny (tens, not thousands) — a flat cap beats cursor
// plumbing here. The prompt consumer re-caps at 20 after matching.
const LIST_CAP = 200;

const toDomain = (row: QuotingRuleRow): QuotingRule => {
  const result = QuotingRule.create({
    id: asQuotingRuleId(row.id),
    orgId: asOrgId(row.orgId),
    rule: row.rule,
    serviceId: row.serviceId ? asServiceId(row.serviceId) : null,
    jobTag: row.jobTag,
    // DB CHECKs constrain the value sets; create() re-validates and fails loud.
    status: row.status as QuotingRule["props"]["status"],
    source: row.source as QuotingRule["props"]["source"],
    authorUserId: row.authorUserId ? asUserId(row.authorUserId) : null,
    sourceEstimateId: row.sourceEstimateId ? asEstimateId(row.sourceEstimateId) : null,
    timesConfirmed: row.timesConfirmed,
    validFrom: row.validFrom,
    invalidatedAt: row.invalidatedAt,
    supersededBy: row.supersededBy ? asQuotingRuleId(row.supersededBy) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt quoting_rule ${row.id}: ${result.error.message}`);
  return result.value;
};

// Real persistence. Constructed with a tenant-scoped tx (withTenant set
// app.current_org_id), so RLS appends org_id = current_org_id() to every
// statement. orgId is used only to stamp written rows (defense-in-depth).
export class DrizzleQuotingRuleRepository implements QuotingRuleRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async save(rule: QuotingRule): Promise<void> {
    const p = rule.props;
    const columns = {
      rule: p.rule,
      serviceId: p.serviceId,
      jobTag: p.jobTag,
      status: p.status,
      source: p.source,
      authorUserId: p.authorUserId,
      sourceEstimateId: p.sourceEstimateId,
      timesConfirmed: p.timesConfirmed,
      validFrom: p.validFrom,
      invalidatedAt: p.invalidatedAt,
      supersededBy: p.supersededBy,
      updatedAt: p.updatedAt,
    };
    await this.tx
      .insert(quotingRules)
      .values({ id: p.id, orgId: this.orgId, createdAt: p.createdAt, ...columns })
      .onConflictDoUpdate({ target: quotingRules.id, set: columns });
  }

  async findById(id: QuotingRuleId): Promise<QuotingRule | null> {
    const rows = await this.tx.select().from(quotingRules).where(eq(quotingRules.id, id));
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async listConfirmed(): Promise<QuotingRule[]> {
    const rows = await this.tx
      .select()
      .from(quotingRules)
      .where(and(eq(quotingRules.status, "confirmed"), isNull(quotingRules.invalidatedAt)))
      .orderBy(desc(quotingRules.timesConfirmed), desc(quotingRules.createdAt))
      .limit(LIST_CAP);
    return rows.map(toDomain);
  }

  async listProposed(): Promise<QuotingRule[]> {
    const rows = await this.tx
      .select()
      .from(quotingRules)
      .where(
        and(
          eq(quotingRules.status, "proposed"),
          isNull(quotingRules.invalidatedAt),
          // Edit-delta proposals earn a human's attention only after ≥2
          // independent recurrences; human-authored proposals surface at once.
          or(
            ne(quotingRules.source, "edit_delta"),
            gte(quotingRules.timesConfirmed, sql`2`),
          ),
        ),
      )
      .orderBy(desc(quotingRules.timesConfirmed), desc(quotingRules.updatedAt))
      .limit(LIST_CAP);
    return rows.map(toDomain);
  }

  async findMatching(jobText: string, limit = DEFAULT_RULE_MATCH_LIMIT): Promise<RuleCandidate[]> {
    // One query with the scoped service's name joined in; the pure domain
    // matcher (rule-match.ts) does the keyword work — no ILIKE explosion.
    const rows = await this.tx
      .select({ rule: quotingRules, serviceName: pricebookItems.label })
      .from(quotingRules)
      .leftJoin(
        pricebookItems,
        and(eq(pricebookItems.orgId, quotingRules.orgId), eq(pricebookItems.id, quotingRules.serviceId)),
      )
      .where(and(eq(quotingRules.status, "confirmed"), isNull(quotingRules.invalidatedAt)))
      .orderBy(desc(quotingRules.timesConfirmed), desc(quotingRules.createdAt))
      .limit(LIST_CAP);
    const candidates: RuleCandidate[] = rows.map((r) => ({
      rule: toDomain(r.rule),
      serviceName: r.serviceName,
    }));
    return matchRules(jobText, candidates, limit);
  }

  async listProposedEditDeltasByTag(jobTag: string): Promise<QuotingRule[]> {
    const rows = await this.tx
      .select()
      .from(quotingRules)
      .where(
        and(
          eq(quotingRules.status, "proposed"),
          eq(quotingRules.source, "edit_delta"),
          eq(quotingRules.jobTag, jobTag),
          isNull(quotingRules.invalidatedAt),
        ),
      )
      .limit(LIST_CAP);
    return rows.map(toDomain);
  }
}
