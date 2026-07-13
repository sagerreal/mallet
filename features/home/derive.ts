/**
 * features/home/derive.ts
 * Pure derivations for the Handoff home screen. Everything here is a function of
 * raw store arrays — narration NEVER invents a fact: every sentence traces to a
 * record (an overnight act, a booked job, a sent quote, an open invoice), and
 * every receipt opens the record it describes.
 */

import { todayISO } from "@/lib/clock";
import { estTotal, invDue } from "@/lib/estimates";
import { hasPhone } from "@/lib/phone";
import type { Lead, Estimate, Invoice, Job, Visit } from "@/lib/store/types";

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
  leadId: string;
  /** When it happened — the real act's own timestamp ("8:47pm"), never invented. */
  when: string;
  /** What the Front Desk did, past tense, with the record to prove it. */
  text: string;
  /** Where the proof lives. */
  open: { kind: "thread"; id: string } | { kind: "estimate"; id: number };
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
    const call = acts.find((a) => a.type === "call");
    if (isBooked && booked) {
      receipts.push({
        key: `booked-${l.id}`,
        leadId: l.id,
        when: call?.when ?? "overnight",
        text: `booked ${l.name} — ${l.job.toLowerCase()}, ${booked.when} ($${Math.round(booked.value).toLocaleString("en-US")})`,
        open: { kind: "thread", id: l.id },
        openLabel: "transcript",
      });
      continue;
    }
    if (call) {
      receipts.push({
        key: `call-${l.id}`,
        leadId: l.id,
        when: call.when ?? "overnight",
        text: `answered ${l.name}'s call — took the details, texted the booking link`,
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
  const leadOf = (id: string) => leads.find((l) => l.id === id && !l.archived);

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

  // Unanswered replies — acknowledgment drafted. Requires an ACTUAL inbound message (not merely
  // unread — a proactively-added customer defaults to unread with nothing to reply to) and a phone
  // to text back to.
  for (const l of leads) {
    if (l.archived || !l.unread || !hasPhone(l)) continue;
    const theirs = (l.acts ?? []).filter((a) => a.type === "text" && a.from === "them");
    if (theirs.length === 0) continue;
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

  // Brand-new leads nobody has touched — the Front Desk drafts the first text. Needs a phone to
  // text (a customer added without a number can't be texted, so no draft).
  for (const l of leads) {
    if (l.archived || l.stage !== "New customer" || l.book || !hasPhone(l)) continue;
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

/** Next weekday (within 5) whose afternoon is empty — sellable white space.
 *  (Used by the Counter's runs, not the home page.) */
export function deriveOpenSlot(jobs: Job[], leads: Lead[]): string | null {
  const allVisits: Visit[] = [
    ...jobs.filter((j) => !j.archived).flatMap((j) => j.visits ?? []),
    ...leads.filter((l) => !l.archived).flatMap((l) => l.evisits ?? []),
  ];
  const base = new Date(todayISO() + "T12:00:00");
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

