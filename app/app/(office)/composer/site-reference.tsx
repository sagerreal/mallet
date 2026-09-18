/**
 * app/(office)/composer/site-reference.tsx
 * FROM THE SITE — what the technician brought back, beside the quote being built from it.
 *
 * The tech→office estimating lane had a working handoff signal (scope notes make the board card
 * say "Needs quote") and a blind destination: the composer opened EMPTY, and the office quoted a
 * job whose notes, photos and checklist answers were three modals away. Both incumbents keep the
 * assessment on the quoting screen — Jobber renders the request's details as a reference panel
 * beside the quote as you build it; ServiceTitan attaches the tech's forms and photos to the job
 * the estimate hangs off. Speed is the point: quotes delivered within hours of the walkthrough
 * close at roughly half again the rate of next-day ones, and hunting through modals for what the
 * tech saw is where that time goes.
 *
 * READ-ONLY ON PURPOSE. This card informs the quote; it never writes it. Auto-drafting lines from
 * scope is the learning estimator's job, invoked deliberately — a reference that silently became
 * content would put words in the technician's mouth.
 *
 * Renders nothing when the picked customer has no scoped walkthrough — most quotes are not this
 * lane, and an empty "From the site" card would be noise on every one of them.
 */

"use client";

import { useAppStore, usePushModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { scopedEstimateVisitWithJob } from "@/features/pipeline/pipeline-utils";

export function SiteReference({ leadId }: { leadId: string | null }) {
  const jobs = useAppStore((s) => s.jobs);
  const pushModal = usePushModal();

  const scoped = leadId ? scopedEstimateVisitWithJob(leadId, jobs) : undefined;
  if (!scoped) return null;

  const { job, visit } = scoped;
  const photoCount = (job.photos ?? []).length;
  const cl = job.checklist;
  const ans = job.verify?.ans ?? {};
  const items = (cl?.items ?? []).filter((it) => (it.text ?? "").trim());
  const done = items.filter((it) => ans[it.id]).length;

  return (
    <div className="fsec" style={{ marginBottom: "var(--space-4)" }}>
      <div className="fsec-h">
        <span>From the site</span>
        <button
          type="button"
          className="linklike"
          style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}
          onClick={() => pushModal(MODAL.TECH_JOB, { jobId: job.id })}
        >
          open the walkthrough ›
        </button>
      </div>
      <div className="card">
        {visit.scopeNotes ? (
          <p style={{ margin: 0, fontSize: "var(--type-base)", whiteSpace: "pre-wrap" }}>
            {visit.scopeNotes}
          </p>
        ) : null}

        {photoCount > 0 ? (
          <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: "var(--type-sm)" }}>
            📷 {photoCount} photo{photoCount === 1 ? "" : "s"} on the walkthrough
          </p>
        ) : null}

        {items.length > 0 ? (
          <div style={{ marginTop: "var(--space-3)" }}>
            <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}>
              {cl!.name} · {done} of {items.length}
            </div>
            {items.map((it) => (
              <div
                key={it.id}
                style={{
                  display: "flex",
                  gap: "var(--space-2)",
                  fontSize: "var(--type-sm)",
                  color: ans[it.id] ? "var(--ink-2)" : "var(--ink-3)",
                  marginTop: "var(--space-1)",
                }}
              >
                <span>{ans[it.id] ? "✓" : "—"}</span>
                <span style={{ flex: 1 }}>
                  {it.text}
                  {/* A skipped REQUIRED step is exactly what the office needs to see before
                      pricing — an unmeasured run is a quote that comes back wrong. */}
                  {!ans[it.id] && it.required ? " · not recorded" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
