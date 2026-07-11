/**
 * components/modals/visit-modal.tsx
 * "Book a visit" off a lead — mirrors the New-customer modal's book-a-visit flow
 * (Job description → Job / Estimate-visit chips → Build the price [Job] → Service
 * address), NOT a scheduling sheet. Creates an unscheduled Job (+ visit) or an
 * unscheduled estimate visit on the lead; the crew, day & time are set later on
 * the Schedule board — same as creating one from customer creation.
 */

"use client";

import { useMemo, useState } from "react";
import {
  useAppStore,
  useActiveModal,
  useCloseModal,
  useOpenModal,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead } from "@/lib/store/types";

/** Guess the visit type from the request wording (prototype qaPurposeGuess). */
function guessPurpose(txt: string): "job" | "look" {
  const t = (txt || "").toLowerCase();
  if (!t.trim()) return "job";
  if (/looks like|maybe|not sure|might be|possibl|no idea|i think|\?|diagnos|take a look|come look|quote|estimate|bid|install|replace/.test(t)) {
    return "look";
  }
  return "job";
}

type Purpose = "job" | "look";

export function VisitModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();

  const leads = useAppStore((s) => s.leads);
  const addEvisit = useAppStore((s) => s.addEvisit);
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const updateLead = useAppStore((s) => s.updateLead);

  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead: Lead | undefined = leads.find((l) => l.id === leadId);

  const initialPurpose = useMemo(() => guessPurpose(lead?.job ?? ""), [lead?.job]);
  const [purpose, setPurpose] = useState<Purpose>(initialPurpose);
  const [jobDesc, setJobDesc] = useState(lead?.job ?? "");
  const [addr, setAddr] = useState(lead?.address ?? "");

  if (!lead) return null;

  // Cancel / ✕ returns to the modal it was opened from (the lead), not a dead end.
  function cancel() {
    const returnTo = activeModal?.params?.returnTo as string | undefined;
    if (returnTo === MODAL.LEAD && lead) openModal(MODAL.LEAD, { leadId: lead.id });
    else close();
  }

  /** Persist the edited job wording + address back onto the lead. */
  function syncLead() {
    if (!lead) return;
    const patch: Partial<Lead> = {};
    const d = jobDesc.trim();
    if (d && d !== lead.job) patch.job = d;
    const a = addr.trim();
    if (a !== (lead.address ?? "")) patch.address = a;
    if (Object.keys(patch).length) updateLead(lead.id, patch);
  }

  /** Create the job (unscheduled) + an unplaced visit — same as the New-customer
   *  "Create job" path; the crew & time get set on the Schedule board.
   *
   *  The visit-modal always has a real lead FK (lead.id), so addJob will persist.
   *  We do NOT await persisted here because the visit-modal's lead already exists
   *  in the DB, so addJob will fire create immediately; the visit is queued
   *  optimistically (addVisit guards on origin === "db" for the network call, but
   *  the optimistic row is added either way). This keeps the modal instant. */
  function createJobForLead(): Job {
    const { job } = addJob({
      leadId: lead!.id,
      svc: "service",
      origin: "manual",
      title: jobDesc.trim() || lead!.job || "Site visit",
      addr: addr.trim() || lead!.address || "",
      phone: lead!.phone ?? "",
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: "",
      acts: [],
      visits: [],
    });
    addVisit(job.id); // unplaced — dragged onto the Schedule later
    return job;
  }

  /** "✦ Build the price →" (Job only) — create the job, then hand off to the same
   *  price builder the crew uses (mirrors New-customer handleBuildPrice). */
  function buildPrice() {
    syncLead();
    const job = createJobForLead();
    close();
    openModal(MODAL.PRICE_BUILDER, { jobId: job.id, returnTo: MODAL.JOB });
  }

  function submit() {
    syncLead();
    if (purpose === "look") {
      // Estimate visit — an unscheduled estimate visit on the lead (scope, then quote).
      addEvisit(lead!.id, {
        date: null,
        techId: null,
        start: null,
        dur: 1,
        status: "scheduled",
        scopeNotes: jobDesc.trim(),
      });
      openModal(MODAL.LEAD, { leadId: lead!.id });
      return;
    }
    const job = createJobForLead();
    close();
    openModal(MODAL.JOB, { jobId: job.id });
  }

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>Book a visit</h2>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>
        {lead.name}
      </p>

      {/* Job description */}
      <div className="field">
        <label>Job</label>
        <input
          type="text"
          placeholder="water heater making noise"
          value={jobDesc}
          onChange={(e) => setJobDesc(e.target.value)}
        />
      </div>

      {/* Purpose — Job (priced on the visit) vs Estimate visit (scope, then quote) */}
      <div className="chips" style={{ marginBottom: 4 }}>
        <button
          type="button"
          className={`chip${purpose === "job" ? " sel" : ""}`}
          onClick={() => setPurpose("job")}
        >
          Job
        </button>
        <button
          type="button"
          className={`chip${purpose === "look" ? " sel" : ""}`}
          onClick={() => setPurpose("look")}
        >
          Estimate visit
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
        {purpose === "job"
          ? "Diagnosed & priced on the visit."
          : "Scoped on site, then quoted — no job until they say yes."}
      </p>

      {/* Price (Job only) — build it now with the crew's builder, or price later */}
      {purpose === "job" && (
        <div className="field">
          <label>
            Price{" "}
            <span className="muted" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
              (optional)
            </span>
          </label>
          <button
            type="button"
            className="btn"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={buildPrice}
          >
            ✦ Build the price →
          </button>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Same builder your crew uses — or price later.
          </div>
        </div>
      )}

      {/* Service address */}
      <div className="field">
        <label>Service address</label>
        <input
          type="text"
          placeholder="leave blank and we'll text for it"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button className="btn ghost" onClick={cancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit}>
          {purpose === "look" ? "Book the estimate visit →" : "Create the job →"}
        </button>
      </div>
    </div>
  );
}
