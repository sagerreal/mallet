// PURE callback-autopsy aggregation — NO I/O, NO Date.now()/argless new Date(),
// NO infra imports, NO mutation of inputs, NO any. Deterministic output for a given input.
//
// This is the pure heart of AI Foreman Phase 2 (the Callback Autopsy): given confirmed
// callback pairs (callback + the original job it repeats) and the originals' checklist
// answers, it groups pairs by service, then for each cluster finds the checklist step most
// often skipped/overridden by the originals. The consumer (2.3) feeds these clusters to the
// AI summary and the UI badge.
//
// Design mirrors detect-callbacks.ts: well-commented, small helpers each < 50 lines,
// exported contract (2.3 depends on these exact names).
import type { JobChecklistProps } from "../domain/job";
import type { VerifyState } from "../domain/job-execution"; // "pass" | "override"

// ── Public contract (Task 2.3 depends on these exact names) ──────────────────

export interface AutopsyPair {
  readonly callback: { readonly id: string; readonly num: string; readonly svc: string | null };
  readonly original: {
    readonly id: string;
    readonly num: string;
    readonly svc: string | null;
    readonly checklist: JobChecklistProps | null;
  };
}

/** Per-original verify answers: original job id → (checklist item id → state). */
export type AnswersByOriginal = ReadonlyMap<string, ReadonlyMap<string, VerifyState>>;

export interface AutopsyTopMiss {
  /** The step text most often missed in this cluster (first-seen casing from snapshots). */
  readonly itemText: string;
  /** The snapshot's checklist name — used downstream to identify the template to edit. */
  readonly checklistName: string;
  /** Number of answered originals in this cluster that missed a step with this text. */
  readonly missCount: number;
  /** Total answered originals in the cluster (the denominator for miss rate). */
  readonly ofAnswered: number;
  /** True when EVERY snapshot occurrence of this item text had required === true. */
  readonly alreadyRequired: boolean;
}

export interface AutopsyCluster {
  /** Display label: first non-empty svc found in the group, or "Other" when none. */
  readonly service: string;
  readonly callbackCount: number;
  /** Original job nums in this cluster (input order; no duplicates). */
  readonly originalNums: readonly string[];
  /** How many originals in the cluster carried a non-null checklist (denominator). */
  readonly answeredOriginals: number;
  /**
   * The most-missed checklist step across answered originals, or null when either:
   * - no originals had a checklist (answeredOriginals === 0), or
   * - every checklist item was passed (topMissCount === 0).
   */
  readonly topMiss: AutopsyTopMiss | null;
}

/**
 * Pure. Deterministic. Groups callback pairs by service; ranks the most-missed checklist
 * step per cluster.
 *
 * Grouping key: (p.callback.svc ?? p.original.svc ?? "").trim().toLowerCase()
 * Miss rule: an item is MISSED when the answers map for that original has NO entry for
 *   item.id with state "pass" — absent entries and "override" both count as misses.
 * Sort: clusters by callbackCount desc, then service asc.
 */
export function computeAutopsy(
  pairs: readonly AutopsyPair[],
  answers: AnswersByOriginal,
): AutopsyCluster[] {
  const groups = groupByService(pairs);

  const clusters: AutopsyCluster[] = groups.map((group) =>
    buildCluster(group, answers),
  );

  // Sort: callbackCount desc, then service asc (stable — preserves input order within ties).
  return clusters.slice().sort((a, b) => {
    if (b.callbackCount !== a.callbackCount) return b.callbackCount - a.callbackCount;
    return a.service < b.service ? -1 : a.service > b.service ? 1 : 0;
  });
}

// ── groupByService ────────────────────────────────────────────────────────────

interface ServiceGroup {
  readonly key: string;          // normalised key (for sorting)
  readonly displayService: string; // first non-empty svc seen (original casing + spacing)
  readonly pairs: readonly AutopsyPair[];
}

/**
 * Partition pairs into per-service groups, preserving first-seen display label.
 * Key: (callback.svc ?? original.svc ?? "").trim().toLowerCase()
 * Display: first non-empty raw svc string in the group; "Other" when the key is empty.
 */
function groupByService(pairs: readonly AutopsyPair[]): ServiceGroup[] {
  const keyOrder: string[] = [];
  const keyToDisplay = new Map<string, string>();
  const keyToPairs = new Map<string, AutopsyPair[]>();

  for (const p of pairs) {
    const rawSvc = p.callback.svc !== null && p.callback.svc !== ""
      ? p.callback.svc
      : p.original.svc !== null && p.original.svc !== ""
        ? p.original.svc
        : "";
    const key = rawSvc.trim().toLowerCase();

    if (!keyToPairs.has(key)) {
      keyOrder.push(key);
      keyToPairs.set(key, []);
      // Display label: raw (untrimmed, original casing) svc for the first pair, or "Other"
      keyToDisplay.set(key, key === "" ? "Other" : rawSvc);
    }
    keyToPairs.get(key)!.push(p);
  }

  return keyOrder.map((key) => ({
    key,
    displayService: keyToDisplay.get(key)!,
    pairs: keyToPairs.get(key)!,
  }));
}

// ── buildCluster ──────────────────────────────────────────────────────────────

/**
 * Aggregate one service group into an AutopsyCluster. Counts answered originals,
 * tallies misses by item text across answered originals, then picks the topMiss.
 */
function buildCluster(group: ServiceGroup, answers: AnswersByOriginal): AutopsyCluster {
  const seenNums = new Set<string>();
  const originalNums: string[] = [];
  let answeredOriginals = 0;

  // missStats: normalised item text → running tally
  const missStats = new Map<
    string,
    { display: string; checklistName: string; missCount: number; allRequired: boolean }
  >();

  for (const p of group.pairs) {
    // Deduplicate original nums (Set by num string).
    if (!seenNums.has(p.original.num)) {
      seenNums.add(p.original.num);
      originalNums.push(p.original.num);
    }

    if (p.original.checklist === null) continue; // not an answered original
    answeredOriginals += 1;

    accumulateMisses(p.original, answers, missStats);
  }

  const topMiss = rankTopMiss(missStats, answeredOriginals);

  return {
    service: group.displayService,
    callbackCount: group.pairs.length,
    originalNums,
    answeredOriginals,
    topMiss,
  };
}

// ── accumulateMisses ──────────────────────────────────────────────────────────

type MissStats = Map<
  string,
  { display: string; checklistName: string; missCount: number; allRequired: boolean }
>;

/**
 * For one answered original, walk its checklist items and:
 * - Track whether each item (by normalised text) was missed by THIS original.
 * - Track alreadyRequired: false if any snapshot occurrence has required===false.
 *
 * Miss rule: the item is missed when the answers map for this original has NO entry
 * for item.id with state "pass". Absent and "override" both count as misses.
 */
function accumulateMisses(
  original: AutopsyPair["original"],
  answers: AnswersByOriginal,
  missStats: MissStats,
): void {
  const checklist = original.checklist!; // caller guarantees non-null
  const origAnswers = answers.get(original.id) ?? new Map<string, VerifyState>();

  // Track which text keys this particular original contributed a miss for
  // (so we count each original at most once per text key, even if the checklist
  // has duplicate items — which shouldn't happen but is defensive).
  const missedTextsForThisOriginal = new Set<string>();

  for (const item of checklist.items) {
    const textKey = item.text.trim().toLowerCase();
    const state = origAnswers.get(item.id);
    const isMissed = state !== "pass"; // absent or "override" → missed

    if (!missStats.has(textKey)) {
      missStats.set(textKey, {
        display: item.text, // first-seen casing preserved
        checklistName: checklist.name,
        missCount: 0,
        allRequired: true, // assume true until we see a false
      });
    }

    const entry = missStats.get(textKey)!;

    // alreadyRequired becomes false if any occurrence of this text is not required.
    if (!item.required) {
      missStats.set(textKey, { ...entry, allRequired: false });
    }

    if (isMissed && !missedTextsForThisOriginal.has(textKey)) {
      missedTextsForThisOriginal.add(textKey);
      // Increment missCount (re-read after potential allRequired update above)
      const current = missStats.get(textKey)!;
      missStats.set(textKey, { ...current, missCount: current.missCount + 1 });
    }
  }
}

// ── rankTopMiss ───────────────────────────────────────────────────────────────

/**
 * Pick the text key with the highest missCount. Tiebreak: itemText ascending.
 * Returns null when answeredOriginals === 0 or the top missCount is 0.
 */
function rankTopMiss(missStats: MissStats, answeredOriginals: number): AutopsyTopMiss | null {
  if (answeredOriginals === 0) return null;

  let best: (typeof missStats extends Map<string, infer V> ? V : never) | null = null;
  let bestText = "";

  for (const [textKey, entry] of missStats) {
    if (
      best === null ||
      entry.missCount > best.missCount ||
      (entry.missCount === best.missCount && textKey < bestText)
    ) {
      best = entry;
      bestText = textKey;
    }
  }

  if (best === null || best.missCount === 0) return null;

  return {
    itemText: best.display,
    checklistName: best.checklistName,
    missCount: best.missCount,
    ofAnswered: answeredOriginals,
    alreadyRequired: best.allRequired,
  };
}
