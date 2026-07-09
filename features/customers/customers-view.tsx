/**
 * features/customers/customers-view.tsx
 * The Customers (People) list — Person/Company tabs, a Jobs-style toolbar
 * (Active/Archived toggle + search + Filters + Columns), and the table.
 * Thin orchestrator — delegates to sub-components; filter/sort in customers-utils.
 */

"use client";

import { useMemo, useState } from "react";
import { useLeads, useEstimates, useOpenModal, useCustSeg, useSetCustSeg } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate } from "@/lib/store/types";
import { isStaleLead } from "@/features/pipeline/pipeline-constants";
import { filterLeads, sortLeads } from "./customers-utils";
import { CustomersToolbar, type CustomerArchiveSet } from "./customers-toolbar";
import { ViewToggle } from "@/components/shared/view-toggle";
import { CustomersFilters } from "./customers-filters";
import { CustomersColumns, ALL_COL_DEFS, DEFAULT_COLS } from "./customers-columns";
import { LeadRow } from "./lead-row";
import { CompaniesView } from "./companies-view";
import { estTotal } from "@/lib/estimates";
import { pressable } from "@/lib/a11y";

const SORTABLE_COLS = new Set(["name", "age", "stage", "value"]);

export function CustomersView() {
  const leads = useLeads();
  const estimates = useEstimates();
  const openModal = useOpenModal();
  const custSeg = useCustSeg();
  const setCustSeg = useSetCustSeg();

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
              <span className="pill amber" style={{ marginLeft: 2 }}>
                {staleCount}
              </span>
            )}
          </button>
          <button className="btn primary" onClick={() => openModal(MODAL.NEW_CUSTOMER)}>
            + New customer
          </button>
        </div>
      </div>
      <div className="sub">Everyone you might do work for.</div>

      {/* Segment tabs — this branch only renders for the People segment, so the
          People tab is always active and Companies is always inactive here. */}
      <div className="segsw" style={{ marginBottom: 12, marginTop: 12 }}>
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
      <div className="card" style={{ padding: "6px 14px" }}>
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
                />
              ))
            ) : (
              <tr>
                <td colSpan={visible.length}>
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
    </div>
  );
}
