"use client";

/**
 * features/jobs/callback-autopsy-card.tsx
 *
 * Renders the Callback Autopsy panel on the Jobs surface (Task 2.4).
 * One row per cluster showing the service, callback count, the most-missed
 * checklist step, and a one-tap "Make required" button that edits the
 * checklist TEMPLATE via the existing updateChecklist store action.
 *
 * Renders nothing when there are no clusters.
 */

import { useState } from "react";
import Link from "next/link";
import { useCallbackAutopsy } from "@/features/jobs/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import type { ChecklistItem } from "@/lib/store/types";
import type { NewChecklistItem } from "@/lib/store/slices/checklists-slice";

// ---------------------------------------------------------------------------
// Pure helper — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Rebuild a checklist's items preserving every item's existing `required` flag,
 * but forcing `required: true` on the item whose text matches `itemText`
 * (case-insensitive, trimmed). If no item matches, returns the items unchanged.
 */
export function withItemRequired(
  items: readonly ChecklistItem[],
  itemText: string,
): NewChecklistItem[] {
  const needle = itemText.trim().toLowerCase();
  return items.map((it) => ({
    text: it.text,
    type: it.type,
    required: it.required || it.text.trim().toLowerCase() === needle,
  }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopMiss {
  itemText: string;
  checklistName: string;
  missCount: number;
  ofAnswered: number;
  alreadyRequired: boolean;
}

interface Cluster {
  service: string;
  callbackCount: number;
  originalNums: string[];
  answeredOriginals: number;
  topMiss: TopMiss | null;
}

// ---------------------------------------------------------------------------
// Row-level component
// ---------------------------------------------------------------------------

interface ClusterRowProps {
  cluster: Cluster;
}

function ClusterRow({ cluster }: ClusterRowProps) {
  const checklists = useAppStore((s) => s.checklists);
  const updateChecklist = useAppStore((s) => s.updateChecklist);
  const utils = api.useUtils();

  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const { topMiss, service, callbackCount, originalNums } = cluster;

  // Locate the matching job-stage template (case-insensitive name match).
  const matchedTemplate =
    topMiss
      ? checklists.find(
          (t) =>
            t.stage === "job" &&
            t.name.trim().toLowerCase() ===
              topMiss.checklistName.trim().toLowerCase(),
        )
      : undefined;

  async function handleMakeRequired() {
    if (!topMiss || !matchedTemplate) return;
    setPending(true);
    setRowError(null);
    try {
      const items = withItemRequired(matchedTemplate.items, topMiss.itemText);
      await updateChecklist(matchedTemplate.id, matchedTemplate.name, items);
      setDone(true);
      await utils.v1.jobs.callbackAutopsy.invalidate();
    } catch (err) {
      setRowError(userMessage(err));
    } finally {
      setPending(false);
    }
  }

  // Determine right-side control for this row.
  let rightControl: React.ReactNode = null;
  if (topMiss) {
    if (done) {
      rightControl = (
        <span className="cb-autopsy-confirmed">Required ✓</span>
      );
    } else if (topMiss.alreadyRequired) {
      rightControl = (
        <span className="cb-autopsy-already">Already required</span>
      );
    } else if (matchedTemplate) {
      rightControl = (
        <button
          type="button"
          className="btn sm primary"
          disabled={pending}
          onClick={handleMakeRequired}
        >
          {pending ? "Saving…" : "Make required"}
        </button>
      );
    } else {
      // Template renamed or deleted — no dead button; link to Checklists tab.
      rightControl = (
        <Link href="/jobs?tab=checklists" className="btn sm ghost">
          Open Checklists
        </Link>
      );
    }
  }

  const jobRefs =
    originalNums.length > 0
      ? originalNums.slice(0, 4).join(", ") +
        (originalNums.length > 4 ? ` +${originalNums.length - 4}` : "")
      : null;

  return (
    <div className="cb-autopsy-row">
      <div className="cb-autopsy-left">
        <div className="cb-autopsy-service">
          <b>{service}</b>
          <span className="cb-autopsy-count">
            {callbackCount} callback{callbackCount === 1 ? "" : "s"}
          </span>
        </div>

        {topMiss ? (
          <div className="cb-autopsy-insight">
            Most-missed step: &ldquo;{topMiss.itemText}&rdquo; &mdash;{" "}
            {topMiss.missCount} of {topMiss.ofAnswered} job
            {topMiss.ofAnswered === 1 ? "" : "s"}
          </div>
        ) : (
          <div className="cb-autopsy-insight">
            Attach a checklist to catch the cause next time.
          </div>
        )}

        {jobRefs && (
          <div className="cb-autopsy-refs">{jobRefs}</div>
        )}

        {rowError && (
          <div className="cb-autopsy-error">{rowError}</div>
        )}
      </div>

      {rightControl && (
        <div className="cb-autopsy-action">{rightControl}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function CallbackAutopsyCard() {
  const autopsy = useCallbackAutopsy();

  if (!autopsy.data?.length) return null;

  return (
    <div className="cb-autopsy">
      <div className="cb-autopsy-head">Callback autopsy</div>
      {autopsy.data.map((cluster) => (
        <ClusterRow key={cluster.service} cluster={cluster} />
      ))}
    </div>
  );
}
