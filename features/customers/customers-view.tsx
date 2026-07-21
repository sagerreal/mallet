/**
 * features/customers/customers-view.tsx
 * The Customers (People) list — Person/Company tabs, a Jobs-style toolbar
 * (Active/Archived toggle + search + Filters + Columns), and the table.
 * Thin orchestrator — delegates to sub-components; filter/sort in customers-utils.
 */

"use client";

import { useMemo, useState } from "react";
import { useAppStore, useLeads, useEstimates, useOpenModal, useCustSeg, useSetCustSeg } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate } from "@/lib/store/types";
import { isStaleLead } from "@/features/pipeline/pipeline-constants";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { filterLeads, sortLeads } from "./customers-utils";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { CustomersToolbar, type CustomerArchiveSet } from "./customers-toolbar";
import { ViewToggle } from "@/components/shared/view-toggle";
import { CustomersFilters } from "./customers-filters";
import { CustomersColumns, ALL_COL_DEFS, DEFAULT_COLS } from "./customers-columns";
import { LeadRow } from "./lead-row";
import { CompaniesView } from "./companies-view";
import { estTotal } from "@/lib/estimates";
import { pressable } from "@/lib/a11y";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

const SORTABLE_COLS = new Set(["name", "age", "stage", "value"]);

// First-run empty-state copy (functional, not chatty). Shown when a brand-new shop opens
// Customers with zero people (see shouldShowFirstRun). Both actions open existing modals.
const FIRST_RUN = {
  heading: "No customers yet",
  subtext: "Start from scratch, or bring your existing customers over.",
  add: {
    title: "Add one by hand",
    description: "Type in a name and number — good for your first job or a walk-in.",
    actionLabel: "+ Add a customer",
  },
  importCsv: {
    title: "Import a spreadsheet",
    description: "Bring your list over from QuickBooks, Jobber, Google Contacts, or any CSV.",
    actionLabel: "Upload a CSV",
  },
} as const;

export function CustomersView() {
  const leads = useLeads();
  const estimates = useEstimates();
  const openModal = useOpenModal();
  const custSeg = useCustSeg();
  const setCustSeg = useSetCustSeg();
  const restoreLead = useAppStore((s) => s.restoreLead);

  // Same query key + options as LeadsHydrator, so React Query dedupes it — no extra fetch. We only
  // read the load state to tell "still loading" and "load errored" apart from a genuinely empty
  // list, so the first-run screen never flashes mid-fetch or misfires on a failed load.
  const { isFetched, isError, refetch, isRefetching } = api.v1.customers.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const firstRun = shouldShowFirstRun({ isFetched, isError, count: leads.length });
  const loadFailed = shouldShowLoadFailed({ isFetched, isError, count: leads.length });
  const loading = isFirstLoad({ isFetched, isError, count: leads.length });

  // $ on the table per customer: open (sent) quotes for active pipeline, else
  // the won total once accepted, else nothing. Derived in the body (not a selector).
  const valueByLead = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const lead of leads) {
      const es = estimates.filter((e) => e.leadId === lead.id);
      const open = es.filter((e) => e.status === "sent").reduce((s, e) => s + estTotal(e), 0);
      const won = es.filter((e) => e.status === "accepted").reduce((s, e) => s + estTotal(e), 0);
      m.set(lead.id, open > 0 ? open : won > 0 ? won : null);
    }
    return m;
  }, [leads, estimates]);

  const [archiveSet, setArchiveSet] = useState<CustomerArchiveSet>("active");
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>([...DEFAULT_COLS]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState(1);

  const activeLeads = leads.filter((l) => !l.archived);
  const shownSet = archiveSet === "active" ? activeLeads : leads.filter((l) => l.archived);
  const filtered = filterLeads(shownSet, q, stageFilter, sourceFilter);
  const sorted =
    sortCol === "value"
      ? [...filtered].sort(
          (a, b) => ((valueByLead.get(a.id) ?? -1) - (valueByLead.get(b.id) ?? -1)) * sortDir
        )
      : sortLeads(filtered, sortCol, sortDir);

  const staleCount = activeLeads.filter(isStaleLead).length;
  const allStages = [...new Set(shownSet.map((l) => l.stage))];
  const allSources = [...new Set(shownSet.map((l) => l.source).filter(Boolean))];
  const activeFilterCount = (stageFilter ? 1 : 0) + (sourceFilter ? 1 : 0) + (custSeg !== "people" ? 1 : 0) + (archiveSet !== "active" ? 1 : 0);
  const visible = visibleCols.filter((c) => ALL_COL_DEFS[c]);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(1); }
  }

  function toggleCol(key: string) {
    setVisibleCols((prev) =>
      prev.includes(key)
        ? prev.filter((c) => c !== key)
        : Object.keys(ALL_COL_DEFS).filter((c) => prev.includes(c) || c === key)
    );
  }

  function clearFilters() {
    setQ("");
    setStageFilter("");
    setSourceFilter("");
  }

  // Companies segment renders its own list; the People segment falls through to
  // the leads toolbar + table below. (Placed after every hook so the early return
  // never changes hook order.)
  if (custSeg === "biz") {
    return <CompaniesView />;
  }

  return (
    <div>
      {/* Header */}
      <div className="pagehead">
        <h1>Customers</h1>
        <div className="pagehead-acts">
          <button className="btn ghost" onClick={() => openModal(MODAL.SWEEP)}>
            Clean up
            {staleCount > 0 && (
              <span className="pill amber" style={{ marginLeft: "var(--space-2xs)" }}>
                {staleCount}
              </span>
            )}
          </button>
          <button className="btn ghost" onClick={() => openModal(MODAL.IMPORT_CUSTOMERS)}>
            Import
          </button>
          <button className="btn primary" onClick={() => openModal(MODAL.NEW_CUSTOMER)}>
            + New customer
          </button>
        </div>
      </div>
      <div className="sub">Everyone you might do work for.</div>

      {/* Segment tabs — this branch only renders for the People segment, so the
          People tab is always active and Companies is always inactive here. */}
      <div className="segsw" style={{ marginBottom: "var(--space-3)", marginTop: "var(--space-3)" }}>
        <button className="btn sm primary" onClick={() => setCustSeg("people")}>
          People
        </button>
        <button className="btn sm ghost" onClick={() => setCustSeg("biz")}>
          Companies
        </button>
      </div>

      {/* Mobile-only: full-width primary action */}
      <div className="mob-new">
        <button className="btn primary" onClick={() => openModal(MODAL.NEW_CUSTOMER)}>+ New customer</button>
      </div>

      {loading ? (
        <ListLoading />
      ) : loadFailed ? (
        <LoadFailed noun="customers" onRetry={() => void refetch()} retrying={isRefetching} />
      ) : firstRun ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.add, onAction: () => openModal(MODAL.NEW_CUSTOMER), variant: "primary" },
            { ...FIRST_RUN.importCsv, onAction: () => openModal(MODAL.IMPORT_CUSTOMERS) },
          ]}
        />
      ) : (
        <>
      <CustomersToolbar
        archiveSet={archiveSet}
        onArchiveSet={setArchiveSet}
        q={q}
        onQ={setQ}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((o) => !o)}
        colsOpen={colsOpen}
        onToggleCols={() => setColsOpen((o) => !o)}
        activeFilterCount={activeFilterCount}
        total={shownSet.length}
        filtered={sorted.length}
      />

      {colsOpen && <CustomersColumns visible={visible} onToggle={toggleCol} />}

      {filtersOpen && (
        <>
          <div className="mob-ctrl">
            <div className="segctl">
              <button className={custSeg === "people" ? "on" : ""} onClick={() => setCustSeg("people")}>People</button>
              <button className={custSeg !== "people" ? "on" : ""} onClick={() => setCustSeg("biz")}>Companies</button>
            </div>
            <ViewToggle
              value={archiveSet}
              options={[{ value: "active" as const, label: "Active" }, { value: "archived" as const, label: "Archived" }]}
              onChange={setArchiveSet}
              ariaLabel="Show active or archived customers"
            />
          </div>
          <CustomersFilters
            stageFilter={stageFilter}
            sourceFilter={sourceFilter}
            stages={allStages}
            sources={allSources}
            onStage={setStageFilter}
            onSource={setSourceFilter}
            onClear={clearFilters}
          />
        </>
      )}

      {/* Table */}
      <div className="card" style={{ padding: "var(--space-2) var(--space-4)" }}>
        <table className="list-tbl">
          <thead>
            <tr>
              {visible.map((col) => {
                const sortable = SORTABLE_COLS.has(col);
                const arrow = sortCol === col ? (sortDir === 1 ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={col}
                    className={sortable ? "sortable" : ""}
                    style={sortable ? { cursor: "pointer" } : undefined}
                    onClick={sortable ? () => toggleSort(col) : undefined}
                    aria-sort={sortCol === col ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                    {...(sortable ? pressable(() => toggleSort(col)) : {})}
                  >
                    {ALL_COL_DEFS[col]?.l}{arrow}
                  </th>
                );
              })}
              {archiveSet === "archived" && <th aria-label="Restore" />}
            </tr>
          </thead>
          <tbody>
            {sorted.length > 0 ? (
              sorted.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  visibleCols={visible}
                  value={valueByLead.get(lead.id) ?? null}
                  onOpen={(id) => openModal(MODAL.LEAD, { leadId: id })}
                  onRestore={archiveSet === "archived" ? restoreLead : undefined}
                />
              ))
            ) : (
              <tr>
                <td colSpan={visible.length + (archiveSet === "archived" ? 1 : 0)}>
                  <div className="empty-att">
                    {archiveSet === "archived" ? (
                      "No archived customers."
                    ) : (
                      <>
                        Nothing matches —{" "}
                        <button type="button" className="linklike" onClick={clearFilters}>
                          clear the filters
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted">
        Add columns or filters when you need them. Custom fields become filterable once defined.
      </p>
        </>
      )}
    </div>
  );
}
