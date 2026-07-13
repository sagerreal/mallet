import { toPage, type OrgId, type LeadId, asLeadId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleLeadRepository } from "@mallet/customers";
import { ListThreadUseCase, DrizzleMessageRepository } from "@mallet/messaging";
import { DrizzleJobRepository } from "@mallet/jobs";
import { DrizzleEstimateRepository, DrizzleQuotingRuleRepository } from "@mallet/quoting";
import {
  matchWonQuotes,
  RULES_BLOCK_MAX_RULES,
  type EstimateContext,
  type JobInfoContext,
  type LaborRateContext,
  type ShopRuleContext,
  type WonQuoteExemplar,
} from "../app/estimate-context";
import { fetchCatalogContext } from "./catalog-context";

// ---------------------------------------------------------------------------
// DB composition for the estimate-draft context. Router-layer cross-module
// reads through each module's exported repos/use-cases (the accepted pattern —
// mirrors how catalog-context.ts composes the pricebook module). Runs inside
// the caller's short-lived withTenant tx, closed BEFORE the LLM round-trip.
// ---------------------------------------------------------------------------

const THREAD_MESSAGE_LIMIT = 10;
const VISIT_NOTES_LIMIT = 5;
const WON_QUOTE_CANDIDATES = 25;

/** Lead + last texts + field notes for the job-info block. Null lead → null. */
export const fetchJobInfoContext = async (
  tx: TenantTx,
  orgId: OrgId,
  leadId: LeadId,
): Promise<JobInfoContext | null> => {
  const leadRepo = new DrizzleLeadRepository(tx, orgId);
  const lead = await leadRepo.findById(leadId);
  if (!lead) return null;

  const thread = await new ListThreadUseCase(new DrizzleMessageRepository(tx, orgId)).exec({
    leadId,
    limit: 200,
  });
  // Thread is oldest-first; keep the newest N in chronological order.
  const messages = thread.slice(-THREAD_MESSAGE_LIMIT).map((m) => ({
    direction: m.props.direction,
    body: m.props.body,
  }));

  // Field findings: job + visit notes from this lead's jobs, newest jobs first.
  const jobsPage = await new DrizzleJobRepository(tx, orgId).listByLead(
    leadId,
    toPage({ limit: 10 }),
  );
  const visitNotes: string[] = [];
  for (const job of jobsPage.items) {
    if (job.props.notes?.trim()) visitNotes.push(job.props.notes);
    for (const visit of job.props.visits) {
      if (visit.props.notes?.trim()) visitNotes.push(visit.props.notes);
    }
  }

  return {
    lead: {
      name: lead.props.name,
      source: lead.props.source,
      notes: lead.props.notes,
      address: lead.props.address,
    },
    messages,
    visitNotes: visitNotes.slice(0, VISIT_NOTES_LIMIT),
  };
};

const fetchLaborRates = async (tx: TenantTx, orgId: OrgId): Promise<LaborRateContext[]> => {
  const rates = await new DrizzleSettingsRepository(tx, orgId).listLaborRates();
  return rates.map((r) => ({
    label: r.label,
    rateCentsPerHour: r.rateCentsPerHour,
    kind: r.kind,
  }));
};

/** Recent ACCEPTED quotes as exemplar candidates, newest-first, lexically matched. */
const fetchWonQuotes = async (
  tx: TenantTx,
  orgId: OrgId,
  description: string,
): Promise<WonQuoteExemplar[]> => {
  const repo = new DrizzleEstimateRepository(tx, orgId);
  const page = await repo.list(toPage({ limit: WON_QUOTE_CANDIDATES }), { status: "accepted" });
  const candidates: WonQuoteExemplar[] = page.items.map((e) => ({
    num: e.props.num,
    title: e.props.title,
    lines: e.props.lines
      .filter((l) => !l.props.isOptional)
      .map((l) => ({
        description: l.props.description,
        quantity: l.props.quantity,
        rateCents: l.props.rate,
      })),
    totalCents: e.total(),
  }));
  return matchWonQuotes(description, candidates);
};

/** Confirmed shop rules that apply to this job (quoting_rules via @mallet/quoting's seam). */
const fetchShopRules = async (
  tx: TenantTx,
  orgId: OrgId,
  description: string,
): Promise<ShopRuleContext[]> => {
  const matched = await new DrizzleQuotingRuleRepository(tx, orgId).findMatching(
    description,
    RULES_BLOCK_MAX_RULES,
  );
  return matched.map((m) => ({
    rule: m.rule.props.rule,
    timesConfirmed: m.rule.props.timesConfirmed,
  }));
};

/**
 * The full context for one draft run: pricebook + labor rates always; job info
 * when a lead is given; won-quote exemplars and confirmed shop rules matched
 * to the description.
 */
export const fetchEstimateContext = async (
  tx: TenantTx,
  orgId: OrgId,
  description: string,
  leadId?: string,
): Promise<EstimateContext> => {
  const [catalog, laborRates, wonQuotes, rules, jobInfo] = await Promise.all([
    fetchCatalogContext(tx, orgId),
    fetchLaborRates(tx, orgId),
    fetchWonQuotes(tx, orgId, description),
    fetchShopRules(tx, orgId, description),
    leadId ? fetchJobInfoContext(tx, orgId, asLeadId(leadId)) : Promise.resolve(null),
  ]);
  return { catalog, laborRates, jobInfo, wonQuotes, rules };
};
