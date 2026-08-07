/**
 * components/modals/tech-job-modal/found-work-sec.tsx
 * Found work / add-ons (prototype aoSection, 3826-3837) — one .stage-row per
 * addon: bold desc + ($r when techSeesPrice) + a status stpill; proposed rows
 * get "✓ Customer OK'd" / "✕". Below, an add-form with a desc input + (price
 * input when techSeesPrice) + Add. LOCAL controlled inputs.
 *
 * TWO GATES ON THE ADD FORM, and they are different questions.
 *
 *   `readOnly`     — MAY this viewer write? Add + status call ownerOrOffice endpoints, so a
 *                    technician gets the list without the controls.
 *   `hasSoldWork`  — is there anything for found work to be EXTRA TO? Found work means "beyond
 *                    what was sold". On an estimate walkthrough nothing has been sold yet, so the
 *                    add form is not clutter, it is a category error: it gives the person holding
 *                    the phone two places to type a price (here and the Quote tab's builder) and
 *                    before a sale only one of them is right. A price typed in here on a
 *                    walkthrough is neither a quote nor billable work — nothing converts it.
 *
 * ROWS ARE NEVER HIDDEN, only the form. If an addon already exists on such a job it is real data
 * and the tech sheet is the only place showing it. The section disappears when — and only when —
 * there is nothing to read and nothing sensible to write, which is the office job modal's own
 * emptiness rule for its counted rows (job-modal.tsx's `noteCount > 0`).
 */

"use client";

import { memo, useState } from "react";
import type { Addon, Job } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { AO_INPUT } from "./helpers";
import { SheetRow } from "@/components/modals/sheet-row";

interface AddonStatusPillProps {
  status: Addon["status"];
}

function AddonStatusPill({ status }: AddonStatusPillProps) {
  if (status === "approved") {
    return (
      <span className="stpill" style={{ color: "var(--green-700)", background: "var(--green-50)" }}>
        approved
      </span>
    );
  }
  if (status === "declined") {
    return (
      <span className="stpill" style={{ color: "var(--ink-3)", background: "var(--paper)" }}>
        declined
      </span>
    );
  }
  return (
    <span className="stpill" style={{ color: "var(--amber)", background: "var(--amber-bg)" }}>
      awaiting OK
    </span>
  );
}

export interface FoundWorkSecProps {
  job: Job;
  seesPrice: boolean;
  /** Tech role: add + status controls call ownerOrOffice endpoints — list stays read-only. */
  readOnly: boolean;
  /**
   * Has this job SOLD anything for found work to be extra to — priced lines, or a quote signed on
   * site? False on a pure estimate walkthrough, where the add form is a category error (see the
   * module note). Prices withheld from this device do NOT read as unsold: `isUnpricedEstimate`
   * carries that third state, which is why the host passes its answer rather than re-deriving one.
   */
  hasSoldWork: boolean;
  addAddon: (jobId: string, draft: { d: string; r: number }) => Addon | null;
  setAddonStatus: (jobId: string, addonId: number, status: Addon["status"]) => void;
}

// FoundWorkSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.addons and job.id.
export function foundWorkPropsEqual(a: FoundWorkSecProps, b: FoundWorkSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.readOnly === b.readOnly &&
    a.hasSoldWork === b.hasSoldWork &&
    a.addAddon === b.addAddon &&
    a.setAddonStatus === b.setAddonStatus &&
    a.job.id === b.job.id &&
    a.job.addons === b.job.addons
  );
}

function FoundWorkSecFn({
  job,
  seesPrice,
  readOnly,
  hasSoldWork,
  addAddon,
  setAddonStatus,
}: FoundWorkSecProps) {
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");

  const addons = job.addons ?? [];
  const awaiting = addons.filter((a) => a.status === "proposed").length;

  // May this viewer add found work to THIS job — both gates, for the two different reasons in
  // the module note.
  const canWrite = !readOnly && hasSoldWork;

  // Nothing to read and nothing sensible to write = nothing to render (no dead empty section).
  if (!canWrite && addons.length === 0) return null;

  function submit() {
    const d = desc.trim();
    if (!d) return;
    addAddon(job.id, { d, r: +price || 0 });
    setDesc("");
    setPrice("");
  }

  return (
    <SheetRow
      variant="section"
      label="Found work"
      value={addons.length}
      after={awaiting ? <span>· {awaiting} awaiting OK</span> : undefined}
      expandable
    >
      {addons.map((a) => (
        <div key={a.id} className="stage-row">
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 600 }}>{a.d}</b>
            {/* a.r === null = server-redacted (techSeesPrice off) — show nothing, never $0. */}
            {seesPrice && a.r != null && <span className="muted"> · {fmt$(a.r)}</span>}
          </div>
          <AddonStatusPill status={a.status} />
          {canWrite && a.status === "proposed" && (
            <>
              <button
                className="btn sm primary"
                onClick={() => setAddonStatus(job.id, a.id, "approved")}
              >
                ✓ Customer OK&rsquo;d
              </button>
              <button className="btn sm ghost" onClick={() => setAddonStatus(job.id, a.id, "declined")}>
                ✕
              </button>
            </>
          )}
        </div>
      ))}

      {canWrite && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="extra work found…"
            style={{ flex: 2, minWidth: 140, ...AO_INPUT }}
          />
          {seesPrice && (
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="price $"
              style={{ flex: "0 0 92px", ...AO_INPUT }}
            />
          )}
          <button type="button" className="btn sm primary" onClick={submit}>
            Add
          </button>
        </div>
      )}
    </SheetRow>
  );
}
export const FoundWorkSec = memo(FoundWorkSecFn, foundWorkPropsEqual);
