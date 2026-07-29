/**
 * components/modals/tech-job-modal/tech-header.tsx
 * The sheet header (sheet grammar): the customer's name as the modal's <h2> over
 * one calm .sheet-meta line — service word (colored) + job title (when ≠ name).
 * Sticky via .sheet-head, so the job you are looking at never scrolls away.
 * NO status pill — this is the tech's own view.
 */

"use client";

import type { Job } from "@/lib/store/types";
import { svcMeta, jobMode } from "./helpers";

export function TechHeader({ job, custName }: { job: Job; custName: string }) {
  const meta = svcMeta(jobMode(job));
  const showTitle = custName !== job.title;

  return (
    <div className="sheet-head">
      <h2>{custName}</h2>
      <div className="sheet-meta">
        <span
          style={{
            fontSize: "var(--type-xs)",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            color: meta.c,
          }}
        >
          {meta.word}
        </span>
        {showTitle && (
          <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{job.title}</span>
        )}
      </div>
    </div>
  );
}
