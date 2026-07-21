"use client";

/**
 * Pipeline — the hybrid: the rail's verdict strip on top (one draining figure,
 * one delta line), the kanban below (the board people love), cards in the rail
 * language. Four derived columns = the deal journey: WORKING ITSELF (intake,
 * AI in hand) → GETTING THE NUMBER (the three routes to a price: scoped visit
 * back, walkthrough booked, paper in the shop — incl. tech-drafted on site) →
 * OUT (read telemetry) → WON (a yes with no date glows). Columns move when
 * reality moves — never dragged. Amber has one meaning: needs you.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { useAnimatedNumber } from "@/features/home/use-animated-number";
import { deriveRail } from "@/features/quotes/derive";
import { deriveIntake, deriveGetting } from "@/features/pipeline/working";
import { IntakeCard, GettingCard, OutCard, WonCard } from "@/features/pipeline/board-cards";
import type { Snap } from "@/features/counter/types";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

// First-run empty-state copy (functional, not chatty). Shown when a brand-new shop opens Pipeline
// with zero leads (see shouldShowFirstRun) — the board would otherwise be four empty columns.
const FIRST_RUN = {
  heading: "Your pipeline is empty",
  subtext: "As you add customers and send quotes, they move through here: new leads → quoting → out → won.",
  add: {
    title: "Add a customer",
    description: "A new lead lands in the first column, ready to quote.",
    actionLabel: "+ Add a customer",
  },
  quote: {
    title: "Start a quote",
    description: "Build and send a price — it sits in Out until they say yes.",
    actionLabel: "+ New quote",
  },
} as const;

export default function PipelinePage() {
  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const brand = useAppStore((s) => s.brand);
  const openModal = useOpenModal();
  const router = useRouter();

  const rail = useMemo(() => deriveRail(estimates, leads, jobs), [estimates, leads, jobs]);
  const intake = useMemo(() => deriveIntake(leads, estimates), [leads, estimates]);
  const getting = useMemo(() => deriveGetting(leads, estimates), [leads, estimates]);
  const lostCount = useMemo(
    () => leads.filter((l) => !l.archived && l.stage === "Lost").length,
    [leads]
  );
  const snap: Snap = useMemo(
    () => ({ leads, estimates, invoices, jobs, techs, brandName: brand.name }),
    [leads, estimates, invoices, jobs, techs, brand.name]
  );

  const shownSum = useAnimatedNumber(rail.outSum);

  // Same query key + options as LeadsHydrator → React Query dedupes it (no extra fetch). Used only
  // to tell "still loading" / "load errored" apart from a genuinely empty pipeline, so the first-run
  // screen never flashes mid-fetch or misfires on a failed load. Pipeline is driven by leads, so
  // zero leads = an empty board.
  const { isFetched, isError, refetch, isRefetching } = api.v1.customers.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const firstRun = shouldShowFirstRun({ isFetched, isError, count: leads.length });
  const loadFailed = shouldShowLoadFailed({ isFetched, isError, count: leads.length });
  const loading = isFirstLoad({ isFetched, isError, count: leads.length });

  return (
    <div>
      <div className="pagehead">
        <h1>Pipeline</h1>
        <div className="pagehead-acts">
          <button className="btn ghost" onClick={() => openModal(MODAL.NEW_CUSTOMER)}>
            + New customer
          </button>
          <button className="btn primary" onClick={() => router.push("/composer")}>
            + New quote
          </button>
        </div>
      </div>
      <div className="sub">Leads → quotes → won.</div>

      <div className="mob-new">
        <button className="btn ghost" onClick={() => openModal(MODAL.NEW_CUSTOMER)}>
          + New customer
        </button>
        <button className="btn primary" onClick={() => router.push("/composer")}>
          + New quote
        </button>
      </div>

      {loading ? (
        <ListLoading />
      ) : loadFailed ? (
        <LoadFailed noun="pipeline" onRetry={() => void refetch()} retrying={isRefetching} />
      ) : firstRun ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.add, onAction: () => openModal(MODAL.NEW_CUSTOMER), variant: "primary" },
            { ...FIRST_RUN.quote, onAction: () => router.push("/composer") },
          ]}
        />
      ) : (
        <>
      {/* the rail's verdict, as a strip above the board */}
      <div className="ticket qstrip">
        <div>
          <div className="herofig qstrip-fig" aria-label={`$${rail.outSum.toLocaleString("en-US")} out on quotes`}>
            ${shownSum.toLocaleString("en-US")}
          </div>
          <div className="thesis">
            {rail.outSum > 0
              ? "sitting on customers’ phones"
              : "Nothing’s sitting on anyone’s phone."}
          </div>
        </div>
        {rail.delta && <div className="qdelta qstrip-delta">{rail.delta}</div>}
      </div>

      {/* the board */}
      <div className="board">
        <div className="col">
          <div className="col-head">
            <span>New leads</span>
            <span className="sum">{intake.length || ""}</span>
          </div>
          {intake.map((row) => (
            <IntakeCard key={row.lead.id} row={row} snap={snap} />
          ))}
          {intake.length === 0 && <div className="empty-att" style={{ padding: "20px 0" }}>—</div>}
        </div>

        <div className="col">
          <div className="col-head">
            <span>Quoting</span>
            <span className="sum">{getting.length || ""}</span>
          </div>
          {getting.map((row) => (
            <GettingCard key={`${row.kind}-${row.est?.id ?? row.lead.id}`} row={row} />
          ))}
          {getting.length === 0 && <div className="empty-att" style={{ padding: "20px 0" }}>—</div>}
        </div>

        <div className="col">
          <div className="col-head">
            <span>Out</span>
            <span className="sum fig">
              {rail.outSum > 0 ? `$${rail.outSum.toLocaleString("en-US")}` : ""}
            </span>
          </div>
          {rail.out.map((row) => (
            <OutCard key={row.est.id} row={row} snap={snap} />
          ))}
          {rail.out.length === 0 && <div className="empty-att" style={{ padding: "20px 0" }}>—</div>}
        </div>

        <div className="col">
          <div className="col-head">
            <span>Won</span>
            <span className="sum">{rail.won.length || ""}</span>
          </div>
          {rail.won.map((row) => (
            <WonCard key={row.est.id} row={row} />
          ))}
          {rail.won.length === 0 && <div className="empty-att" style={{ padding: "20px 0" }}>—</div>}
        </div>
      </div>

      {/* footer whisper */}
      <div className="qfootbar">
        {lostCount > 0 && (
          <button type="button" className="linklike qrecord" onClick={() => openModal(MODAL.SWEEP)}>
            lost ({lostCount}) ›
          </button>
        )}
        <button type="button" className="linklike qrecord" onClick={() => openModal(MODAL.QUOTE_SWEEP)}>
          the record ›
        </button>
      </div>
        </>
      )}
    </div>
  );
}
