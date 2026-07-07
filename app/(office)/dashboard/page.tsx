"use client";

/**
 * Home — "The Handoff", v3: the figure that drains.
 * One dollar figure (the money waiting on the owner's OK) is the subject of the
 * Front Desk's note. Below it: the drafts themselves — real outbound SMS bubbles
 * in ghost ink, one amber Send from real. Sending is a witnessed state change:
 * the bubble inks in, the card folds, a timestamped ledger line lands beside the
 * overnight entries, and the figure drains (it derives from the store, so Undo
 * refills it). No stat cells, no chips, no captions — the work IS the screen.
 *
 * Derivations: features/home/derive.ts. Drafts: features/home/drafts.ts.
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
import { AskRow, TodayStrip } from "@/features/home/home-sections";

/** "WED, JUL 1" from the app clock. */
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

  // The day's top move, folded into the ask-input's placeholder.
  const top = queue[0];
  const suggestion = top
    ? top.kind === "invoice-overdue"
      ? `chase ${firstName(top.lead.name)}'s ${fmt$(top.value)}`
      : `follow up ${firstName(top.lead.name)}`
    : null;

  return (
    <div>
      <HandoffNote
        orgName={brand.name}
        ownerFirst={ownerFirst}
        dateLabel={dateLabel()}
        frontDeskOn={frontDeskOn}
        report={report}
        queueCount={queue.length}
        queueValue={queueValue}
      />

      <OkQueue items={queue} receipts={report.receipts} />

      <TodayStrip
        stops={board.stops}
        booksSum={board.booksSum}
        toSchedule={toSchedule}
        openSlot={openSlot}
        money={money}
      />

      <AskRow suggestion={suggestion} />
    </div>
  );
}
