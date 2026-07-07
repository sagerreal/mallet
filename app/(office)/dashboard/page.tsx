"use client";

/**
 * Home — "The Handoff". Every morning the Front Desk hands the owner a note like
 * a night-shift employee: what it did overnight (with receipts), what needs a
 * yes (drafted and ready to send), and what today looks like. Chosen over a
 * KPI dashboard after a research pass across agentic-UX, incumbent dashboards,
 * and trades-owner mornings — the screen leads with the agent's WORK, keeps
 * money auditable (same derivations as Quotes/Money), and never pads: the note's
 * size is earned by what actually happened.
 *
 * All derivations live in features/home/derive.ts (pure, record-backed).
 */

import { TODAY_ISO } from "@/lib/prototype-sample";
import { useAppStore } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import {
  deriveShiftReport,
  deriveOkQueue,
  deriveTodayBoard,
  deriveToSchedule,
  deriveOpenSlot,
  deriveMoneyLine,
  firstName,
} from "@/features/home/derive";
import { HandoffNote } from "@/features/home/handoff-note";
import { OkQueue } from "@/features/home/ok-queue";
import { AskRow, EndMark, HandledList, TodayStrip } from "@/features/home/home-sections";

/** "WED JUL 1" from the app clock. */
function dateLabel(): string {
  return new Date(TODAY_ISO + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export default function DashboardPage() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const brand = useAppStore((s) => s.brand);
  const users = useAppStore((s) => s.users);
  const frontDeskOn = useAppStore((s) => s.toggles.frontDesk);
  const dismissed = useAppStore((s) => s.dismissedAttention);

  // ---- all derived in the body, never in a selector -------------------------
  const owner = users.find((u) => u.role === "owner");
  const ownerFirst = firstName(owner?.name ?? "there");

  const report = deriveShiftReport(leads, jobs, estimates);
  const queue = deriveOkQueue(leads, estimates, invoices, dismissed);
  const board = deriveTodayBoard(jobs, leads, techs);
  const toSchedule = deriveToSchedule(jobs);
  const openSlot = deriveOpenSlot(jobs, leads);
  const money = deriveMoneyLine(estimates, invoices);
  const queueValue = queue.reduce((s, it) => s + it.value, 0);

  // Ask-Mallet chips seeded from the top of the queue + sellable white space.
  const chips: { label: string; q?: string; href?: string }[] = [];
  const top = queue[0];
  if (top) {
    chips.push(
      top.kind === "invoice-overdue"
        ? { label: `Chase ${firstName(top.lead.name)}'s ${fmt$(top.value)}`, q: `Chase ${top.lead.name}'s ${fmt$(top.value)} invoice` }
        : { label: `Follow up ${firstName(top.lead.name)}`, q: `Follow up with ${top.lead.name}` }
    );
  }
  if (openSlot) chips.push({ label: "Fill the open afternoon", href: "/jobs?tab=schedule" });
  chips.push({ label: "What should I do first?", q: "What should I do first this morning?" });

  return (
    <div>
      <HandoffNote
        orgName={brand.name}
        ownerFirst={ownerFirst}
        dateLabel={dateLabel()}
        frontDeskOn={frontDeskOn}
        report={report}
        needsOkCount={queue.length}
        needsOkValue={queueValue}
      />

      <OkQueue items={queue} />

      <HandledList receipts={report.receipts} />

      <TodayStrip
        stops={board.stops}
        booksSum={board.booksSum}
        toSchedule={toSchedule}
        openSlot={openSlot}
        money={money}
      />

      <AskRow chips={chips} />

      <EndMark queueEmpty={queue.length === 0} />
    </div>
  );
}
