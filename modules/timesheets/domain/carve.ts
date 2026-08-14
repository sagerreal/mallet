/**
 * modules/timesheets/domain/carve.ts
 * Cutting job time OUT of a stretch of regular time.
 *
 * THE MODEL THIS FIXES. The clock is a state machine — regular, travel, job, break — so one minute
 * belongs to exactly one state, and the overlap gate refuses anything that lands on a minute already
 * claimed. That is right for two shifts and wrong for the commonest thing an office actually does:
 * a technician clocked ten hours of regular time and never switched state, and now somebody wants to
 * say three of those hours were on J-1039.
 *
 * Job time is not a competitor to regular time, it is a SUBDIVISION of it. So instead of refusing,
 * the regular row is cut in two around the new one.
 *
 * PAID TIME IS NEVER CREATED OR DESTROYED HERE. 10:00–22:00 regular carved by 13:00–16:00 job gives
 * 10:00–13:00 regular + the job + 16:00–22:00 regular. Twelve hours before, twelve hours after. That
 * invariant is the whole reason this is a pure function with its own tests rather than a few lines
 * inside a use case: it decides what somebody is paid.
 */

export interface CarveWindow {
  readonly startTime: string;
  readonly endTime: string | null;
}

export interface CarveHost {
  readonly id: string;
  readonly kind: string;
  readonly startTime: string;
  readonly endTime: string | null;
}

/** What to do to the host row so the new row can sit inside it. */
export type CarvePlan =
  /** The new row fits in a gap — nothing to cut. */
  | { readonly action: "none" }
  /** Shorten the host to end where the new row starts, and add a second row after it. */
  | {
      readonly action: "split";
      readonly hostId: string;
      readonly hostEndTime: string;
      readonly tailStartTime: string;
      readonly tailEndTime: string | null;
    }
  /** The new row starts or ends flush with the host — one edge moves, no second row. */
  | { readonly action: "trim"; readonly hostId: string; readonly startTime: string; readonly endTime: string | null }
  /** The new row covers the host exactly — the host has nothing left and goes. */
  | { readonly action: "replace"; readonly hostId: string }
  /** Not carvable. The caller refuses as it always did, with its own words. */
  | { readonly action: "refuse"; readonly reason: "not-regular" | "spans-rows" | "open-ended" };

const mins = (t: string): number | null => {
  const [h, m] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
};

/**
 * Can this new row be cut out of the day, and how?
 *
 * ONLY REGULAR TIME IS CARVED. Cutting a BREAK would move unpaid minutes into paid ones and quietly
 * raise somebody's pay; cutting TRAVEL or another JOB would move cost between two things that both
 * already claim it. Regular time is the only state that means "on the clock, unattributed" — which
 * is exactly what attributing it should consume.
 *
 * An open-ended host is refused: a running clock has no end to cut against, and guessing one would
 * write a finish time nobody recorded.
 */
export function planCarve(
  candidate: CarveWindow,
  dayRows: readonly CarveHost[],
  carvableKind = "shop",
): CarvePlan {
  const s = mins(candidate.startTime);
  const e = candidate.endTime === null ? null : mins(candidate.endTime);
  if (s === null || e === null || e <= s) return { action: "none" };

  // Every row this candidate touches. More than one and there is no single obvious cut — an office
  // splitting two rows at once is likelier to be fixing the wrong day than doing this deliberately.
  const touched = dayRows.filter((r) => {
    const rs = mins(r.startTime);
    if (rs === null) return false;
    const re = r.endTime === null ? null : mins(r.endTime);
    // A running row is treated as touching anything after it starts.
    return re === null ? e > rs : rs < e && s < re;
  });
  if (touched.length === 0) return { action: "none" };
  if (touched.length > 1) return { action: "refuse", reason: "spans-rows" };

  const host = touched[0];
  if (!host) return { action: "none" };
  if (host.kind !== carvableKind) return { action: "refuse", reason: "not-regular" };
  if (host.endTime === null) return { action: "refuse", reason: "open-ended" };

  const hs = mins(host.startTime);
  const he = mins(host.endTime);
  if (hs === null || he === null) return { action: "refuse", reason: "not-regular" };
  // Sticking out either end would mean the new row also covers minutes nobody clocked.
  if (s < hs || e > he) return { action: "refuse", reason: "spans-rows" };

  const atStart = s === hs;
  const atEnd = e === he;
  if (atStart && atEnd) return { action: "replace", hostId: host.id };
  if (atStart) return { action: "trim", hostId: host.id, startTime: host.endTime === null ? "" : toHHMM(e), endTime: host.endTime };
  if (atEnd) return { action: "trim", hostId: host.id, startTime: host.startTime, endTime: toHHMM(s) };
  return {
    action: "split",
    hostId: host.id,
    hostEndTime: toHHMM(s),
    tailStartTime: toHHMM(e),
    tailEndTime: host.endTime,
  };
}

/** 785 → "13:05". Inverse of `mins`, and the only place minutes become a stored string. */
export function toHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
