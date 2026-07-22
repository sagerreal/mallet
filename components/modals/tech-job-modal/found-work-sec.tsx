/**
 * components/modals/tech-job-modal/found-work-sec.tsx
 * Found work / add-ons (prototype aoSection, 3826-3837) — one .stage-row per
 * addon: bold desc + ($r when techSeesPrice) + a status stpill; proposed rows
 * get "✓ Customer OK'd" / "✕". Below, an add-form with a desc input + (price
 * input when techSeesPrice) + Add. LOCAL controlled inputs.
 */

"use client";

import { memo, useState } from "react";
import type { Addon, Job } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { AO_INPUT } from "./helpers";

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
  addAddon: (jobId: string, draft: { d: string; r: number }) => Addon | null;
  setAddonStatus: (jobId: string, addonId: number, status: Addon["status"]) => void;
}

// FoundWorkSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.addons and job.id.
export function foundWorkPropsEqual(a: FoundWorkSecProps, b: FoundWorkSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.readOnly === b.readOnly &&
    a.addAddon === b.addAddon &&
    a.setAddonStatus === b.setAddonStatus &&
    a.job.id === b.job.id &&
    a.job.addons === b.job.addons
  );
}

function FoundWorkSecFn({ job, seesPrice, readOnly, addAddon, setAddonStatus }: FoundWorkSecProps) {
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");

  const addons = job.addons ?? [];
  const awaiting = addons.filter((a) => a.status === "proposed").length;

  // Read-only with nothing to read = nothing to render (no dead empty section).
  if (readOnly && addons.length === 0) return null;

  function submit() {
    const d = desc.trim();
    if (!d) return;
    addAddon(job.id, { d, r: +price || 0 });
    setDesc("");
    setPrice("");
  }

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Found work / add-ons</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
          {addons.length}
          {awaiting ? ` · ${awaiting} awaiting OK` : ""}
        </span>
      </div>

      {addons.map((a) => (
        <div key={a.id} className="stage-row">
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 600 }}>{a.d}</b>
            {/* a.r === null = server-redacted (techSeesPrice off) — show nothing, never $0. */}
            {seesPrice && a.r != null && <span className="muted"> · {fmt$(a.r)}</span>}
          </div>
          <AddonStatusPill status={a.status} />
          {!readOnly && a.status === "proposed" && (
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

      {!readOnly && (
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
          <button className="btn sm primary" onClick={submit}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
export const FoundWorkSec = memo(FoundWorkSecFn, foundWorkPropsEqual);
