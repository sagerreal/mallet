/**
 * features/home/pipe.ts
 * "The Pipe" — the shop's money flowing through YOUR process, left to right:
 * New → Quoted → Needs a slot → Out today → To bill → Owed. Each stage's figure
 * derives from the SAME store rows the destination page shows (the numbers can't
 * be the untrustworthy kind), and each stage is a door into that page. Amber
 * marks the leak stages (a lead not reached, a quote going cold, won work with
 * no slot, done work not billed); overdue is red. Pure — composes existing
 * derivations, invents no new money math.
 */

import type { Estimate, Invoice, Job, Lead, Tech } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { deriveRail, type Rail } from "@/features/quotes/derive";
import { deriveJobBands, deriveOnTrucks, todayVisit } from "@/features/jobs/today-derive";
import { jobCrewTech } from "@/features/jobs/job-row";
import { deriveMoneyRows } from "@/features/money/money-derive";
import { firstName } from "./derive";

/** A quote is "going cold" once the customer has been silent this many business days. */
const QUOTE_COLD_DAYS = 2;

export interface PipeStage {
  key: string;
  label: string;
  value: string;
  /** One quiet context line, ≤6 words. */
  sub: string;
  /** A red fragment prepended to the sub (overdue) — rationed to real urgency. */
  red: string | null;
  /** Amber emphasis: a money leak the owner should clear here. */
  leak: boolean;
  href: string;
}

export interface PipeInput {
  leads: Lead[];
  estimates: Estimate[];
  invoices: Invoice[];
  jobs: Job[];
  techs: Tech[];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Closed stages leave the top of the funnel — a New lead is neither. */
const CLOSED_STAGES = new Set(["Won", "Lost"]);

/**
 * NEW — the true top of the funnel: a live customer you HAVEN'T quoted and have
 * NO job for yet. Defined by facts (no quote out, no job), not the manual stage
 * label, so a contacted-but-unquoted lead can't fall into a gap between cells.
 * Leak = how many haven't been replied to at all.
 */
function newStage(leads: Lead[], rail: Rail, jobs: Job[]): PipeStage {
  const quotedLeadIds = new Set(rail.out.map((r) => r.est.leadId));
  const hasJob = (id: string) => jobs.some((j) => !j.archived && j.leadId === id);
  const newLeads = leads.filter(
    (l) => !l.archived && !CLOSED_STAGES.has(l.stage) && !quotedLeadIds.has(l.id) && !hasJob(l.id)
  );
  const unreached = newLeads.filter((l) => (l.acts ?? []).length === 0).length;
  return {
    key: "new",
    label: "New",
    value: String(newLeads.length),
    sub: unreached > 0 ? `${unreached} not reached yet` : newLeads.length ? "all reached" : "none waiting",
    red: null,
    leak: unreached > 0,
    href: "/customers",
  };
}

/** QUOTED — dollars sitting on customers' phones; leak = going cold. */
function quotedStage(rail: Rail): PipeStage {
  const cold = rail.out.filter((r) => r.quietDays >= QUOTE_COLD_DAYS).length;
  return {
    key: "quoted",
    label: "Quoted",
    value: fmt$(rail.outSum),
    sub: `${rail.out.length} out${cold > 0 ? ` · ${cold} going cold` : ""}`,
    red: null,
    leak: cold > 0,
    href: "/pipeline",
  };
}

/** NEEDS A SLOT + ON THE TRUCKS — from the job lifecycle bands. */
function jobStages(jobs: Job[], invoices: Invoice[], techs: Tech[]): PipeStage[] {
  const bands = deriveJobBands(jobs, invoices);
  const slotBand = bands.find((b) => b.key === "needsSlot");
  const todayBand = bands.find((b) => b.key === "today");
  const slotCount = slotBand?.count ?? 0;
  const todayCount = todayBand?.count ?? 0;
  const onsiteJob = (todayBand?.jobs ?? []).find((j) => todayVisit(j)?.status === "onsite");
  const onsiteCrew = onsiteJob ? jobCrewTech("today", onsiteJob, techs) : null;
  return [
    {
      key: "needsSlot",
      label: "Needs a slot",
      value: fmt$(slotBand?.sum ?? 0),
      sub: `${slotCount} won ${plural(slotCount, "job", "jobs")} unscheduled`,
      red: null,
      leak: slotCount > 0,
      href: "/jobs?tab=schedule",
    },
    {
      key: "trucks",
      label: "Out today",
      value: fmt$(deriveOnTrucks(jobs)),
      sub: onsiteCrew ? `${todayCount} today · ${firstName(onsiteCrew.name)} on site` : `${todayCount} today`,
      red: null,
      leak: false,
      href: "/jobs",
    },
  ];
}

/** TO BILL + OWED — one pass over the Money ledger rows. The pipe ends at OWED:
 *  it shows money still in motion, so already-collected isn't a stage here. */
function moneyStages(invoices: Invoice[], jobs: Job[], leads: Lead[]): PipeStage[] {
  const rows = deriveMoneyRows(invoices, jobs, leads);
  const ready = rows.filter((r) => r.statusKey === "ready");
  const open = rows.filter((r) => r.kind === "invoice" && r.statusKey !== "draft" && r.due > 0);
  const overSum = open.filter((r) => r.statusKey === "over").reduce((s, r) => s + r.due, 0);
  return [
    {
      key: "toBill",
      label: "To bill",
      value: fmt$(ready.reduce((s, r) => s + r.due, 0)),
      sub: `${ready.length} done, no invoice`,
      red: null,
      leak: ready.length > 0,
      href: "/money",
    },
    {
      key: "owed",
      label: "Owed",
      value: fmt$(open.reduce((s, r) => s + r.due, 0)),
      sub: `${open.length} open`,
      red: overSum > 0 ? `${fmt$(overSum)} overdue` : null,
      leak: false,
      href: "/money",
    },
  ];
}

export function deriveHomePipe({ leads, estimates, invoices, jobs, techs }: PipeInput): PipeStage[] {
  // Compute the quote rail once — both New (to exclude quoted leads) and Quoted use it.
  const rail = deriveRail(estimates, leads, jobs);
  return [
    newStage(leads, rail, jobs),
    quotedStage(rail),
    ...jobStages(jobs, invoices, techs),
    ...moneyStages(invoices, jobs, leads),
  ];
}
