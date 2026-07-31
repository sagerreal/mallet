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
import { useAppStore } from "@/lib/store/app-store";
import { deriveShiftReport } from "@/features/home/derive";
import { useOkQueue } from "@/features/home/use-ok-queue";
import { useHomePipe } from "@/features/home/use-home-pipe";
import { HandoffNote } from "@/features/home/handoff-note";
import { HomePipe, HomePipeSkeleton } from "@/features/home/home-pipe";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { isFirstLoad } from "@/lib/first-run";
import { OkQueue } from "@/features/home/ok-queue";
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

function TodayPane() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const frontDeskOn = useAppStore((s) => s.toggles.frontDesk);

  // ---- real identity — org name + owner's first name from the DB -----------
  const me = useMe();
  const orgName = me.data?.orgName ?? "My Business";
  const ownerFirst =
    (me.data?.name?.split(" ")[0]) ??
    (me.data?.email?.split("@")[0]) ??
    "there";

  const report = deriveShiftReport(leads, jobs, estimates);
  // The queue comes from the DATABASE. It used to derive from the browser's loaded page, so on a
  // shop with 239 open invoices not one overdue bill reached it — $67,790 of late money missing
  // from the screen whose whole job is to surface what needs chasing. See useOkQueue.
  const okQueue = useOkQueue();
  const queue = okQueue.items;
  const queueValue = okQueue.value;
  // Every tile is computed where its data lives now. It used to add these up from the store —
  // one page per collection, and three of the six were joins ACROSS two capped collections — so
  // the first screen of the app stated money derived from whatever happened to be cached.
  const pipe = useHomePipe();

  // Cold reload: the tiles derive from four store slices that hydrate client-side. Until every
  // hydrator's FIRST load lands, the derived figures are zeros-from-an-empty-store — rendering
  // them would state "$0 to bill" as fact for a beat (Owen saw exactly this in the iOS shell).
  // Same query keys + options as the hydrators, so React Query dedupes — no extra fetches; we
  // only read load state. Skeletons keep the exact tile metrics, so nothing shifts on arrival.
  const leadsQ = api.v1.customers.list.useQuery({ limit: HYDRATOR_PAGE_LIMIT }, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const jobsQ = api.v1.jobs.list.useQuery({ limit: HYDRATOR_PAGE_LIMIT }, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const estimatesQ = api.v1.quoting.list.useQuery({ limit: HYDRATOR_PAGE_LIMIT }, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const invoicesQ = api.v1.invoicing.list.useQuery({ limit: HYDRATOR_PAGE_LIMIT }, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const loading =
    isFirstLoad({ isFetched: leadsQ.isFetched, isError: leadsQ.isError, count: leads.length }) ||
    isFirstLoad({ isFetched: jobsQ.isFetched, isError: jobsQ.isError, count: jobs.length }) ||
    isFirstLoad({ isFetched: estimatesQ.isFetched, isError: estimatesQ.isError, count: estimates.length }) ||
    isFirstLoad({ isFetched: invoicesQ.isFetched, isError: invoicesQ.isError, count: invoices.length });

  return (
    <div>

      <HandoffNote
        orgName={orgName}
        ownerFirst={ownerFirst}
        dateLabel={dateLabel()}
        frontDeskOn={frontDeskOn}
        report={report}
        queueCount={queue.length}
        queueValue={queueValue}
        loading={loading || okQueue.isLoading}
      />

      {loading || pipe.isLoading ? <HomePipeSkeleton /> : <HomePipe stages={pipe.stages} />}

      {!loading && !okQueue.isLoading && <OkQueue items={queue} ctx={{ orgName, ownerFirst }} />}
    </div>
  );
}
