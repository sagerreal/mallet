/**
 * features/home/derive.ts
 * Pure derivations for the Handoff home screen. Everything here is a function of
 * raw store arrays — narration NEVER invents a fact: every sentence traces to a
 * record (an overnight act, a booked job, a sent quote, an open invoice), and
 * every receipt opens the record it describes.
 */

import { TODAY_ISO } from "@/lib/prototype-sample";
import { estTotal, invDue } from "@/lib/estimates";
import type { Lead, Estimate, Invoice, Job, Tech, Visit } from "@/lib/store/types";

// ---- small shared helpers ----------------------------------------------------

export function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/** "8:00 AM" from a decimal hour. */
export function timeLabel(start: number): string {
  const h = Math.floor(start);
  const m = Math.round((start - h) * 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Thu 8:00 AM" for a visit. */
export function visitLabel(v: Visit): string {
  if (!v.date || v.start == null) return "unscheduled";
  const d = new Date(v.date + "T12:00:00");
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${timeLabel(v.start)}`;
}

// ---- the overnight shift report -----------------------------------------------

export interface Receipt {
  key: string;
  leadId: number;
  /** What the Front Desk did, past tense, with the record to prove it. */
  text: string;
  /** Where the proof lives. */
  open: { kind: "thread" | "estimate"; id: number };
  openLabel: string;
}

export interface ShiftReport {
  /** Overnight inbound calls the Front Desk answered. */
  callsAnswered: number;
  /** A job it booked overnight, if any. */
  booked: { lead: Lead; job: Job; value: number; when: string } | null;
  receipts: Receipt[];
  /** True when the night produced anything at all. */
  busy: boolean;
}

export function deriveShiftReport(leads: Lead[], jobs: Job[], estimates: Estimate[]): ShiftReport {
  const overnightLeads = leads.filter(
    (l) => !l.archived && (l.acts ?? []).some((a) => a.overnight)
  );

  const callsAnswered = overnightLeads.filter((l) =>
    (l.acts ?? []).some((a) => a.overnight && a.type === "call")
  ).length;

  // A Front-Desk-booked job: origin 'frontdesk' on a lead that has overnight acts.
  let booked: ShiftReport["booked"] = null;
  for (const l of overnightLeads) {
    const job = jobs.find((j) => !j.archived && j.leadId === l.id && j.origin === "frontdesk");
    if (job) {
      const v = (job.visits ?? []).find((x) => x.date && x.start != null);
      booked = { lead: l, job, value: jobTotal(job), when: v ? visitLabel(v) : "unscheduled" };
      break;
    }
  }

  const receipts: Receipt[] = [];
  for (const l of overnightLeads) {
    const acts = (l.acts ?? []).filter((a) => a.overnight);
    const isBooked = booked?.lead.id === l.id;
    if (isBooked && booked) {
      receipts.push({
        key: `booked-${l.id}`,
        leadId: l.id,
        text: `Booked ${l.name} — ${l.job.toLowerCase()}, ${booked.when}`,
        open: { kind: "thread", id: l.id },
        openLabel: "transcript",
      });
      continue;
    }
    const call = acts.find((a) => a.type === "call");
    if (call) {
      receipts.push({
        key: `call-${l.id}`,
        leadId: l.id,
        text: `Answered ${l.name}'s call — took the details, texted the booking link`,
        open: { kind: "thread", id: l.id },
        openLabel: "thread",
      });
      continue;
    }
    // NOTE: overnight 'ai' observation notes (e.g. "Maria opened the quote") are
    // deliberately NOT receipts — an observation isn't a handled action; it powers
    // the Needs-your-OK card's timing instead.
  }

  return { callsAnswered, booked, receipts, busy: receipts.length > 0 || callsAnswered > 0 };
}

// ---- the Needs-your-OK queue ---------------------------------------------------

export type OkKind = "quote-viewed" | "invoice-overdue" | "reply" | "new-lead";

export interface OkItem {
  key: string;
  kind: OkKind;
  lead: Lead;
  estimate?: Estimate;
  invoice?: Invoice;
  /** Dollars at stake — the queue is ranked by this. */
  value: number;
  /** One-line situation ("read her $2,890 quote at 9:12pm"). */
  situation: string;
  /** Label for the middle (edit) action. */
  editLabel: string;
}

const QUEUE_CAP = 5;
const OVERDUE_AGE = 7;

export function deriveOkQueue(
  leads: Lead[],
  estimates: Estimate[],
  invoices: Invoice[],
  dismissed: string[]
): OkItem[] {
  const out: OkItem[] = [];
  const leadOf = (id: number) => leads.find((l) => l.id === id && !l.archived);

  // Viewed, still-open quotes — strike while it's warm.
  for (const e of estimates) {
    if (e.archived || e.trash || e.status !== "sent" || !e.viewed) continue;
    const lead = leadOf(e.leadId);
    if (!lead) continue;
    // The overnight act carries the human detail ("at 9:12pm") — but ONLY an act
    // that actually records an open; never borrow an unrelated act's time.
    const viewAct = (lead.acts ?? []).find(
      (a) => a.overnight && a.type === "ai" && (a.t ?? "").toLowerCase().includes("opened")
    );
    const when = viewAct ? ` at ${viewAct.when}` : ` — ${e.age}d since it went out`;
    out.push({
      key: `okq-${e.id}`,
      kind: "quote-viewed",
      lead,
      estimate: e,
      value: estTotal(e),
      situation: `read the $${Math.round(estTotal(e)).toLocaleString("en-US")} quote${when}`,
      editLabel: "Change",
    });
  }

  // Overdue invoices — firm reminder drafted.
  for (const i of invoices) {
    if (i.archived || !(i.status === "sent" || i.status === "partial")) continue;
    const due = invDue(i);
    if (due <= 0 || i.age < OVERDUE_AGE) continue;
    const lead = leadOf(i.leadId);
    if (!lead) continue;
    out.push({
      key: `oki-${i.id}`,
      kind: "invoice-overdue",
      lead,
      invoice: i,
      value: due,
      situation: `owes $${Math.round(due).toLocaleString("en-US")} · ${i.num} · ${i.age} days`,
      editLabel: "Soften it",
    });
  }

  // Unanswered replies — acknowledgment drafted.
  for (const l of leads) {
    if (l.archived || !l.unread) continue;
    const theirs = (l.acts ?? []).filter((a) => a.type === "text" && a.from === "them");
    const last = theirs[theirs.length - 1];
    out.push({
      key: `okr-${l.id}-${theirs.length}`,
      kind: "reply",
      lead: l,
      value: 0,
      situation: `replied · "${(last?.t ?? "").slice(0, 64)}${(last?.t ?? "").length > 64 ? "…" : ""}"`,
      editLabel: "Change",
    });
  }

  // Brand-new leads nobody has touched — the Front Desk drafts the first text.
  for (const l of leads) {
    if (l.archived || l.stage !== "New customer" || l.book) continue;
    const anyOutbound = (l.acts ?? []).some((a) => a.from === "us" || a.from === "auto");
    if (anyOutbound || l.unread) continue; // replies are their own card
    out.push({
      key: `okn-${l.id}`,
      kind: "new-lead",
      lead: l,
      value: 0,
      situation: `new lead · ${l.job}`,
      editLabel: "Change",
    });
  }

  return out
    .filter((it) => !dismissed.includes(it.key))
    .sort((a, b) => b.value - a.value)
    .slice(0, QUEUE_CAP);
}

// ---- today's board --------------------------------------------------------------

export interface BoardStop {
  key: string;
  start: number;
  label: string;
  techName: string;
}

export function deriveTodayBoard(
  jobs: Job[],
  leads: Lead[],
  techs: Tech[]
): { stops: BoardStop[]; booksSum: number } {
  const stops: BoardStop[] = [];
  let booksSum = 0;
  const techName = (id: number | null) =>
    firstName(techs.find((t) => t.id === id)?.name ?? "crew");

  for (const j of jobs) {
    if (j.archived) continue;
    for (const v of j.visits ?? []) {
      if (v.date === TODAY_ISO && v.start != null) {
        stops.push({ key: `j${j.id}-${v.id}`, start: v.start, label: j.title, techName: techName(v.techId) });
        booksSum += jobTotal(j);
        break; // count a job's value once even with multiple same-day visits
      }
    }
  }
  for (const l of leads) {
    if (l.archived) continue;
    for (const v of l.evisits ?? []) {
      if (v.date === TODAY_ISO && v.start != null && v.status !== "done") {
        stops.push({ key: `e${l.id}-${v.id}`, start: v.start, label: `${l.name} — site visit`, techName: techName(v.techId) });
      }
    }
  }
  stops.sort((a, b) => a.start - b.start);
  return { stops, booksSum };
}

/** Won work with no placed visit yet — the "to schedule" line under TODAY. */
export function deriveToSchedule(jobs: Job[]): { count: number; sum: number } {
  const un = jobs.filter((j) => !j.archived && j.status === "unscheduled");
  return { count: un.length, sum: un.reduce((s, j) => s + jobTotal(j), 0) };
}

/** Next weekday (within 5) whose afternoon is empty — sellable white space. */
export function deriveOpenSlot(jobs: Job[], leads: Lead[]): string | null {
  const allVisits: Visit[] = [
    ...jobs.filter((j) => !j.archived).flatMap((j) => j.visits ?? []),
    ...leads.filter((l) => !l.archived).flatMap((l) => l.evisits ?? []),
  ];
  const base = new Date(TODAY_ISO + "T12:00:00");
  for (let d = 1; d <= 5; d++) {
    const day = new Date(base);
    day.setDate(day.getDate() + d);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // weekends aren't sellable slots here
    const iso = day.toISOString().slice(0, 10);
    const afternoonBooked = allVisits.some(
      (v) => v.date === iso && v.start != null && v.start >= 12
    );
    if (!afternoonBooked) {
      return `${day.toLocaleDateString("en-US", { weekday: "long" })} afternoon open`;
    }
  }
  return null;
}

// ---- the money line (same math the Money page derives from) ---------------------

export function deriveMoneyLine(estimates: Estimate[], invoices: Invoice[]): {
  quotesOut: number;
  overdue: number;
} {
  const quotesOut = estimates
    .filter((e) => !e.archived && !e.trash && e.status === "sent")
    .reduce((s, e) => s + estTotal(e), 0);
  const overdue = invoices
    .filter((i) => !i.archived && (i.status === "sent" || i.status === "partial") && i.age >= OVERDUE_AGE)
    .reduce((s, i) => s + invDue(i), 0);
  return { quotesOut, overdue };
}
