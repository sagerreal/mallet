"use client";

/**
 * features/jobs/timesheets-crew.tsx
 * Two presentational leaves for the Timesheets tab: the crew chip strip
 * (who to view + their week status) and the selected crew's week card
 * (rollup header, approve/reopen, and the day-grouped entries). Both are pure
 * render + callbacks; the panel owns all state and store writes.
 */

import type { Job, Lead, Tech, TimeEntry } from "@/lib/store/types";
import { tsDayLabel, type TsRollup } from "./timesheet-derive";
import { stampLabel } from "@/features/field/job-time-derive";
import { TsEntriesBlock, type TsPick } from "./timesheets-entries";

export interface TsCrewChipsProps {
  techs: Tech[];
  totals: TsRollup[];
  selId: string | null;
  crewQ: string;
  onCrewQ: (q: string) => void;
  onSelect: (id: string) => void;
  /** How many days each crew member worked and sent in no hours for, keyed by user id. */
  toFix?: Readonly<Record<string, number>>;
}

/** The crew chips — one per tech, showing their paid hours + approval state. */
export function TsCrewChips({ techs, totals, selId, crewQ, onCrewQ, onSelect, toFix }: TsCrewChipsProps) {
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
              <span className="javatar" style={{ background: t.color, width: 22, height: 22, fontSize: "var(--type-xs)" }}>
                {t.initials}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                <b style={{ fontSize: "var(--type-base)", color: "var(--ink)" }}>{t.name.split(" ")[0]}</b>
                <span className="muted" style={{ fontSize: "var(--type-xs)" }}>
                  {r && r.count ? `${r.paid.toFixed(1)}h${r.approved ? " · ✓" : " · draft"}` : "—"}
                  {/* The count rides the chip so the approver can see WHO needs attention without
                      selecting each person in turn. Amber, matching the strip it points at. */}
                  {toFix?.[t.id] ? (
                    <span style={{ color: "var(--amber)" }}> · {toFix[t.id]} to fix</span>
                  ) : null}
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
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onSetField: (id: string, field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
  onAddEntry: () => void;
  onApprove: () => void;
  onReopen: () => void;
  /** Days the last approval was refused over — empty/null when nothing was refused. */
  unfinishedDays: readonly string[] | null;
  /**
   * When the technician SIGNED this week off, ISO — null when he has not.
   *
   * The third state, and the one that makes approval safe. This card could tell APPROVED from
   * not-approved and nothing else, so an approver could not distinguish a week the man considers
   * finished from one he is still filling in on Thursday afternoon. Approving the second kind is how
   * somebody gets paid for four days of a five-day week.
   */
  submittedAt: string | null;
}

/** "Thu 2:14p" — when he signed it off, in the reader's own timezone. */
function tsSubmittedLabel(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${stampLabel(iso)}`;
}

/** The week's totals. HOURS ONLY — what anyone is paid lives in payroll, never in Mallet. */
function TsWeekMetrics({ rollup }: { rollup: TsRollup }) {
  return (
    <div className="ts-metrics">
      <div>
        <div className="l">Paid</div>
        <div className="n">{rollup.paid.toFixed(2)} h</div>
      </div>
      <div>
        <div className="l">Regular</div>
        <div className="n">{rollup.reg.toFixed(2)} h</div>
      </div>
      <div className="ot">
        <div className="l">Overtime</div>
        <div className="n">{rollup.ot.toFixed(2)} h</div>
        {/* The rule, under the figure it produced. It differs by state, and this is the number the
            office signs for — an overtime total nobody can derive is one nobody can defend. */}
        <div className="ts-rule">{rollup.rulePhrase}</div>
      </div>
    </div>
  );
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
  onStop,
  onDelete,
  onSetField,
  onCloseEdit,
  onAddEntry,
  onApprove,
  onReopen,
  unfinishedDays,
  submittedAt,
}: TsTechWeekCardProps) {
  const locked = rollup.approved;
  const refused = unfinishedDays != null && unfinishedDays.length > 0;
  return (
    <div className="card" style={{ marginTop: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-1)", flexWrap: "wrap" }}>
        <b style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>{tech.name} · this week</b>
        <span style={{ flex: 1 }} />
        {!locked && submittedAt !== null ? (
          <span className="ts-sent">Submitted · {tsSubmittedLabel(submittedAt)}</span>
        ) : null}
        {!locked && submittedAt === null ? (
          // Said plainly rather than left blank: "not submitted" is a fact the approver is deciding
          // ON, and a blank space is indistinguishable from a card that failed to load it.
          <span className="ts-unsent">Not submitted yet</span>
        ) : null}
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
      <TsWeekMetrics rollup={rollup} />
      {refused && (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0 0" }}
        >
          Not approved. These days still have hours with no end time:{" "}
          {unfinishedDays.map((d) => tsDayLabel(d)).join(", ")}. Stop each one below, then approve.
        </p>
      )}
      <TsEntriesBlock
        entries={entries}
        techId={tech.id}
        jobs={jobs}
        leads={leads}
        techs={techs}
        weekDates={weekDates}
        editId={editId}
        pick={pick}
        onSetPick={onSetPick}
        onEdit={onEdit}
        onStop={onStop}
        onDelete={onDelete}
        onSetField={onSetField}
        onCloseEdit={onCloseEdit}
      />
    </div>
  );
}
