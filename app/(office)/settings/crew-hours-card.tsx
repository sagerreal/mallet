"use client";

/**
 * Settings → Booking → "Crew hours" card.
 *
 * Per-crew working-hours override editor using three-state day selects:
 *   - Business hours: no row saved (uses org default)
 *   - Custom hours: row with open < close
 *   - Day off: row with open=0, close=0
 */

import { useState, useRef } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";
import { HourSelect } from "./hour-select";

// ---- constants ----------------------------------------------------------------

const WEEKDAYS = [
  { label: "Mon", n: 1 },
  { label: "Tue", n: 2 },
  { label: "Wed", n: 3 },
  { label: "Thu", n: 4 },
  { label: "Fri", n: 5 },
  { label: "Sat", n: 6 },
  { label: "Sun", n: 0 },
] as const;

// ---- types --------------------------------------------------------------------

interface ScheduleEntry {
  userId: string;
  weekday: number;
  openHour: number;
  closeHour: number;
}

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

export interface DayDraft {
  mode: "business" | "custom" | "off";
  openHour: number;
  closeHour: number;
}

type CrewDraft = Record<number, DayDraft>;

// ---- exported pure functions (for unit tests) ---------------------------------

export function seedDayDraft(entry: Pick<ScheduleEntry, "openHour" | "closeHour"> | undefined): DayDraft {
  if (!entry) return { mode: "business", openHour: 8, closeHour: 17 };
  if (entry.openHour === 0 && entry.closeHour === 0) return { mode: "off", openHour: 0, closeHour: 0 };
  return { mode: "custom", openHour: entry.openHour, closeHour: entry.closeHour };
}

export function draftToSaveEntries(
  draft: CrewDraft,
  weekdays: readonly { label: string; n: number }[],
): SaveEntry[] {
  const out: SaveEntry[] = [];
  for (const { n } of weekdays) {
    const d = draft[n];
    if (!d || d.mode === "business") continue;
    if (d.mode === "off") {
      out.push({ weekday: n, openHour: 0, closeHour: 0 });
    } else {
      out.push({ weekday: n, openHour: d.openHour || 8, closeHour: d.closeHour || 17 });
    }
  }
  return out;
}

// ---- helpers ------------------------------------------------------------------

function buildDraft(entries: ScheduleEntry[], userId: string): CrewDraft {
  const mine = entries.filter((e) => e.userId === userId);
  const draft: CrewDraft = {};
  for (const { n } of WEEKDAYS) {
    const row = mine.find((e) => e.weekday === n);
    draft[n] = seedDayDraft(row);
  }
  return draft;
}

function crewSummary(entries: ScheduleEntry[], userId: string): string {
  const mine = entries.filter((e) => e.userId === userId);
  if (mine.length === 0) return "Business hours";
  const N = mine.length;
  return `Custom · ${N} day${N === 1 ? "" : "s"}`;
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
      <select
        value={draft.mode}
        onChange={(e) => {
          const mode = e.target.value as DayDraft["mode"];
          if (mode === "business") {
            onChange(weekday, { mode: "business", openHour: 8, closeHour: 17 });
          } else if (mode === "off") {
            onChange(weekday, { mode: "off", openHour: 0, closeHour: 0 });
          } else {
            onChange(weekday, { mode: "custom", openHour: draft.openHour || 8, closeHour: draft.closeHour || 17 });
          }
        }}
        style={{
          border: "1.5px solid var(--line)",
          borderRadius: 7,
          padding: "6px 8px",
          fontFamily: "inherit",
          fontSize: 13,
        }}
      >
        <option value="business">Business hours</option>
        <option value="custom">Custom hours</option>
        <option value="off">Day off</option>
      </select>
      {draft.mode === "custom" && (
        <>
          <HourSelect
            value={draft.openHour}
            onChange={(h) =>
              // Keep the range valid: close stays after open (an inverted custom range reads as
              // a day off to the slot math, silently killing that crew-day's availability).
              onChange(weekday, {
                ...draft,
                openHour: h,
                closeHour: h >= draft.closeHour ? Math.min(h + 1, 24) : draft.closeHour,
              })
            }
            min={0}
            max={23}
          />
          <span className="muted">to</span>
          <HourSelect
            value={draft.closeHour}
            onChange={(h) => onChange(weekday, { ...draft, closeHour: h })}
            min={draft.openHour + 1}
            max={24}
          />
        </>
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
  // Lazy init: seed the draft ONCE at mount (buildDraft must not re-run on every parent render —
  // a sibling's save invalidates the list query and re-renders us; the local draft is the source
  // of truth for in-progress edits until OUR save succeeds).
  const [draft, setDraft] = useState<CrewDraft>(() => buildDraft(allEntries, member.id));
  const seededRef = useRef<string>("");
  if (seededRef.current === "") seededRef.current = JSON.stringify(draft);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = api.v1.frontdesk.crewSchedules.save.useMutation({
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      seededRef.current = JSON.stringify(draft);
      utils.v1.frontdesk.crewSchedules.list.invalidate().catch(() => {});
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      setSaveError(err.message ?? "Save failed — check your connection and try again.");
    },
  });

  const displayName = member.name ?? member.email;
  const summary = crewSummary(allEntries, member.id);
  const isDirty = JSON.stringify(draft) !== seededRef.current;

  function handleDayChange(weekday: number, next: DayDraft) {
    setDraft((prev) => ({ ...prev, [weekday]: next }));
    setSaved(false);
  }

  function handleSave() {
    setSaveError(null);
    save.mutate({ userId: member.id, entries: draftToSaveEntries(draft, WEEKDAYS) });
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
              draft={draft[n] ?? { mode: "business", openHour: 8, closeHour: 17 }}
              onChange={handleDayChange}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <button
              className="btn primary"
              disabled={save.isPending || !isDirty}
              onClick={handleSave}
            >
              {save.isPending ? "Saving…" : "Save hours"}
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
            Set custom working hours per crew member. Days without a custom setting follow business hours.
          </p>
          {fieldCrew.map((m) => (
            <CrewRow key={m.id} member={m} allEntries={allEntries} />
          ))}
        </div>
      )}
    </FoldCard>
  );
}
