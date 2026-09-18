// PURE crew-assignment decision function — NO I/O, NO Date.now(), NO infra imports.
// Deterministic: all inputs are passed in; the caller (book_visit, Task 2.3b) supplies the data.
//
// Strategy: LEAST-LOADED crew first (fewest same-day jobs), tie-broken by PROXIMITY — the crew
// already working nearest to the new job's address gets it (so a tech already in the neighborhood
// takes the next-door job, reducing drive time). When proximity can't resolve a tie (no jobPoint,
// or all tied crews' jobs lack geocodes), the FIRST candidate in stable (reader-supplied) order
// wins — deterministic, no random, no hidden state.
import type { UserId } from "@mallet/shared/types";
import type { GeoPoint } from "../domain/geocoder";
import { haversineMiles } from "./service-area";

// One crew member's workload for the target day. Each same-day job contributes to the load count,
// and its `point` (when geocoded) is available for proximity measurement. A null point still counts
// toward load — it just can't be used as a distance anchor.
export interface CrewLoad {
  readonly userId: UserId;
  readonly skillTags: readonly string[];
  readonly sameDayJobs: readonly { readonly point: GeoPoint | null }[];
}

export interface ChooseCrewInput {
  readonly candidates: readonly CrewLoad[]; // the org's field crew in a stable reader-supplied order
  readonly jobPoint: GeoPoint | null;       // the new job's geocoded location — null on a geocode miss
}

/**
 * Pick the crew member to assign the new visit to, or null when no candidates exist.
 *
 * See module header for the full decision tree:
 *   1. No candidates → null.
 *   2. Least-loaded (min sameDayJobs.length) → single winner → return it.
 *   3. Tie: jobPoint null → stable-first among tied.
 *   4. Tie: jobPoint present → smallest min-haversine-distance to jobPoint; Infinity for a crew
 *      with no non-null-point jobs. Distance ties → stable-first.
 */
export function chooseCrew(input: ChooseCrewInput): UserId | null {
  const { candidates, jobPoint } = input;

  // Step 1: no field crew configured for this org → leave the visit unassigned.
  if (candidates.length === 0) return null;

  // Step 2: find the minimum load and filter to only those candidates (contenders).
  const minLoad = minimumLoad(candidates);
  const contenders = candidates.filter((c) => c.sameDayJobs.length === minLoad);

  // Step 3: single contender → no tie to break.
  if (contenders.length === 1) return contenders[0]!.userId;

  // Step 4a: no jobPoint → can't measure proximity; stable-first among tied wins.
  if (jobPoint === null) return contenders[0]!.userId;

  // Step 4b: proximity tie-break — pick the contender whose nearest same-day job is closest to
  // jobPoint. A contender with no non-null-point jobs gets Infinity (can't be proximity-preferred).
  return nearestContender(contenders, jobPoint);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// The smallest same-day job count across all candidates. With at least one candidate guaranteed by
// the caller, this never iterates an empty array (but Math.min of an empty spread is Infinity —
// the guard above ensures we never reach here with zero candidates).
function minimumLoad(candidates: readonly CrewLoad[]): number {
  let min = candidates[0]!.sameDayJobs.length;
  for (let i = 1; i < candidates.length; i += 1) {
    const load = candidates[i]!.sameDayJobs.length;
    if (load < min) min = load;
  }
  return min;
}

// Among a non-empty list of tied contenders, return the userId of the one whose nearest same-day
// geocoded job is closest to `jobPoint`. Stable-first: when two contenders share the same minimum
// distance (including both being Infinity), the one appearing earlier in `contenders` wins — the
// loop tracks the current winner and only replaces it on STRICTLY less distance.
function nearestContender(contenders: readonly CrewLoad[], jobPoint: GeoPoint): UserId {
  let bestUserId = contenders[0]!.userId;
  let bestDistance = crewMinDistance(contenders[0]!, jobPoint);

  for (let i = 1; i < contenders.length; i += 1) {
    const dist = crewMinDistance(contenders[i]!, jobPoint);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestUserId = contenders[i]!.userId;
    }
  }
  return bestUserId;
}

// The minimum haversine distance (in miles) from any of a crew's non-null-point same-day jobs to
// `jobPoint`. Returns Infinity when the crew has no geocoded jobs — they cannot win a proximity
// tie-break and will be passed over in favour of a crew with a real distance.
function crewMinDistance(crewLoad: CrewLoad, jobPoint: GeoPoint): number {
  let min = Infinity;
  for (const job of crewLoad.sameDayJobs) {
    if (job.point === null) continue; // no geocode — skip, can't measure
    const d = haversineMiles(job.point, jobPoint);
    if (d < min) min = d;
  }
  return min;
}
