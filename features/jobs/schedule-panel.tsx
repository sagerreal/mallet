"use client";

/**
 * features/jobs/schedule-panel.tsx
 * The crew × hour dispatch board — the To-schedule tray + a day/week grid you
 * drag work onto. This is the one surface with real interaction state (arming,
 * dragging, placing, resizing), so that state and its handlers live here in one
 * place; the render is intentionally kept whole to preserve the board's exact
 * behavior. Pure geometry/helpers come from the shared jobs modules.
 *
 * Follow-up (noted, not done here to avoid disturbing board behavior): extract
 * DayView / WeekView / the tray card into leaf components.
 */

import { useState, useRef, useEffect, useMemo, type DragEvent as ReactDragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/clock";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { useScheduleWindow } from "./use-schedule-window";
import { api } from "@/lib/trpc/client";
import { localToday } from "@/features/jobs/use-jobs-query";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Visit } from "@/lib/store/types";
import { isVisitPlaced } from "@/lib/store/visit-placement";
import { timeLabelShort, hmLabel, colLabel } from "@/lib/time";
import { svcMeta } from "./job-status-meta";
import {
  custName,
  jobMode,
  techById,
  boardItemsFor,
  dayLoad,
  type Held,
} from "./jobs-helpers";
import { certAnnotationsFor, armedBannerPhrase } from "./cert-annotations";
import {
  SCHEDULE_PX_PER_HOUR as WPX,
  CREW_CAPACITY_HOURS as CAP,
  CREW_FULL_THRESHOLD,
  BUSINESS_HOURS,
  QUARTER_HOUR,
  MIN_VISIT_DURATION,
  MIN_BLOCK_WIDTH_PX,
  BLOCK_GAP_PX,
  DONE_VISIT_OPACITY,
  SCHEDULE_HEADER_HEIGHT_PX,
  SCHEDULE_LANE_HEIGHT_PX,
  TRAY_CARD_MIN_WIDTH_PX,
} from "./schedule-constants";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

type SchedView = "day" | "week";

/** Snap hours to the quarter, never below the minimum. */
const snapDuration = (h: number) => Math.max(MIN_VISIT_DURATION, Math.round(h / QUARTER_HOUR) * QUARTER_HOUR);

function addDaysLocal(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The one sentence that says you do not have to drag.
 *
 * Dragging is the only affordance the board advertises, and it is the one that fails: the crew
 * rows run off the bottom and the hours off the right edge, so the target is frequently not on
 * screen at the moment you pick the card up. Tap-then-tap has none of that problem. It existed
 * already; it was just written on the branch almost nobody sees.
 */
const PLACE_HINT = "Tap this card, then a crew & time — or drag it";

// First-run empty-state copy. Shown when a brand-new shop opens Schedule with nothing to place
// (no jobs and no estimate visits). Rendered via a full early return that never touches the board.
const FIRST_RUN = {
  heading: "Nothing to schedule yet",
  subtext: "The board fills up as you win work — book a job and it lands in the tray, ready to drop onto a crew.",
  book: {
    title: "Book a job",
    description: "New jobs show up in the To-schedule tray, ready to place on a crew and time.",
    actionLabel: "+ New job",
  },
} as const;

export function SchedulePanel() {
  const openModal = useOpenModal();
  const router = useRouter();
  const placeParam = useSearchParams().get("place");
  const jobs = useAppStore((s) => s.jobs);
  const adoptJob = useAppStore((s) => s.adoptJob);
  const needsSlotQ = api.v1.jobs.list.useQuery(
    { view: "needsSlot", today: localToday(), limit: 50 },
    { refetchOnWindowFocus: true },
  );
  // The tray caps at 50 cards; the COUNT must still be the book's ("50 of 63"), never
  // the cap wearing the label of a business fact.
  const needsSlotCountQ = api.v1.jobs.viewCounts.useQuery({ today: localToday() }, { refetchOnWindowFocus: true });
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const placeVisit = useAppStore((s) => s.placeVisit);
  const addVisit = useAppStore((s) => s.addVisit);
  const updateVisit = useAppStore((s) => s.updateVisit);
  const removeVisit = useAppStore((s) => s.removeVisit);

  // rAF handle for the resize-drag store write — collapses to one updateVisit per frame.
  const rafId = useRef<number | null>(null);
  // Cancel any pending rAF when the component unmounts.
  useEffect(() => () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current); }, []);

  const today = todayISO();
  const [schedView, setSchedView] = useState<SchedView>("day");
  const [schedDay, setSchedDay] = useState(today);
  const [weekStart, setWeekStart] = useState(today);
  // A job visit held for placement on the board (estimate visits are jobs too).
  const [placing, setPlacing] = useState<Held | null>(null);
  const [drag, setDrag] = useState<Held | null>(null);

  // The 7 days of the shown week — honors Prev/Next (was hard-pinned to today).
  function weekDates(): string[] {
    return Array.from({ length: 7 }, (_, i) => addDaysLocal(weekStart, i));
  }

  // Load the days ON SCREEN. The board read the store's jobs collection, which holds the newest
  // page — so navigating past that window drew an empty grid indistinguishable from a free day,
  // which is how a booked slot gets double-booked. Merged, not replaced: other surfaces share
  // this collection. See useScheduleWindow.
  const windowFrom = schedView === "day" ? schedDay : weekStart;
  const windowTo = schedView === "day" ? schedDay : addDaysLocal(weekStart, 6);
  const shown = useScheduleWindow({ from: windowFrom, to: windowTo });

  function firstUnplaced(j: Job): Visit | undefined {
    return (j.visits ?? []).find((v) => !isVisitPlaced(v));
  }
  function place(held: Held, techId: string, iso: string, hour: number) {
    placeVisit(held.ownerId, held.visitId, { techId, date: iso, start: hour });
  }
  // Tap "Schedule": arm the job's first unplaced visit (creating one if needed).
  function armJob(j: Job) {
    const v = firstUnplaced(j) ?? addVisit(j.id);
    if (!v) return;
    setPlacing((p) => (p && p.kind === "job" && p.visitId === v.id ? null : { kind: "job", ownerId: j.id, visitId: v.id }));
  }
  // Tap a board cell while armed → place the held item there (crew + day + start).
  function cellTap(techId: string, iso: string, hour: number) {
    if (!placing) return;
    place(placing, techId, iso, hour);
    setPlacing(null);
  }
  // Drop a dragged card/block on a board cell.
  function cellDrop(techId: string, iso: string, hour: number) {
    if (!drag) return;
    place(drag, techId, iso, hour);
    setDrag(null);
  }
  // "+" on a placed block: clone the visit (carry the hours) and arm it.
  function cloneArm(jobId: string, dur: number) {
    const nv = addVisit(jobId, dur);
    if (nv) setPlacing({ kind: "job", ownerId: jobId, visitId: nv.id });
  }
  // "+" on a TRAY card (prototype visitAddTray): split the job's unplaced hours
  // into one more visit — total preserved, each snapped to the quarter hour.
  function splitTray(j: Job) {
    const unplaced = (j.visits ?? []).filter((v) => !isVisitPlaced(v));
    const total = unplaced.length ? unplaced.reduce((a, v) => a + (v.dur ?? 0), 0) : 2;
    const n = (unplaced.length || 1) + 1;
    const each = snapDuration(total / n);
    unplaced.forEach((v) => removeVisit(j.id, v.id));
    for (let i = 0; i < n; i++) addVisit(j.id, each);
    setPlacing(null);
  }
  // Drag the block's right edge to change its hours (Google-Calendar gesture).
  // The store write is scheduled via requestAnimationFrame so at most one
  // updateVisit fires per paint frame — the network debounce (400ms) is unchanged.
  function resizeStart(e: React.MouseEvent, jobId: string, v: Visit) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startDur = v.dur ?? 1;
    let lastDur: number | null = null;
    function move(ev: MouseEvent) {
      // Cancel any pending frame so rapid mousemove events collapse to one write per frame.
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      lastDur = snapDuration(startDur + (ev.clientX - startX) / WPX);
      const newDur = lastDur;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        updateVisit(jobId, v.id, { dur: newDur });
      });
    }
    function up() {
      // Drop: FLUSH any pending frame, never cancel-and-drop it — on a fast release the final
      // mouse position may be scheduled but not yet committed; cancelling here would silently
      // lose the user's last snap.
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
        if (lastDur !== null) updateVisit(jobId, v.id, { dur: lastDur });
      }
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const armedName = (() => {
    if (!placing) return "";
    if (placing.kind === "job") {
      const j = jobs.find((x) => x.id === placing.ownerId);
      return j ? custName(j, leads) : "";
    }
    return leads.find((l) => l.id === placing.ownerId)?.name ?? "";
  })();

  // Skill-annotation state — computed once per render from the active held item.
  const heldRequired: readonly string[] | null = (() => {
    const held = drag ?? placing;
    if (!held) return null;
    return jobs.find((x) => x.id === held.ownerId)?.requiredCerts ?? null;
  })();

  function DayView() {
    const iso = schedDay;
    let START = BUSINESS_HOURS.open;
    let END = BUSINESS_HOURS.close;

    // expand window to include all visits
    jobs.forEach((j) =>
      (j.visits ?? []).forEach((v) => {
        if (v.date === iso && v.start != null) {
          START = Math.min(START, Math.floor(v.start));
          END = Math.max(END, Math.ceil(v.start + (v.dur ?? 1)));
        }
      })
    );
    START = Math.max(0, Math.min(START, 11));
    END = Math.min(24, Math.max(END, START + 2));

    const hours: number[] = [];
    for (let h = START; h < END; h++) hours.push(h);
    const laneW = (END - START) * WPX;

    return (
      <div className="gv-scroll">
        {/* header row */}
        <div className="gv-row gv-head">
          <div className="gv-name">
            <span className="muted" style={{ fontSize: "var(--type-xs)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Crew
            </span>
          </div>
          <div className="gv-lane" style={{ width: laneW, height: SCHEDULE_HEADER_HEIGHT_PX, position: "relative" }}>
            {hours.concat([END]).map((h) => (
              <div key={h} className="gv-hh" style={{ left: (h - START) * WPX }}>
                {timeLabelShort(h)}
              </div>
            ))}
          </div>
        </div>

        {/* crew rows */}
        {(() => {
          // Cert annotations for this render pass — computed once for all tech rows.
          const annotations = certAnnotationsFor(techs, heldRequired);
          return techs.map((tc) => {
          const items = boardItemsFor(jobs, leads, tc.id, iso);
          const load = items.reduce((s, it) => s + (it.v.dur ?? 0), 0);
          const ann = annotations.get(tc.id);
          const dimmed = ann != null && !ann.qualified;

          return (
            <div key={tc.id} className="gv-row">
              <div className={`gv-name${dimmed ? " cert-dim" : ""}`}>
                <span className="javatar" style={{ background: "var(--green-100)", color: "var(--ink-2)" }}>
                  {tc.initials}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="gv-nm">{tc.name.split(" ")[0]}</div>
                  <div className={`cellload${load > CAP ? " over" : load > CAP * CREW_FULL_THRESHOLD ? " full" : ""}`} style={{ textAlign: "left" }}>
                    {load ? `${hmLabel(load)} / ${CAP}h` : "free"}
                  </div>
                  {dimmed && ann.missing.length > 0 && (
                    <div className="cert-missing">missing {ann.missing.join(", ")}</div>
                  )}
                </div>
              </div>
              <div className="gv-lane" style={{ width: laneW, height: SCHEDULE_LANE_HEIGHT_PX, position: "relative" }}>
                {/* drop cells */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className={`gv-cell${placing || drag ? " drop" : ""}`}
                    style={{ left: (h - START) * WPX, width: WPX, position: "absolute", top: 0, bottom: 0 }}
                    onClick={() => cellTap(tc.id, iso, h)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => cellDrop(tc.id, iso, h)}
                  />
                ))}
                {/* visit blocks (jobs + estimate visits) */}
                {items.map(({ kind, ownerId, name, mode, v }) => {
                  const vStart = v.start ?? 0;
                  const left = Math.max(0, (vStart - START) * WPX);
                  const w = Math.max(MIN_BLOCK_WIDTH_PX, (v.dur ?? 1) * WPX - BLOCK_GAP_PX);
                  const m = svcMeta(mode);
                  const openIt = () => openModal(MODAL.JOB, { jobId: ownerId });
                  return (
                    <div
                      key={`${kind}-${v.id}`}
                      className={`gv-block${m.est ? " est" : ""}`}
                      style={{ left, width: w, opacity: v.status === "done" ? DONE_VISIT_OPACITY : 1 }}
                      draggable
                      onDragStart={(e) => {
                        // Firefox refuses to start a drag with no data payload.
                        e.dataTransfer.setData("text/plain", "");
                        setDrag({ kind, ownerId, visitId: v.id });
                      }}
                      onDragEnd={() => setDrag(null)}
                      onClick={(e) => { e.stopPropagation(); openIt(); }}
                      title={`${name} · ${timeLabelShort(vStart)}–${timeLabelShort(vStart + (v.dur ?? 0))}`}
                    >
                      <div className="gv-bt" style={{ color: m.c }}>
                        {m.word ?? m.tag}
                        {v.status === "done" ? " ✓" : ""}
                      </div>
                      <div className="gv-bn">{name}</div>
                      <div className="gv-btm">
                        {timeLabelShort(vStart)}–{timeLabelShort(vStart + (v.dur ?? 0))}
                      </div>
                      {kind === "job" && (
                        <>
                          <div className="gv-resize" onMouseDown={(e) => resizeStart(e, ownerId, v)} title="Drag to change the hours" />
                          <button
                            className="gv-addv"
                            onClick={(e) => { e.stopPropagation(); cloneArm(ownerId, v.dur ?? 2); }}
                            title="Add another visit — same job, another day"
                          >
                            +
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        });
        })()}
      </div>
    );
  }

  function WeekView() {
    const days = weekDates();

    return (
      <div
        className="wk-overview"
        style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: "var(--space-2)" }}
      >
        {days.map((iso) => {
          const entries = techs
            .flatMap((tc) => boardItemsFor(jobs, leads, tc.id, iso))
            .sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));

          const totalLoad = entries.reduce((s, it) => s + (it.v.dur ?? 0), 0);
          const dayCap = CAP * techs.length;

          const body =
            entries.length === 0 ? (
              <div className="wk-empty">—</div>
            ) : (
              entries.map(({ kind, ownerId, name, mode, v }) => {
                const vStart = v.start ?? 0;
                const m = svcMeta(mode);
                const tc = v.techId != null ? techById(techs, v.techId) : undefined;
                return (
                  <div
                    key={`${kind}-${v.id}`}
                    className={`wk-item${m.est ? " est" : ""}`}
                    style={{ opacity: v.status === "done" ? DONE_VISIT_OPACITY : 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal(MODAL.JOB, { jobId: ownerId });
                    }}
                  >
                    <div className="wk-bt" style={{ color: m.c }}>
                      {m.word ?? m.lbl}
                    </div>
                    <div className="wk-nm">{name}</div>
                    <div className="wk-tm">
                      {timeLabelShort(vStart)}–{timeLabelShort(vStart + (v.dur ?? 0))}
                      {tc ? ` · ${tc.name.split(" ")[0]}` : ""}
                    </div>
                  </div>
                );
              })
            );

          return (
            <div key={iso} className="wk-col">
              <div
                className={`wk-head${iso === today ? " today" : ""}`}
                onClick={() => { setSchedView("day"); setSchedDay(iso); }}
                title="Open this day to place by crew + hour"
              >
                {colLabel(iso)}
                <span className={`cellload${totalLoad > dayCap ? " over" : totalLoad > dayCap * CREW_FULL_THRESHOLD ? " full" : ""}`}>
                  {totalLoad ? hmLabel(totalLoad) : ""}
                </span>
              </div>
              <div className="wk-body">{body}</div>
            </div>
          );
        })}
      </div>
    );
  }

  type TrayCard = { kind: "job"; j: Job };
  // The to-schedule jobs come from the SERVER's needsSlot view — the same predicate the
  // Dashboard tile counts — never from the store's loaded page, which on a big book missed
  // jobs entirely (the tile said 3 while this tray showed 1; the DB agreed with the tile).
  // Fetched jobs are adopted into the store so placing a visit works on a real store row.
  const trayJobs: Job[] = useMemo(
    () => (needsSlotQ.data?.items ?? []).map((dto) => dtoJobToStoreJob(dto as never)),
    [needsSlotQ.data],
  );
  useEffect(() => {
    const known = new Set(jobs.map((j) => j.id));
    for (const j of trayJobs) {
      if (!known.has(j.id)) adoptJob(j as never);
    }
    // jobs deliberately NOT a dep: adopting appends to jobs and would loop.
  }, [trayJobs]);
  const trayCards: TrayCard[] = trayJobs.map((j) => ({ kind: "job" as const, j }));
  const day = schedView === "day";

  const toggle = (
    <div style={{ display: "inline-flex", border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <button
        className={`btn sm ${day ? "primary" : "ghost"}`}
        style={{ border: "none", borderRadius: "0" }}
        onClick={() => setSchedView("day")}
      >
        Day
      </button>
      <button
        className={`btn sm ${!day ? "primary" : "ghost"}`}
        style={{ border: "none", borderRadius: "0" }}
        onClick={() => setSchedView("week")}
      >
        Week
      </button>
    </div>
  );

  const nav = day ? (
    <div className="sched-nav">
      <button className="btn sm ghost" onClick={() => setSchedDay((d) => addDaysLocal(d, -1))}>
        ‹ Prev
      </button>
      {/* data-dynamic: this renders a real calendar date from the wall clock, so the visual net
          would diff it — and fail — every time the day rolls over. Masked, like the other
          clock-derived text (handoff greeting, the tasks date input). */}
      <b data-dynamic style={{ fontSize: "var(--type-base)" }}>
        {schedDay === today ? "Today" : colLabel(schedDay)} ·{" "}
        {new Date(schedDay + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </b>
      <button className="btn sm ghost" onClick={() => setSchedDay((d) => addDaysLocal(d, 1))}>
        Next ›
      </button>
      {schedDay !== today && (
        <span className="linklike" onClick={() => setSchedDay(today)}>
          jump to today
        </span>
      )}
    </div>
  ) : (
    <div className="sched-nav">
      <button className="btn sm ghost" onClick={() => setWeekStart((w) => addDaysLocal(w, -7))}>
        ‹ Prev
      </button>
      <b style={{ fontSize: "var(--type-base)" }}>{weekStart === today ? "This week" : `Week of ${colLabel(weekStart)}`}</b>
      <button className="btn sm ghost" onClick={() => setWeekStart((w) => addDaysLocal(w, 7))}>
        Next ›
      </button>
      {weekStart !== today && (
        <span className="linklike" onClick={() => setWeekStart(today)}>
          jump to today
        </span>
      )}
    </div>
  );

  // No-flash first-run gate. The board has nothing to place when there are no jobs (estimate
  // visits are jobs too). Dedupes the JobsHydrator query (same key → no extra fetch). This is a
  // FULL early return that renders only the header + empty state — the board JSX below is untouched.
  const scheduleCount = jobs.length;
  // Gated on the window's own fetch: it is the read that fills this board, so it is the one that
  // says whether "nothing here" means loading, failed, or genuinely empty.
  const gate = { isFetched: shown.isFetched, isError: shown.isError, count: scheduleCount };
  const firstRun = shouldShowFirstRun(gate);
  const loadFailed = shouldShowLoadFailed(gate);
  const loading = isFirstLoad(gate);

  // Armed or dragging: the tray steps out of the board's way. See the .tray-grid.compact rule.
  const trayCompact = Boolean(placing || drag);

  /**
   * `?place=<jobId>` — a job that was just created and needs a slot.
   *
   * The New-job form has no date picker, so every job it makes arrives with UNPLACED visits and
   * the board is its actual next step. It navigates here with the id rather than reaching into
   * this component's state.
   *
   * ARM ONLY, from the STORE, and never `addVisit`. `addVisit` is fire-and-forget in the create
   * path, so a board mounting straight after a create can see a tray DTO whose `visits` is still
   * empty; once that first createVisit settles, the slice's in-flight dedupe guard no longer
   * applies and arming through `armJob` would mint a SECOND visit on a job that already has one.
   * So: no-op until the store's copy of the job actually shows an unplaced visit, then arm it and
   * drop the param. `jobs` is in the deps precisely so the retry happens when the store catches up.
   *
   * The ref makes the arm HAPPEN ONCE per id. The retry above is a real loop — it re-runs on every
   * store change until the visit lands — and without the latch, re-arming after the dispatcher has
   * moved on would drag their selection back to a job they already placed.
   */
  const armedParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!placeParam || armedParamRef.current === placeParam) return;
    const target = jobs.find((j) => j.id === placeParam);
    if (!target) return;
    const unplaced = (target.visits ?? []).find((v) => !isVisitPlaced(v));
    if (!unplaced) return;
    armedParamRef.current = placeParam;
    setPlacing({ kind: "job", ownerId: target.id, visitId: unplaced.id });
    // replace, not push: the arm has been consumed, and Back should not re-fire it.
    router.replace("/jobs?tab=schedule");
  }, [placeParam, jobs, router]);

  if (loadFailed) {
    return <LoadFailed noun="schedule" onRetry={shown.refetch} retrying={shown.isRefetching} />;
  }
  if (loading) {
    return <ListLoading />;
  }
  if (firstRun) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
          <h1>Schedule</h1>
          <button className="btn" onClick={() => openModal(MODAL.NEW_JOB)}>
            + New job
          </button>
        </div>
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[{ ...FIRST_RUN.book, onAction: () => openModal(MODAL.NEW_JOB), variant: "primary" }]}
        />
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
        <h1>Schedule</h1>
        <button className="btn" onClick={() => openModal(MODAL.NEW_JOB)}>
          + New job
        </button>
      </div>

      {/* To-schedule tray */}
      {trayCards.length > 0 ? (
        <div className="rail" style={{ marginBottom: "var(--space-4)" }}>
          <b style={{ fontSize: "var(--type-base)" }}>
            To schedule{" "}
            <span className="muted" style={{ fontWeight: 600 }}>
              · {(() => {
                const serverTotal = needsSlotCountQ.data?.counts?.needsSlot ?? 0;
                return serverTotal > trayCards.length ? `${trayCards.length} of ${serverTotal}` : trayCards.length;
              })()}
            </span>
          </b>
          {/* While something is armed or in the hand, the tray gives the board back the ~44vh it
              normally holds — the card being placed is already in hand, and the space directly
              under the cursor is the scarce thing. It becomes one horizontally scrolling row, so
              nothing is hidden. */}
          <div
            className={`tray-grid${trayCompact ? " compact" : ""}`}
            style={{
              marginTop: "var(--space-3)",
              gap: "var(--space-2)",
              // One definition of the card width, shared with the CSS compact rule.
              ["--tray-card-min" as string]: `${TRAY_CARD_MIN_WIDTH_PX}px`,
              ...(trayCompact
                ? { display: "flex", overflowX: "auto" as const }
                : { display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${TRAY_CARD_MIN_WIDTH_PX}px,1fr))` }),
            }}
          >
            {trayCards.map((card) => {
              const name = custName(card.j, leads);
              const title = card.j.title;
              const mode = jobMode(card.j);
              const m = svcMeta(mode);
              const hrs =
                (card.j.visits ?? []).filter((v) => !(v.date && v.techId != null)).reduce((s, v) => s + (v.dur ?? 0), 0) || 2;
              const armed = placing?.kind === "job" && placing.ownerId === card.j.id;
              const key = `job-${card.j.id}`;
              function onSchedule() {
                armJob(card.j);
              }
              function onDragStart(e: ReactDragEvent) {
                // Firefox refuses to start a drag with no data payload.
                e.dataTransfer.setData("text/plain", "");
                const v = firstUnplaced(card.j) ?? addVisit(card.j.id);
                if (v) setDrag({ kind: "job", ownerId: card.j.id, visitId: v.id });
              }
              // Several unplaced visits → each chip schedules its own (prototype card branch).
              const unplacedList = (card.j.visits ?? []).filter((v) => !isVisitPlaced(v));
              function openRecord() {
                openModal(MODAL.JOB, { jobId: card.j.id });
              }
              if (unplacedList.length > 1) {
                const total = unplacedList.reduce((a, v) => a + (v.dur ?? 0), 0);
                return (
                  <div
                    key={key}
                    className="railjob"
                    style={{ cursor: "pointer" }}
                    title="Tap to pick up the first stop — or tap a chip below to pick that one"
                    onClick={onSchedule}
                  >
                    <button className="rail-addv" onClick={(e) => { e.stopPropagation(); splitTray(card.j); }} title="Add another visit">
                      +
                    </button>
                    <button
                      type="button"
                      className="rowopen"
                      style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
                      onClick={(e) => { e.stopPropagation(); openRecord(); }}
                    >
                      {name}
                    </button>
                    <div className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2xs) 0 var(--space-3)" }}>{title}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                      <span style={{ fontSize: "var(--type-xs)", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: m.c }}>
                        {m.lbl}
                      </span>
                      <span className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}>
                        {hmLabel(total)} · {unplacedList.length} visits
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: "var(--type-xs)", marginBottom: "var(--space-2)" }}>
                      {PLACE_HINT}
                    </div>
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {unplacedList.map((v) => (
                        <span
                          key={v.id}
                          className={`vchip${placing?.kind === "job" && placing.visitId === v.id ? " arm" : ""}`}
                          draggable
                          onDragStart={(e) => {
                            // Firefox refuses to start a drag with no data payload.
                            e.dataTransfer.setData("text/plain", "");
                            setDrag({ kind: "job", ownerId: card.j.id, visitId: v.id });
                          }}
                          onDragEnd={() => setDrag(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlacing((p) =>
                              p && p.kind === "job" && p.visitId === v.id
                                ? null
                                : { kind: "job", ownerId: card.j.id, visitId: v.id }
                            );
                          }}
                          title="Tap to schedule this visit — or drag onto a lane"
                        >
                          {hmLabel(v.dur)}
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              removeVisit(card.j.id, v.id);
                            }}
                            title="remove this visit"
                            style={{ color: "var(--ink-3)", fontWeight: 800, padding: "0 var(--space-2xs)" }}
                          >
                            ✕
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={key}
                  className={`railjob place${armed ? " arm" : ""}`}
                  title="Tap to pick it up, then tap a crew & time — or drag it onto the board"
                  draggable
                  onDragStart={onDragStart}
                  onDragEnd={() => setDrag(null)}
                  /**
                   * THE CARD IS THE PICK-UP. It used to open the job record, so the only way to
                   * arm was the small "Place on board" button — and arming is what compacts the
                   * tray. Until you found that button the tray held 44vh and the board 62vh, which
                   * is more than a screen: "half the board is cut off". Tapping the card now does
                   * the thing the card is for, and the board gets its room back on the first tap.
                   * The record is still one tap away, on the customer's name below.
                   */
                  onClick={onSchedule}
                  style={{ cursor: "pointer" }}
                >
                  <button className="rail-addv" onClick={(e) => { e.stopPropagation(); splitTray(card.j); }} title="Add another visit">
                    +
                  </button>
                  <button
                    type="button"
                    className="rowopen"
                    style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
                    onClick={(e) => { e.stopPropagation(); openRecord(); }}
                  >
                    {name}
                  </button>
                  <div className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2xs) 0 var(--space-3)" }}>{title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--type-xs)", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: m.c }}>
                      {m.lbl}
                    </span>
                    <span className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}>{hmLabel(hrs)}</span>
                  </div>
                  {/* The two-step, on the card people actually have. This sentence used to exist
                      only inside the multi-visit branch; the single-visit card — the common case —
                      had a `title` tooltip, which never fires on a touch screen. So the only
                      discoverable way to place work was to drag it, onto rows that are off the
                      bottom of the board. */}
                  <div className="muted" style={{ fontSize: "var(--type-xs)", marginBottom: "var(--space-2)" }}>
                    {PLACE_HINT}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      className={`btn sm${armed ? " arm" : " primary"}`}
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={(e) => { e.stopPropagation(); onSchedule(); }}
                    >
                      {/* "Schedule" reads as "do it now"; the button only ARMS the visit, and the
                          next tap is the one that places it. Name the two-step. */}
                      {armed ? "Cancel" : "Place on board"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : needsSlotQ.isFetched ? (
        <div className="rail" style={{ background: "var(--green-50)", borderColor: "#DDD7C9", marginBottom: "var(--space-4)" }}>
          <b style={{ fontSize: "var(--type-base)" }}>Everything sold is scheduled.</b>
        </div>
      ) : (
        // NOT the all-clear until the read has landed. An empty list means "nothing fetched yet"
        // for the first moment of every load, and "Everything sold is scheduled." is a claim — it
        // was being made before the app had looked, then contradicted a beat later when five cards
        // appeared. A dispatcher who believes it and walks away is the cost.
        <div className="rail" style={{ marginBottom: "var(--space-4)" }} aria-busy="true">
          <b style={{ fontSize: "var(--type-base)" }} className="muted">Loading the tray…</b>
        </div>
      )}

      <div style={{ fontSize: "var(--type-xs)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", margin: "var(--space-2xs) 0 var(--space-2)" }}>
        On the board
      </div>
      <div className="sched-toolbar" style={{ marginBottom: "var(--space-2)" }}>
        {toggle}
        <span className="sched-toolbar-gap" />
        {nav}
      </div>

      {/* Called as plain functions ON PURPOSE (not <DayView/>): DayView/WeekView are
          re-declared on every render, so mounting them as JSX components changes the
          element type identity each render and React REMOUNTS the whole grid — the
          setDrag re-render inside a block's dragstart then destroyed the drag-source
          DOM node and Chrome aborted the drag (placed blocks could never be dropped).
          Plain calls keep the grid in SchedulePanel's own element tree so re-renders
          reconcile in place. These functions MUST stay hook-free while they are
          called conditionally like this. */}
      {/* Anchored to the BOARD, not to the tray: this strip is an instruction about where to tap
          next, and it used to sit above the tray — the thing you are being told to look away from
          — with the toolbar between it and the board. In flow and flush, no portal. */}
      {placing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            background: "var(--ink)",
            color: "#fff",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "var(--space-3)",
            fontSize: "var(--type-base)",
            fontWeight: 600,
          }}
        >
          <span>
            Tap a crew &amp; time on the board to place <b>{armedName}</b>
            {armedBannerPhrase(
              placing?.kind === "job"
                ? (jobs.find((x) => x.id === placing.ownerId)?.requiredCerts ?? null)
                : null,
              techs,
              (id) => dayLoad(jobs, id, schedDay),
              (id) => techs.find((t) => t.id === id)?.name ?? "",
            )}
          </span>
          <span
            className="linklike"
            style={{ color: "#fff", textDecoration: "underline", flex: "none" }}
            onClick={() => setPlacing(null)}
          >
            Cancel
          </span>
        </div>
      )}

      {day ? DayView() : WeekView()}
    </>
  );
}
