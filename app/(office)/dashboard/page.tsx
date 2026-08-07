"use client";

/**
 * Office — one page, four tabs: Today (the Home handoff), Front Desk, Pricebook,
 * Checklists. The underline tab bar is the in-page switcher (Stripe/GitHub
 * pattern); the sidebar has a single Office item, no subs. ?tab= deep-links each
 * pane (read once on mount, replaceState on click — same approach as Settings).
 * The Front Desk tab carries a live status dot so the shop's heartbeat is
 * visible from any tab.
 */

import { useState, useEffect } from "react";
import { todayISO } from "@/lib/clock";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { deriveShiftReport } from "@/features/home/derive";
import { HandoffNote } from "@/features/home/handoff-note";
import { useWorkBoard } from "@/features/board/use-work-board";
import { WorkBoard, WorkBoardSkeleton } from "@/features/board/work-board";
import type { BoardItem } from "@/features/board/types";
import { api } from "@/lib/trpc/client";
import { LoadFailed } from "@/components/shared/load-failed";
import dynamic from "next/dynamic";
import { useMe } from "@/features/identity/hooks";
import { ListLoading } from "@/components/shared/list-loading";

// Non-default panes are code-split (modal-host precedent): Today is the landing
// tab and stays static; the other three load their chunk on first visit, with
// the shared shimmer while it arrives. Each pane still mounts only when active.
const FrontDeskPane = dynamic(
  () => import("@/features/office/front-desk-pane").then((m) => ({ default: m.FrontDeskPane })),
  { ssr: false, loading: () => <ListLoading /> },
);
const PricebookPane = dynamic(
  () => import("@/features/office/pricebook-pane").then((m) => ({ default: m.PricebookPane })),
  { ssr: false, loading: () => <ListLoading /> },
);
const ChecklistsPanel = dynamic(
  () => import("@/features/jobs/checklists-panel").then((m) => ({ default: m.ChecklistsPanel })),
  { ssr: false, loading: () => <ListLoading /> },
);

type OfficeTab = "today" | "frontdesk" | "pricebook" | "checklists";
const OFFICE_TABS: readonly OfficeTab[] = ["today", "frontdesk", "pricebook", "checklists"];

/** "WED, JUL 8" from the live clock. */
function dateLabel(): string {
  return new Date(todayISO() + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export default function OfficePage() {
  const [tab, setTab] = useState<OfficeTab>("today");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && OFFICE_TABS.includes(t as OfficeTab)) setTab(t as OfficeTab);
  }, []);
  const frontDeskOn = useAppStore((s) => s.toggles.frontDesk);
  const serviceCount = useAppStore((s) => s.services.length);
  const checklistCount = useAppStore((s) => s.checklists.length);

  function switchTab(t: OfficeTab) {
    setTab(t);
    window.history.replaceState(null, "", t === "today" ? "/dashboard" : `/dashboard?tab=${t}`);
  }

  return (
    <div>
      <div className="otabs" role="tablist" aria-label="Office">
        <button className={tab === "today" ? "otab on" : "otab"} role="tab" aria-selected={tab === "today"} onClick={() => switchTab("today")}>
          Today
        </button>
        <button className={tab === "frontdesk" ? "otab on" : "otab"} role="tab" aria-selected={tab === "frontdesk"} onClick={() => switchTab("frontdesk")}>
          <span className={frontDeskOn ? "odot" : "odot off"} aria-hidden="true" /> Front Desk
        </button>
        <button className={tab === "pricebook" ? "otab on" : "otab"} role="tab" aria-selected={tab === "pricebook"} onClick={() => switchTab("pricebook")}>
          Pricebook {serviceCount > 0 && <span className="oct">{serviceCount}</span>}
        </button>
        <button className={tab === "checklists" ? "otab on" : "otab"} role="tab" aria-selected={tab === "checklists"} onClick={() => switchTab("checklists")}>
          Checklists {checklistCount > 0 && <span className="oct">{checklistCount}</span>}
        </button>
      </div>

      {tab === "today" && <TodayPane />}
      {tab === "frontdesk" && <FrontDeskPane />}
      {tab === "pricebook" && <PricebookPane />}
      {tab === "checklists" && <ChecklistsPanel />}
    </div>
  );
}

/**
 * Today = the handoff note over THE BOARD. The flow strip and the OK queue are gone: a strip of
 * six tiles stated figures the owner could not act on, and the queue showed only the five records
 * that happened to carry a prepared text. The board shows EVERY open piece of work in the four
 * columns it moves through, and carries those same texts on the cards they belong to.
 */
function TodayPane() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const jobs = useAppStore((s) => s.jobs);
  const frontDeskOn = useAppStore((s) => s.toggles.frontDesk);

  // ---- real identity — org name + owner's first name from the DB -----------
  const me = useMe();
  const orgName = me.data?.orgName ?? "My Business";
  const ownerFirst =
    (me.data?.name?.split(" ")[0]) ??
    (me.data?.email?.split("@")[0]) ??
    "there";

  const report = deriveShiftReport(leads, jobs, estimates);
  // EVERY open piece of work, from the database — one composed read (features/board/use-work-board).
  const board = useWorkBoard();
  const openModal = useOpenModal();
  const utils = api.useUtils();
  const [retrying, setRetrying] = useState(false);

  // A card opens the record it IS. The board settled `kind` and `refId` upstream, so the card and
  // the modal behind it can never disagree about which record was clicked.
  function openItem(item: BoardItem) {
    if (item.kind === "lead") openModal(MODAL.LEAD, { leadId: item.refId });
    else if (item.kind === "estimate") openModal(MODAL.EST, { estId: item.refId });
    else if (item.kind === "job") openModal(MODAL.JOB, { jobId: item.refId });
    else openModal(MODAL.INVOICE, { invoiceId: item.refId });
  }

  // The board composes eleven reads and holds no refetch of its own, so retry invalidates the
  // whole v1 cache — every column comes back, and so does anything else the page shows.
  async function retry() {
    setRetrying(true);
    try {
      await utils.v1.invalidate();
    } catch {
      // Not swallowed: a still-failing refetch leaves `board.isError` set, so this screen keeps
      // saying so. The catch exists only to put the button back rather than strand it on "Retrying…".
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div>
      <HandoffNote
        orgName={orgName}
        ownerFirst={ownerFirst}
        dateLabel={dateLabel()}
        frontDeskOn={frontDeskOn}
        report={report}
        queueCount={board.needsYou.count}
        queueValue={board.needsYou.valueDollars}
        textsReady={board.needsYou.textsReady}
        loading={!board.isFetched}
      />

      {!board.isFetched && !board.isError ? (
        <WorkBoardSkeleton />
      ) : board.isError ? (
        // Errored with nothing cached. Four empty columns would read as "nothing open today" —
        // the one thing this screen must never say when it doesn't know.
        <LoadFailed noun="board" onRetry={() => void retry()} retrying={retrying} />
      ) : (
        // Task 9 wires this (the first-run setup brief + ghost cards).
        <WorkBoard data={board} firstRun={false} onOpen={openItem} ctx={{ orgName, ownerFirst }} />
      )}
    </div>
  );
}
