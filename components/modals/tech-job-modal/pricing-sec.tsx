/**
 * components/modals/tech-job-modal/pricing-sec.tsx
 * Pricing / scope section (prototype techJobHtml price branch, 4615-4621).
 */

"use client";

import type { Job } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { jobMode, jobTotal } from "./helpers";

interface PricingSecProps {
  job: Job;
  quoted: boolean;
  onPriceOnSite: () => void;
}

export function PricingSec({ job, quoted, onPriceOnSite }: PricingSecProps) {
  const mode = jobMode(job);
  const heading = mode === "estimate" ? "Scope it" : "Pricing";

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>{heading}</span>
      </div>
      {mode === "estimate" ? (
        <div style={{ fontSize: "var(--type-base)", fontWeight: 700 }}>
          ✦ Scoping visit{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — the office builds the quote
          </span>
        </div>
      ) : quoted ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
          <b style={{ fontSize: "var(--type-md)" }}>✓ Priced — {fmt$(jobTotal(job))}</b>
          <button className="btn sm ghost" onClick={onPriceOnSite}>
            re-price
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ width: "100%", fontSize: "var(--type-md)", padding: "var(--space-3)" }}
          onClick={onPriceOnSite}
        >
          Price it on site →
        </button>
      )}
    </div>
  );
}
