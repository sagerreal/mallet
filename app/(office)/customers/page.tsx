"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SAMPLE_LEADS,
  STAGE_PILL_CLS,
  type SampleLead,
} from "@/lib/prototype-sample";

// Mirrors prototype leadColDefs() — default visible cols: name, phone, source, stage, latest
const DEFAULT_COLS = ["name", "phone", "source", "stage", "latest"] as const;
const ALL_COL_DEFS: Record<string, { l: string }> = {
  name:    { l: "Name" },
  phone:   { l: "Phone" },
  source:  { l: "Source" },
  stage:   { l: "Stage" },
  latest:  { l: "Latest" },
  age:     { l: "Days" },
  email:   { l: "Email" },
  address: { l: "Address" },
};

// Mirrors prototype's liveLeads() — no archived in sample
function liveLeads(): SampleLead[] {
  return SAMPLE_LEADS;
}

// Mirrors prototype's filterLeads()
function filterLeads(
  leads: SampleLead[],
  q: string,
  stageFilter: string,
  sourceFilter: string
): SampleLead[] {
  const lq = q.toLowerCase();
  return leads.filter((l) => {
    if (
      lq &&
      !(
        (l.name + " " + l.phone + " " + (l.job ?? "") + " " + (l.email ?? ""))
          .toLowerCase()
          .includes(lq)
      )
    )
      return false;
    if (stageFilter && l.stage !== stageFilter) return false;
    if (sourceFilter && l.source !== sourceFilter) return false;
    return true;
  });
}

// Source pill (mirrors prototype's srcPill)
function SrcPill({ src }: { src: string }) {
  return <span className="pill src">{src}</span>;
}

// Stage pill (mirrors prototype's stagePill / stagePillCls)
function StagePill({ stage }: { stage: string }) {
  const cls = STAGE_PILL_CLS[stage] ?? "ink";
  return <span className={`stamp ${cls}`}>{stage}</span>;
}

// Lead cell renderer (mirrors prototype's leadCell())
function LeadCell({ lead, col }: { lead: SampleLead; col: string }) {
  if (col === "name")
    return (
      <b>
        {lead.name}
        {lead.unread ? (
          <>
            {" "}
            <span className="pill" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}>
              new text
            </span>
          </>
        ) : null}
      </b>
    );
  if (col === "phone") return <>{lead.phone || <span className="muted">—</span>}</>;
  if (col === "source") return <SrcPill src={lead.source} />;
  if (col === "stage") return <StagePill stage={lead.stage} />;
  if (col === "latest") return <span className="muted">{lead.last ?? ""}</span>;
  if (col === "age") return <>{lead.age}d</>;
  if (col === "email") return <>{lead.email ?? <span className="muted">—</span>}</>;
  if (col === "address") return <>{lead.address ?? <span className="muted">—</span>}</>;
  return null;
}

export default function CustomersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>([...DEFAULT_COLS]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState(1);

  const all = liveLeads();
  const rows = filterLeads(all, q, stageFilter, sourceFilter);

  // Sort
  let sorted = [...rows];
  if (sortCol === "name") sorted.sort((a, b) => a.name.localeCompare(b.name) * sortDir);
  if (sortCol === "age") sorted.sort((a, b) => (a.age - b.age) * sortDir);
  if (sortCol === "stage") {
    const order = ["New customer", "Contacted", "Quote Sent", "Won", "Lost"];
    sorted.sort((a, b) => (order.indexOf(a.stage) - order.indexOf(b.stage)) * sortDir);
  }

  const allStages = [...new Set(all.map((l) => l.stage))];
  const allSources = [...new Set(all.map((l) => l.source).filter(Boolean))];
  const activeF = (stageFilter ? 1 : 0) + (sourceFilter ? 1 : 0);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(1); }
  }

  function arrow(col: string) {
    if (sortCol !== col) return "";
    return sortDir === 1 ? " ▲" : " ▼";
  }

  function toggleCol(key: string) {
    setVisibleCols((prev) =>
      prev.includes(key)
        ? prev.filter((c) => c !== key)
        : Object.keys(ALL_COL_DEFS).filter((c) => prev.includes(c) || c === key)
    );
  }

  const visible = visibleCols.filter((c) => ALL_COL_DEFS[c]);

  return (
    <div>
      {/* Header — matches prototype vLeads() header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <h1>Customers</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn ghost" disabled style={{ opacity: 0.6 }}>
            {/* STUB: openSweep() not wired */}
            Clean up
          </button>
          {/* STUB: openQuickAdd() not wired — button is visual-only */}
          <button className="btn primary" disabled style={{ opacity: 0.6 }}>
            + New customer
          </button>
        </div>
      </div>
      <div className="sub">Everyone you might do work for.</div>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          type="text"
          id="ldQ"
          placeholder="Search name, phone, job, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={`btn ${filtersOpen || activeF ? "" : "ghost"}`}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filters
          {activeF > 0 && (
            <span className="pill amber" style={{ marginLeft: "2px" }}>
              {activeF}
            </span>
          )}
        </button>
        <button className="btn ghost" onClick={() => setColsOpen((o) => !o)}>
          Columns ▾
        </button>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {sorted.length} of {all.length}
        </span>
      </div>

      {/* Columns panel */}
      {colsOpen && (
        <div className="fpanel" style={{ gap: "8px" }}>
          {Object.entries(ALL_COL_DEFS).map(([k, d]) => (
            <label key={k} className="colchk">
              <input
                type="checkbox"
                checked={visible.includes(k)}
                onChange={() => toggleCol(k)}
              />
              {d.l}
            </label>
          ))}
        </div>
      )}

      {/* Filters panel */}
      {filtersOpen && (
        <div className="fpanel">
          <div className="field">
            <label>Stage</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="">Any</option>
              {allStages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">Any</option>
              {allSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span
              className="linklike"
              onClick={() => {
                setStageFilter("");
                setSourceFilter("");
                setQ("");
              }}
            >
              Clear all
            </span>
          </div>
        </div>
      )}

      {/* Table — matches prototype custPeople() table markup exactly */}
      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
          <thead>
            <tr>
              {visible.map((c) => {
                const sortable = ["name", "age", "stage"].includes(c);
                return (
                  <th
                    key={c}
                    className={sortable ? "sortable" : ""}
                    onClick={sortable ? () => toggleSort(c) : undefined}
                    style={sortable ? { cursor: "pointer" } : undefined}
                  >
                    {ALL_COL_DEFS[c]?.l}
                    {sortable ? arrow(c) : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length > 0 ? (
              sorted.map((l) => (
                <tr
                  key={l.id}
                  className="clickable"
                  onClick={() => router.push(`/customers/${l.id}`)}
                >
                  {visible.map((c) => (
                    <td key={c}>
                      <LeadCell lead={l} col={c} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visible.length}>
                  <div className="empty-att">
                    Nothing matches —{" "}
                    <span
                      className="linklike"
                      onClick={() => {
                        setQ("");
                        setStageFilter("");
                        setSourceFilter("");
                      }}
                    >
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
        The default stays clean — add columns or filters when you need them. Custom fields become
        filterable and column-able the minute you define them.
      </p>
    </div>
  );
}
