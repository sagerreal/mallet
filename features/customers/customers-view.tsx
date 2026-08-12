/**
 * features/customers/customers-view.tsx
 * The Customers (People) list — Person/Company tabs, a Jobs-style toolbar
 * (Active/Archived toggle + search + Filters + Columns), and the table.
 * Thin orchestrator — delegates to sub-components; filter/sort in customers-utils.
 */

"use client";

import { useMemo, useState } from "react";
import type { LeadGroup } from "@/modules/customers/infra/lead-views";
import { useAppStore, useLeads, useEstimates, useOpenModal, useCustSeg, useSetCustSeg } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate } from "@/lib/store/types";
import { isStaleLead } from "@/features/pipeline/pipeline-constants";
import { api } from "@/lib/trpc/client";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { useCustomersQuery, useCustomersQueryState, CUSTOMER_COL_TO_SORT } from "./use-customers-query";
import { toStoreLead } from "./leads-hydrator";
import { LEAD_STAGES } from "@/modules/customers/domain/lead";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { CustomersToolbar, type CustomerArchiveSet } from "./customers-toolbar";
import { ViewToggle } from "@/components/shared/view-toggle";
import { CustomersGroupFilter } from "./customers-group-filter";
import { ALL_COL_DEFS, DEFAULT_COLS, colWidths } from "./customers-columns";
import { LeadRow } from "./lead-row";
import { CompaniesView } from "./companies-view";
import { pressable } from "@/lib/a11y";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

const SORTABLE_COLS = new Set(["name", "age", "stage"]);

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
  const openModal = useOpenModal();
  const custSeg = useCustSeg();
  const setCustSeg = useSetCustSeg();
  const restoreLead = useAppStore((s) => s.restoreLead);

  // Same query key + options as LeadsHydrator, so React Query dedupes it — no extra fetch. We only
  // read the load state to tell "still loading" and "load errored" apart from a genuinely empty
  // list, so the first-run screen never flashes mid-fetch or misfires on a failed load.
  const [archiveSet, setArchiveSet] = useState<CustomerArchiveSet>("active");
  // Columns are fixed now — the Columns picker went with the Filters panel.
  const visibleCols: string[] = [...DEFAULT_COLS];

  // The list is served a page at a time by the database now: search, stage, source, sort and the
  // count all run in SQL. It used to filter the store's leads in the browser, which could only see
  // the hydrator's first 500 rows — so on 606 customers it reported "500 of 500".
  const cq = useCustomersQueryState();
  const serverSort = cq.sortCol ? (CUSTOMER_COL_TO_SORT[cq.sortCol] ?? null) : null;
  const list = useCustomersQuery({
    search: cq.search,
    stage: cq.stage,
    source: cq.source,
    scope: cq.scope,
    group: cq.group,
    sort: serverSort,
    sortDir: serverSort ? cq.sortDir : null,
  });
  const sorted = useMemo(() => list.rows.map(toStoreLead), [list.rows]);

  // Every group's count, in one read, so each chip states a fact about the BOOK rather than about
  // whatever page happens to be loaded.
  const groupCounts = api.v1.customers.groupCounts.useQuery(undefined, { refetchOnWindowFocus: false });

  // Stage options come from the ENUM, not from the data: a filter that only offers the stages
  // present on this page is a filter that hides the one you want. Counts come from the facets.
  const allStages = LEAD_STAGES as readonly string[];
  const allSources = (list.sources ?? []).map((x: { source: string }) => x.source);
  const activeFilterCount =
    (cq.stage ? 1 : 0) + (cq.source ? 1 : 0) + (cq.scope ? 1 : 0) + (custSeg !== "people" ? 1 : 0) + (archiveSet !== "active" ? 1 : 0);
  const visible = visibleCols.filter((c) => ALL_COL_DEFS[c]);

  // First-run gates on the UNFILTERED book size — the filtered total reads 0 for any
  // no-match search, and that told a 600-customer shop "No customers yet" (Owen hit it).
  // `?? 1` while the count is in flight keeps the screen from flashing before it lands.
  // AND no rows on screen. The book count is its OWN query (bookTotal, unfiltered) while the
  // table renders list.rows — two queries, so one can go stale while the other is current. A
  // brand-new shop created its first customer and the rows arrived while bookTotal was still 0,
  // and first-run short-circuits the table, so the only way out was a page refresh (Owen hit it
  // on a fresh signup). Rows on screen are proof the shop is not empty, whatever the count says.
  const firstRun =
    shouldShowFirstRun({ isFetched: list.isFetched, isError: list.isError, count: list.bookTotal ?? 1 }) &&
    sorted.length === 0;
  const loadFailed = shouldShowLoadFailed({ isFetched: list.isFetched, isError: list.isError, count: list.bookTotal ?? 0 });
  // Only the genuine cold load swaps the page for the loader; a filter change keeps the
  // previous rows on screen (dimmed via isStale) instead of "reloading the page".
  const loading = list.isLoading && sorted.length === 0 && !list.isFetched;
  const refetch = list.refetch;
  const isRefetching = list.isRefetching;

  const sortCol = cq.sortCol;
  const sortDir = cq.sortDir === "desc" ? -1 : 1;

  function toggleSort(col: string) {
    // Columns with no server sort are inert rather than sorting by something else — see
    // CUSTOMER_COL_TO_SORT.
    if (CUSTOMER_COL_TO_SORT[col]) cq.toggleSortCol(col);
  }


  return (
    <div>
      {/* Header */}
      <div className="pagehead">
        <h1>Customers</h1>
        <div className="pagehead-acts">
          <button className="btn ghost" onClick={() => openModal(MODAL.SWEEP)}>
            {/* The stale-customer count was derived from the loaded collection, so with a
                paginated list it would describe one page and read as a whole-book figure. The
                Clean up sweep still finds them — it does its own pass — so the button keeps
                working; only the misleading badge is gone. */}
            Clean up
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
        q={cq.search}
        onQ={cq.setSearch}
        total={list.total ?? 0}
        filtered={list.shown}
      />

      {/* The one filter. Chips, not a panel — see customers-group-filter for why the stored
          `stage` could not be filtered on at all. */}
      <CustomersGroupFilter
        group={(cq.group || null) as LeadGroup | null}
        counts={groupCounts.data}
        onGroup={(g) => cq.setGroup(g ?? "")}
        disabled={archiveSet === "archived"}
      />

      {/* Mobile keeps its own People/Companies + Active/Archived pair; on desktop those live in
          the page header and the toolbar. */}
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

      {/* Table */}
      <div className="card" style={{ padding: "var(--space-2) var(--space-4)" }}>
        {/* Held-over rows for a superseded search dim rather than swap — motion, not a reload. */}
        <table className="list-tbl cols-sized" style={list.isStale ? { opacity: 0.55, transition: "opacity .12s" } : { transition: "opacity .12s" }}>
          {/* Explicit widths, because automatic table layout spreads the surplus on a wide screen
              evenly across columns and strands short content in the middle of huge cells. */}
          <colgroup>
            {/* The Archived view's Restore cell is a real column and shares the same normalised
                budget — a fixed pixel width here would push the total past 100%. */}
            {colWidths(archiveSet === "archived" ? [...visible, "restore"] : visible).map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
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
                        <button type="button" className="linklike" onClick={cq.clear}>
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

      {/* Load-more rather than infinite scroll: someone scanning a customer book wants to reach
          the end of it, and an auto-loading list has no end. */}
      {list.hasMore && (
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4) 0" }}>
          <button className="btn" onClick={list.loadMore} disabled={list.isLoadingMore}>
            {list.isLoadingMore ? "Loading…" : `Load more — showing ${list.shown} of ${list.total ?? "…"}`}
          </button>
        </div>
      )}

      <p className="muted">
        Add columns or filters when you need them. Custom fields become filterable once defined.
      </p>
        </>
      )}
    </div>
  );
}
