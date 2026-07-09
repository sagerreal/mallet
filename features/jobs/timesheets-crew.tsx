"use client";

/**
 * features/jobs/timesheets-crew.tsx
 * Two presentational leaves for the Timesheets tab: the crew chip strip
 * (who to view + their week status) and the selected crew's week card
 * (rollup header, approve/reopen, and the day-grouped entries). Both are pure
 * render + callbacks; the panel owns all state and store writes.
 */

import type { Job, Lead, Tech, TimeEntry } from "@/lib/store/types";
import type { TsRollup } from "./timesheet-derive";
import { TsEntriesBlock, type TsPick } from "./timesheets-entries";

export interface TsCrewChipsProps {
  techs: Tech[];
  totals: TsRollup[];
  selId: string | null;
  crewQ: string;
  onCrewQ: (q: string) => void;
  onSelect: (id: string) => void;
}

/** The crew chips — one per tech, showing their paid hours + approval state. */
export function TsCrewChips({ techs, totals, selId, crewQ, onCrewQ, onSelect }: TsCrewChipsProps) {
  const crewFilter = crewQ.toLowerCase().trim();
  return (
    <>
      {techs.length > 6 && (
        <input
          className="ts-tfilter"
          placeholder="Filter crew…"
          value={crewQ}
          onChange={(e) => onCrewQ(e.target.value)}
        />
      )}
      <div className="ts-chips">
        {techs.map((t, i) => {
          const r = totals[i];
          if (crewFilter && !t.name.toLowerCase().includes(crewFilter)) return null;
          return (
            <button
              key={t.id}
              className={`ts-chip${t.id === selId ? " sel" : ""}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="javatar" style={{ background: t.color, width: 22, height: 22, fontSize: 9 }}>
                {t.initials}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                <b style={{ fontSize: 12.5, color: "var(--ink)" }}>{t.name.split(" ")[0]}</b>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {r && r.count ? `${r.paid.toFixed(1)}h${r.approved ? " · ✓" : " · draft"}` : "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export interface TsTechWeekCardProps {
  tech: Tech;
  rollup: TsRollup;
  entries: TimeEntry[];
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  editId: string | null;
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSetField: (id: string, field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
  onAddEntry: () => void;
  onApprove: () => void;
  onReopen: () => void;
}

/** The selected crew's week: rollup header, approve/reopen, entries. */
export function TsTechWeekCard({
  tech,
  rollup,
  entries,
  jobs,
  leads,
  techs,
  weekDates,
  editId,
  pick,
  onSetPick,
  onEdit,
  onDelete,
  onSetField,
  onCloseEdit,
  onAddEntry,
  onApprove,
  onReopen,
}: TsTechWeekCardProps) {
  const locked = rollup.approved;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <b style={{ fontWeight: 700, fontSize: 15 }}>{tech.name} · this week</b>
        <span className="muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {rollup.paid.toFixed(2)} h{rollup.ot ? ` · ${rollup.ot.toFixed(2)} OT` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {locked ? (
          <>
            <span
              className="pill"
              style={{ background: "var(--green-50)", color: "var(--green-700)", border: "1px solid var(--green-100)" }}
            >
              ✓ Approved
            </span>
            <button className="btn sm ghost" onClick={onReopen}>
              Reopen
            </button>
          </>
        ) : (
          <>
            <button className="btn sm" onClick={onAddEntry}>
              + Add entry
            </button>
            <button className="btn sm primary" onClick={onApprove}>
              Approve
            </button>
          </>
        )}
      </div>
      <TsEntriesBlock
        entries={entries}
        jobs={jobs}
        leads={leads}
        techs={techs}
        weekDates={weekDates}
        editId={editId}
        pick={pick}
        onSetPick={onSetPick}
        onEdit={onEdit}
        onDelete={onDelete}
        onSetField={onSetField}
        onCloseEdit={onCloseEdit}
      />
    </div>
  );
}
