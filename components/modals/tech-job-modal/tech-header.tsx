/**
 * components/modals/tech-job-modal/tech-header.tsx
 * Header (prototype techJobHtml header, 4593-4597) — avatar + customer name +
 * a row: service word (colored) + job title (when ≠ name). NO status pill —
 * this is the tech's own view.
 */

"use client";

import type { Job } from "@/lib/store/types";
import { svcMeta, jobMode, initialsOf } from "./helpers";

export function TechHeader({ job, custName }: { job: Job; custName: string }) {
  const meta = svcMeta(jobMode(job));
  const showTitle = custName !== job.title;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
      <div
        className="avatar"
        style={{
          width: 42,
          height: 42,
          background: "var(--green-100)",
          color: "var(--green-900)",
          fontSize: "var(--type-md)",
        }}
      >
        {initialsOf(custName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ marginBottom: "var(--space-1)" }}>{custName}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
            <span style={{ fontWeight: 600, fontSize: "var(--type-base)", color: "var(--ink-2)" }}>
              {job.title}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
