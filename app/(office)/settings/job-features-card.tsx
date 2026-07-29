"use client";

/**
 * Settings → Workspace → Job features card. Org-level toggles that turn whole
 * sections of the job modal on or off, rather than tuning a value inside one.
 *
 * Measurement estimating is the first: only measurement-priced trades (painting
 * etc.) want the job modal's Measurements section at all — a plumbing shop must
 * never see it, not see it empty. Default OFF; existing orgs are unaffected
 * until an owner turns it on.
 */

import { useAppStore } from "@/lib/store/app-store";
import { FoldCard } from "./fold-card";

export function JobFeaturesCard() {
  const setToggle = useAppStore((s) => s.setToggle);
  const measurementEstimating = useAppStore((s) => s.toggles.measurementEstimating);

  return (
    <FoldCard
      title="Job features"
      summary={measurementEstimating ? "measurement estimating on" : undefined}
    >
      <div className="stage-row" style={{ borderTop: "none", marginTop: "0" }}>
        <div style={{ flex: 1 }}>
          <b>Measurement estimating</b>
          <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
            Scan or enter room measurements on jobs, and price from them. For painting and other
            measured trades.
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={measurementEstimating}
            onChange={(e) => setToggle("measurementEstimating", e.target.checked)}
          />
          <i />
        </label>
      </div>
    </FoldCard>
  );
}
