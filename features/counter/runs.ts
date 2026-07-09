/**
 * features/counter/runs.ts
 * "go get the money" — the outcome verb. Pure builder: scans the same OK-queue
 * derivation Home uses, drafts every chase (never repeating a reminder someone
 * already got — the different-angle beat), and routes anything that needs the
 * owner's own words to a set-aside instead of a template. Commits NOTHING;
 * the single gate at the end sends through the shared OK-send primitive.
 */

import { deriveOkQueue, deriveOpenSlot, firstName } from "@/features/home/derive";
import { draftFor } from "@/features/home/drafts";
import type { Artifact, RunAside, RunStep, Snap } from "./types";

/** "Thursday afternoon open" → "Thursday afternoon" (or null). */
function openSlotPhrase(snap: Snap): string | null {
  const slot = deriveOpenSlot(snap.jobs, snap.leads);
  return slot ? slot.replace(/ open$/, "") : null;
}

/** They already got the standard reminder — the same text twice reads as a bot. */
function alreadyReminded(step: { estimateFuStage: number; hasAutoReminder: boolean }): boolean {
  return step.estimateFuStage >= 1 || step.hasAutoReminder;
}

/**
 * The chase draft for one queue item — SHARED by the money run and the Quotes
 * rail so a nudge is the same words everywhere. Never repeats a reminder the
 * customer already got: past fu stage 1 (or a logged auto reminder) it changes
 * the angle and offers the real open slot instead.
 */
export function chaseDraftFor(
  item: OkItemLike,
  snap: Snap
): { draft: string; angled: boolean } {
  if (item.kind === "quote-viewed" && item.estimate) {
    const hasAutoReminder = (item.lead.acts ?? []).some(
      (a) => a.from === "auto" && /reminder/i.test(a.t ?? "")
    );
    const slot = openSlotPhrase(snap);
    if (
      alreadyReminded({ estimateFuStage: item.estimate.fu.stage, hasAutoReminder }) &&
      slot
    ) {
      const job = item.estimate.title.toLowerCase();
      return {
        draft: `Hi ${firstName(item.lead.name)} — a ${slot} opened up this week. Want me to pencil you in and get the ${job} handled?`,
        angled: true,
      };
    }
  }
  return { draft: draftFor(item as Parameters<typeof draftFor>[0]), angled: false };
}

type OkItemLike = Parameters<typeof draftFor>[0];

/** An outbound text landed moments ago — chasing again now reads as spam. */
function justTexted(lead: { acts?: { from?: string; when: string }[] }): boolean {
  const acts = lead.acts ?? [];
  const last = acts[acts.length - 1];
  return !!last && (last.from === "us" || last.from === "auto") && last.when === "Just now";
}

export function buildMoneyRun(snap: Snap): Artifact {
  // Uncapped intent: the queue derivation, ignoring per-surface dismissals.
  const items = deriveOkQueue(snap.leads, snap.estimates, snap.invoices, []);
  const fresh = items.filter((i) => justTexted(i.lead));
  const chase = items.filter(
    (i) => (i.kind === "quote-viewed" || i.kind === "invoice-overdue") && !justTexted(i.lead)
  );
  const slot = openSlotPhrase(snap);

  const steps: RunStep[] = chase.map((item) => {
    const { draft, angled } = chaseDraftFor(item, snap);
    const sub = angled
      ? `got the standard reminder already — wrote a different angle: offered ${slot}`
      : item.kind === "invoice-overdue"
        ? "firm reminder drafted"
        : "follow-up drafted";
    return {
      key: item.key,
      item,
      title: `${item.lead.name} — ${item.situation}`,
      sub,
      draft,
    };
  });

  // Unanswered replies are money-adjacent but NOT templatable — hand them back.
  const asides: RunAside[] = items
    .filter((i) => i.kind === "reply" && !justTexted(i.lead))
    .map((i) => ({
      leadId: i.lead.id,
      reason: `${i.lead.name} ${i.situation} — wants your words, not a template`,
      open: { type: "thread" as const, id: i.lead.id, label: "open the thread" },
    }));

  // Anyone texted moments ago sits out this run — on camera, not silently.
  for (const i of fresh) {
    if (asides.some((a) => a.leadId === i.lead.id)) continue;
    asides.push({
      leadId: i.lead.id,
      reason: `${i.lead.name} — texted them a minute ago; giving it a beat`,
      open: { type: "thread" as const, id: i.lead.id, label: "the thread" },
    });
  }

  const totalChased = steps.reduce((s, st) => s + (st.item?.value ?? 0), 0);

  if (steps.length === 0 && asides.length === 0) {
    return {
      kind: "answer",
      head: "Nothing's sitting out there — every quote's answered, every invoice's paid.",
      rows: [],
      verb: null,
    };
  }

  return {
    kind: "run",
    mode: "money",
    headline: `$${Math.round(totalChased).toLocaleString("en-US")} is sitting out there. working it —`,
    steps,
    asides,
    totalChased,
  };
}
