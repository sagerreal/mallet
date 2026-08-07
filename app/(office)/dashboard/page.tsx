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
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { shouldShowFirstRun } from "@/lib/first-run";
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

      {/* The first-run brief's third path forwards the shop's calls, which is a TAB, not a modal —
          the switcher lives here, so the pane is handed the move rather than the router. */}
      {tab === "today" && <TodayPane onFrontDesk={() => switchTab("frontdesk")} />}
      {tab === "frontdesk" && <FrontDeskPane />}
      {tab === "pricebook" && <PricebookPane />}
      {tab === "checklists" && <ChecklistsPanel />}
    </div>
  );
}

/**
 * A BoardItemKind with no modal behind it. The `never` parameter makes adding a fifth kind a
 * COMPILE error at the one call site that has to map it, rather than a card that quietly opens the
 * wrong record. The throw is unreachable by construction — it exists so the mapping has no return
 * path that guesses. (Same idiom as modules/calls/infra/outbound-call-mapper.ts's unknownTransport.)
 */
function unknownBoardKind(kind: never): never {
  throw new Error(`work board: no modal for item kind ${String(kind)}`);
}

/**
 * The setup brief a shop meets on day one, in place of the handoff note. Three ways in, in the
 * order that pays off soonest: the shop's existing book first, one job second, and the front desk
 * third because it pays off on the NEXT call rather than on this click.
 */
const FIRST_RUN = {
  subtext: "This board fills itself as work comes in. Start wherever you like:",
  importCustomers: {
    title: "Import your customers",
    description: "Jobber, Housecall Pro, or a spreadsheet",
    actionLabel: "Import",
  },
  firstJob: {
    title: "Add your first job",
    description: "Book work you already have lined up",
    actionLabel: "Add job",
  },
  frontDesk: {
    title: "Forward calls to Front Desk",
    description: "Answered calls land here on their own",
    actionLabel: "Set up",
  },
} as const;

/**
 * Every path opens something real: two modals and the tab that actually forwards the calls. A
 * fourth "explore" that opened nothing would be the dead button the house rules forbid, so the
 * brief carries exactly three. The tab move arrives from the page — this pane does not route.
 */
function SetupBrief({ ownerFirst, onFrontDesk }: { ownerFirst: string; onFrontDesk: () => void }) {
  const openModal = useOpenModal();
  return (
    <FirstRunEmptyState
      heading={`Welcome, ${ownerFirst}.`}
      subtext={FIRST_RUN.subtext}
      paths={[
        { ...FIRST_RUN.importCustomers, onAction: () => openModal(MODAL.IMPORT_CUSTOMERS), variant: "primary" },
        { ...FIRST_RUN.firstJob, onAction: () => openModal(MODAL.NEW_JOB) },
        { ...FIRST_RUN.frontDesk, onAction: onFrontDesk },
      ]}
    />
  );
}

/**
 * Today = the handoff note over THE BOARD. The flow strip and the OK queue are gone: a strip of
 * six tiles stated figures the owner could not act on, and the queue showed only the five records
 * that happened to carry a prepared text. The board shows EVERY open piece of work in the four
 * columns it moves through, and carries those same texts on the cards they belong to.
 */
function TodayPane({ onFrontDesk }: { onFrontDesk: () => void }) {
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

  // A brand-new shop, told apart from a slow one and a broken one by the shared predicate: every
  // source settled, none failed, and the four columns hold nothing between them. `count` is each
  // column's SERVER count where it has one, so a shop whose page happens to be empty still isn't
  // first-run. A shop with history but nothing open IS first-run on this board, correctly — the
  // board only ever showed open work, and there is none. Add wonCount to guard against treating a
  // cleared board on an established shop as first-run.
  const totalOpen = board.columns.reduce((sum, column) => sum + column.count, 0);
  const firstRun = shouldShowFirstRun({
    isFetched: board.isFetched,
    isError: board.isError,
    count: totalOpen + board.wonCount,
  });

  const openModal = useOpenModal();
  const utils = api.useUtils();
  const [retrying, setRetrying] = useState(false);

  // A card opens the record it IS. The board settled `kind` and `refId` upstream, so the card and
  // the modal behind it can never disagree about which record was clicked. Exhaustive on purpose:
  // a catch-all `else` would open the INVOICE modal for a fifth kind added later — silently
  // sending the owner to somebody else's record. See unknownBoardKind.
  function openItem(item: BoardItem): void {
    switch (item.kind) {
      case "lead":
        openModal(MODAL.LEAD, { leadId: item.refId });
        break;
      case "estimate":
        openModal(MODAL.EST, { estId: item.refId });
        break;
      case "job":
        openModal(MODAL.JOB, { jobId: item.refId });
        break;
      case "invoice":
        openModal(MODAL.INVOICE, { invoiceId: item.refId });
        break;
      default:
        unknownBoardKind(item.kind);
    }
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
      {/* The hero, or the brief that REPLACES it. "Nothing's waiting on you. Go run the day." is
          true for a shop on day one and teaches it nothing; the brief says what to do instead. */}
      {firstRun ? (
        <SetupBrief ownerFirst={ownerFirst} onFrontDesk={onFrontDesk} />
      ) : (
        <HandoffNote
          orgName={orgName}
          ownerFirst={ownerFirst}
          dateLabel={dateLabel()}
          frontDeskOn={frontDeskOn}
          report={report}
          queueCount={board.needsYou.count}
          queueValue={board.needsYou.valueDollars}
          textsReady={board.needsYou.textsReady}
          // `|| isError` is load-bearing, not belt-and-braces. Once a failed source SETTLES both
          // flags are true, and on `!isFetched` alone the hero would drop its skeleton and print
          // "Nothing's waiting on you. Go run the day." — derived from an empty board — directly
          // above "Couldn't load your board." Two contradicting statements, the confident one first.
          loading={!board.isFetched || board.isError}
        />
      )}

      {!board.isFetched && !board.isError ? (
        // The skeleton wins while the read is in flight: `firstRun` is false until every source
        // has settled, so a shop with work never sees a flash of the ghosts on its way in.
        <WorkBoardSkeleton />
      ) : board.isError ? (
        // Errored with nothing cached. Four empty columns would read as "nothing open today" —
        // the one thing this screen must never say when it doesn't know. This outranks first-run
        // for the same reason: an empty READ is not the same fact as an empty SHOP.
        <LoadFailed noun="board" onRetry={() => void retry()} retrying={retrying} />
      ) : (
        <WorkBoard data={board} firstRun={firstRun} onOpen={openItem} ctx={{ orgName, ownerFirst }} />
      )}
    </div>
  );
}
