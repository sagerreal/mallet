"use client";

/**
 * Settings → Booking → "Crew hours" card.
 *
 * Per-crew working-hours override editor. Each field crew member can have
 * per-weekday hours that differ from the org defaults (or be marked off).
 * Data source: v1.frontdesk.crewSchedules (list/save).
 *
 * Row semantics (drives the three per-weekday states):
 *   - No row for (crew, weekday)  → crew works the org default hours that day
 *   - Row open=0, close=0         → crew is OFF/closed that day
 *   - Row open < close            → crew's custom hours that day
 *
 * Design: two-level progressive disclosure via FoldCard:
 *   1. Outer FoldCard (collapsed by default) — summary = "{n} field crew"
 *   2. Per-crew rows; each expands in-flow to show seven weekday editors
 *
 * Local draft state only; no Zustand. Save submits all checked weekdays for
 * that crew; unchecked weekdays are omitted (fall back to org hours).
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

// ---- constants ----------------------------------------------------------------

/** Mon-first display order with correct JS getDay() values (0=Sun..6=Sat). */
const WEEKDAYS: { label: string; n: number }[] = [
  { label: "Mon", n: 1 },
  { label: "Tue", n: 2 },
  { label: "Wed", n: 3 },
  { label: "Thu", n: 4 },
  { label: "Fri", n: 5 },
  { label: "Sat", n: 6 },
  { label: "Sun", n: 0 },
];

// ---- types --------------------------------------------------------------------

/** Mirrors the DTO shape returned by v1.frontdesk.crewSchedules.list. */
interface ScheduleEntry {
  userId: string;
  weekday: number;
  openHour: number;
  closeHour: number;
}

/** Input shape for a single entry in v1.frontdesk.crewSchedules.save. */
interface SaveEntry {
  weekday: number;
  openHour: number;
  closeHour: number;
}

interface CrewMember {
  id: string;
  email: string;
  name: string | null;
  isFieldCrew: boolean;
}

/** Per-weekday draft state for a single crew member. */
interface DayDraft {
  /** true = custom row (open=0,close=0 = off; open<close = custom hours) */
  custom: boolean;
  openHour: number;
  closeHour: number;
}

/** Indexed by weekday number (0–6). */
type CrewDraft = Record<number, DayDraft>;

// ---- helpers ------------------------------------------------------------------

/** Mirrors the timeLabel helper in page.tsx exactly. */
function timeLabel(h: number): string {
  if (!h) return "closed";
  const period = h < 12 ? "a" : "p";
  const dh = h > 12 ? h - 12 : h;
  return `${dh}${period}`;
}

/** Shared number-input style matching HrRow in page.tsx verbatim. */
const NUM_INPUT_STYLE: React.CSSProperties = {
  width: 58,
  border: "1.5px solid var(--line)",
  borderRadius: 7,
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 13,
};

/**
 * Build a draft from the list API entries for a specific crew member.
 * Weekdays with no entry → unchecked (uses org hours).
 */
function buildDraft(entries: ScheduleEntry[], userId: string): CrewDraft {
  const mine = entries.filter((e) => e.userId === userId);
  const draft: CrewDraft = {};
  for (const { n } of WEEKDAYS) {
    const row = mine.find((e) => e.weekday === n);
    if (row) {
      draft[n] = { custom: true, openHour: row.openHour, closeHour: row.closeHour };
    } else {
      draft[n] = { custom: false, openHour: 8, closeHour: 17 };
    }
  }
  return draft;
}

/** Derive entries to save: only weekdays marked custom. */
function draftToEntries(draft: CrewDraft): SaveEntry[] {
  return WEEKDAYS.filter(({ n }) => draft[n]?.custom).map(({ n }) => ({
    weekday: n,
    openHour: draft[n]?.openHour ?? 0,
    closeHour: draft[n]?.closeHour ?? 0,
  }));
}

/** Short one-line summary of a crew's current schedule entries. */
function crewSummary(entries: ScheduleEntry[], userId: string): string {
  const mine = entries.filter((e) => e.userId === userId);
  if (mine.length === 0) return "Uses business hours";
  const customDays = mine.filter((e) => !(e.openHour === 0 && e.closeHour === 0));
  const offDays = mine.filter((e) => e.openHour === 0 && e.closeHour === 0);
  const parts: string[] = [];
  if (customDays.length > 0) parts.push(`${customDays.length} day${customDays.length === 1 ? "" : "s"} custom`);
  if (offDays.length > 0) parts.push(`${offDays.length} off`);
  return parts.join(", ");
}

// ---- WeekdayRow ---------------------------------------------------------------

interface WeekdayRowProps {
  dayLabel: string;
  weekday: number;
  draft: DayDraft;
  onChange: (weekday: number, next: DayDraft) => void;
}

function WeekdayRow({ dayLabel, weekday, draft, onChange }: WeekdayRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", flexWrap: "wrap" }}>
      <span style={{ minWidth: 36, fontWeight: 600, fontSize: "12.5px" }}>{dayLabel}</span>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--ink-3)" }}>
        <input
          type="checkbox"
          checked={draft.custom}
          onChange={(e) =>
            onChange(weekday, { ...draft, custom: e.target.checked })
          }
        />
        Custom
      </label>
      {draft.custom && (
        <>
          <input
            type="number"
            min={0}
            max={23}
            value={draft.openHour}
            onChange={(e) =>
              onChange(weekday, { ...draft, openHour: Number(e.target.value) })
            }
            style={NUM_INPUT_STYLE}
          />
          <span className="muted">to</span>
          <input
            type="number"
            min={0}
            max={24}
            value={draft.closeHour}
            onChange={(e) =>
              onChange(weekday, { ...draft, closeHour: Number(e.target.value) })
            }
            style={NUM_INPUT_STYLE}
          />
          <span className="muted" style={{ fontSize: "11.5px" }}>
            {draft.openHour || draft.closeHour
              ? `${timeLabel(draft.openHour)}–${timeLabel(draft.closeHour)}`
              : "closed"}
          </span>
        </>
      )}
      {!draft.custom && (
        <span className="muted" style={{ fontSize: "11.5px" }}>org hours</span>
      )}
    </div>
  );
}

// ---- CrewRow ------------------------------------------------------------------

interface CrewRowProps {
  member: CrewMember;
  allEntries: ScheduleEntry[];
}

function CrewRow({ member, allEntries }: CrewRowProps) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CrewDraft>(() => buildDraft(allEntries, member.id));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = api.v1.frontdesk.crewSchedules.save.useMutation({
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      utils.v1.frontdesk.crewSchedules.list.invalidate().catch(() => {});
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      setSaveError(err.message ?? "Save failed — check your connection and try again.");
    },
  });

  const displayName = member.name ?? member.email;
  const summary = crewSummary(allEntries, member.id);

  function handleDayChange(weekday: number, next: DayDraft) {
    setDraft((prev) => ({ ...prev, [weekday]: next }));
    setSaved(false);
  }

  function handleSave() {
    setSaveError(null);
    save.mutate({ userId: member.id, entries: draftToEntries(draft) });
  }

  return (
    <div style={{ borderBottom: "1px solid var(--line-2)", paddingBottom: 10, marginBottom: 10 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{open ? "▾" : "▸"}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: "13.5px" }}>{displayName}</span>
        <span className="muted" style={{ fontSize: "11.5px" }}>{summary}</span>
      </div>

      {open && (
        <div style={{ paddingTop: 10, paddingLeft: 20 }}>
          {WEEKDAYS.map(({ label, n }) => (
            <WeekdayRow
              key={n}
              dayLabel={label}
              weekday={n}
              draft={draft[n] ?? { custom: false, openHour: 8, closeHour: 17 }}
              onChange={handleDayChange}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <button
              className="btn primary"
              disabled={save.isPending}
              onClick={handleSave}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            {saved && (
              <span style={{ color: "var(--green-900)", fontSize: 12, fontWeight: 600 }}>
                Saved ✓
              </span>
            )}
          </div>
          {saveError && (
            <div style={{ color: "var(--red-700, #b42318)", fontSize: 12, marginTop: 6 }}>
              {saveError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- CrewHoursCard ------------------------------------------------------------

export function CrewHoursCard() {
  const members = api.v1.identity.members.useQuery(undefined, { refetchOnWindowFocus: false });
  const schedules = api.v1.frontdesk.crewSchedules.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const allMembers = members.data?.items ?? [];
  const fieldCrew = allMembers.filter((m) => m.isFieldCrew);
  const allEntries = schedules.data?.items ?? [];

  const isLoading = members.isLoading || schedules.isLoading;
  const isError = members.isError || schedules.isError;

  const summary = isLoading
    ? "Loading…"
    : `${fieldCrew.length} field crew`;

  return (
    <FoldCard title="Crew hours" summary={summary}>
      {isLoading && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Loading…</p>
      )}

      {isError && !isLoading && (
        <p style={{ color: "var(--red, #b42318)", fontSize: 12, margin: 0 }}>
          Couldn&apos;t load crew schedules — refresh to try again.
        </p>
      )}

      {!isLoading && !isError && fieldCrew.length === 0 && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          No field crew yet — mark a team member as field crew to set their hours.
        </p>
      )}

      {!isLoading && !isError && fieldCrew.length > 0 && (
        <div>
          <p className="muted" style={{ fontSize: "11.5px", margin: "0 0 10px" }}>
            Override daily hours for each crew member. Unchecked days use the org business hours.
          </p>
          {fieldCrew.map((m) => (
            <CrewRow key={m.id} member={m} allEntries={allEntries} />
          ))}
        </div>
      )}
    </FoldCard>
  );
}
