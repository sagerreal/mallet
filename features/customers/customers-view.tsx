/**
 * features/customers/customers-view.tsx
 * The Customers list UI (§4.3) — Person/Company tabs, toolbar, table.
 * Thin orchestrator — delegates to sub-components; filter/sort logic in customers-utils.
 */

"use client";

import { useState } from "react";
import { useLeads, useOpenModal, useCustSeg, useSetCustSeg } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { ACTIVE_STAGES, STALE_AGE } from "@/features/pipeline/pipeline-constants";
import { filterLeads, sortLeads } from "./customers-utils";
import { CustomersToolbar } from "./customers-toolbar";
import { CustomersFilters } from "./customers-filters";
import { CustomersColumns, ALL_COL_DEFS, DEFAULT_COLS } from "./customers-columns";
import { LeadRow } from "./lead-row";

const SORTABLE_COLS = new Set(["name", "age", "stage"]);

export function CustomersView() {
  const leads = useLeads();
  const openModal = useOpenModal();
  const custSeg = useCustSeg();
  const setCustSeg = useSetCustSeg();

  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>([...DEFAULT_COLS]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState(1);

  const all = leads.filter((l) => !l.archived);
  const filtered = filterLeads(all, q, stageFilter, sourceFilter);
  const sorted = sortLeads(filtered, sortCol, sortDir);

  const staleCount = all.filter(
    (l) => ACTIVE_STAGES.includes(l.stage) && l.age >= STALE_AGE
  ).length;
  const allStages = [...new Set(all.map((l) => l.stage))];
  const allSources = [...new Set(all.map((l) => l.source).filter(Boolean))];
  const activeFilterCount = (stageFilter ? 1 : 0) + (sourceFilter ? 1 : 0);
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

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1>Customers</h1>
        <div style={{ display: "flex", gap: 8 }}>
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

      {/* Segment tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 12 }}>
        <button
          className={`btn sm${custSeg === "people" ? " primary" : " ghost"}`}
          onClick={() => setCustSeg("people")}
        >
          People
        </button>
        <button
          className={`btn sm${custSeg === "biz" ? " primary" : " ghost"}`}
          onClick={() => setCustSeg("biz")}
        >
          Companies
        </button>
      </div>

      <CustomersToolbar
        q={q}
        onQ={setQ}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((o) => !o)}
        colsOpen={colsOpen}
        onToggleCols={() => setColsOpen((o) => !o)}
        activeFilterCount={activeFilterCount}
        total={all.length}
        filtered={sorted.length}
      />

      {colsOpen && <CustomersColumns visible={visible} onToggle={toggleCol} />}

      {filtersOpen && (
        <CustomersFilters
          stageFilter={stageFilter}
          sourceFilter={sourceFilter}
          stages={allStages}
          sources={allSources}
          onStage={setStageFilter}
          onSource={setSourceFilter}
          onClear={clearFilters}
        />
      )}

      {/* Table */}
      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
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
                  onOpen={(id) => openModal(MODAL.LEAD, { leadId: id })}
                />
              ))
            ) : (
              <tr>
                <td colSpan={visible.length}>
                  <div className="empty-att">
                    Nothing matches —{" "}
                    <span className="linklike" onClick={clearFilters}>
                      clear the filters
                    </span>
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
