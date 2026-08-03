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
  usePushModal,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead } from "@/lib/store/types";
import { Field, FieldGroup } from "@/components/ui/input";

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
  const pushModal = usePushModal();

  const leads = useAppStore((s) => s.leads);
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const updateLead = useAppStore((s) => s.updateLead);

  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead: Lead | undefined = leads.find((l) => l.id === leadId);

  const initialPurpose = useMemo(() => guessPurpose(lead?.job ?? ""), [lead?.job]);
  const [purpose, setPurpose] = useState<Purpose>(initialPurpose);
  const [jobDesc, setJobDesc] = useState(lead?.job ?? "");
  const [addr, setAddr] = useState(lead?.address ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!lead) return null;

  // Cancel / ✕ pops back to the modal that pushed this one (the lead) — the
  // back-stack owns the return, no returnTo params needed.
  function cancel() {
    close();
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
   *  addJob returns { job, persisted } — we MUST await `persisted` before calling
   *  addVisit so the job has origin === "db" and addVisit fires v1.visits.createVisit.
   *  Without the await the visit is added while the job is still "manual" and is
   *  silently dropped by addVisit's origin guard on the next page refresh.
   *
   *  Returns the optimistic Job on success, or null on failure (error already set).
   */
  async function createJobForLead(kind: "service" | "estimate" = "service"): Promise<Job | null> {
    const { job, persisted } = addJob({
      leadId: lead!.id,
      kind: kind === "estimate" ? "estimate" : "work",
      svc: "",
      origin: "manual",
      title: jobDesc.trim() || lead!.job || (kind === "estimate" ? "Estimate visit" : "Site visit"),
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

    // Await the job reconcile (origin flips to "db") before adding the visit so that
    // addVisit sees origin === "db" and fires v1.visits.createVisit.
    try {
      await persisted;
    } catch {
      setError("Couldn't save the job — check your connection and try again.");
      return null;
    }

    addVisit(job.id); // unplaced — dragged onto the Schedule later
    return job;
  }

  /** "✦ Build the price →" (Job only) — create the job, then hand off to the same
   *  price builder the crew uses (mirrors New-customer handleBuildPrice). */
  async function buildPrice() {
    syncLead();
    const job = await createJobForLead();
    if (!job) return; // error already set; modal stays open
    close();
    // Land the builder ON the new job: ✕ / Done pop back to the job modal.
    openModal(MODAL.JOB, { jobId: job.id });
    pushModal(MODAL.PRICE_BUILDER, { jobId: job.id });
  }

  async function submit() {
    syncLead();
    if (purpose === "look") {
      // Estimate visit — a REAL job (svc "estimate") with an unplaced visit. It used to be
      // a client-store-only "evisit" on the lead: gone on refresh, invisible to the
      // schedule window, ignored by crew-load and conflict checks — a placed walkthrough
      // could double-book a tech with no warning. As a job it rides every server path the
      // board already trusts.
      const job = await createJobForLead("estimate");
      if (!job) return; // error already set; modal stays open
      close(); // pop back to the lead that pushed this sheet
      return;
    }
    const job = await createJobForLead();
    if (!job) return; // error already set; modal stays open
    close();
    openModal(MODAL.JOB, { jobId: job.id });
  }

  return (
    <>
      {/* Sticky sheet header — the title never scrolls away on a tall sheet. */}
      <div className="sheet-head">
        <h2>Book a visit</h2>
        <div className="sheet-meta">
          <span>{lead.name}</span>
        </div>
      </div>

      {/* Job description */}
      <Field label="Job">
        <input
          type="text"
          placeholder="water heater making noise"
          value={jobDesc}
          onChange={(e) => setJobDesc(e.target.value)}
        />
      </Field>

      {/* Purpose — Job (priced on the visit) vs Estimate visit (scope, then quote) */}
      <div className="chips" style={{ marginBottom: "var(--space-1)" }}>
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
      <p className="muted" style={{ fontSize: "var(--type-sm)", marginBottom: "var(--space-4)" }}>
        {purpose === "job"
          ? "Diagnosed & priced on the visit."
          : "Scoped on site, then quoted — no job until they say yes."}
      </p>

      {/* Price (Job only) — build it now with the crew's builder, or price later.
          A caption over a button, not a form field — see new-customer-modal. */}
      {purpose === "job" && (
        <FieldGroup
          label="Price"
          hint={
            <span className="muted" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
              (optional)
            </span>
          }
        >
          <button
            type="button"
            className="btn"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={buildPrice}
          >
            ✦ Build the price →
          </button>
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
            Same builder your crew uses — or price later.
          </div>
        </FieldGroup>
      )}

      {/* Service address */}
      <Field label="Service address">
        <input
          type="text"
          placeholder="leave blank and we'll text for it"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
      </Field>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{error}</p>
      )}

      {/* Sticky footer — ONE filled primary docked where the thumb is; Cancel
          stays quiet beside it. The label follows the purpose chip so the button
          states what it creates. Two-button foot (#362): `.sheet-pri` is
          width:100% at the class level, so beside Cancel it takes flex:1 /
          width:auto and Cancel keeps its intrinsic width — otherwise the flex
          line is over-constrained and the primary crushes into Cancel. */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button className="btn ghost" style={{ flexShrink: 0, minHeight: 44 }} onClick={cancel}>
          Cancel
        </button>
        <button className="sheet-pri" style={{ flex: 1, width: "auto" }} onClick={submit}>
          {purpose === "look" ? "Book the estimate visit →" : "Create the job →"}
        </button>
      </div>
    </>
  );
}
