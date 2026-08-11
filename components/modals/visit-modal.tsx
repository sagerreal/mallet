/**
 * components/modals/visit-modal.tsx
 * "Book a visit" off a lead — NOT a scheduling sheet. Creates an unscheduled job
 * (+ an unplaced visit) on the lead; the crew, day & time are set later on the
 * Schedule board.
 *
 * ONE form, no Job/Estimate chips — the kind DERIVES from the foot, exactly as
 * the New-job modal's:
 *
 *   Create job          → the job as written, no price yet (kind "estimate" —
 *                         scoped on site, then quoted). Pops back to the lead.
 *   Create & price it → → kind "work", then straight into Build the price ON
 *                         the new job's sheet (✕ / Price later still leave the
 *                         job standing).
 */

"use client";

import { useRef, useState } from "react";
import {
  useAppStore,
  useActiveModal,
  useCloseModal,
  useOpenModal,
  usePushModal,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead } from "@/lib/store/types";
import { Field } from "@/components/ui/input";

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

  const [jobDesc, setJobDesc] = useState(lead?.job ?? "");
  const [addr, setAddr] = useState(lead?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  // ONE create per press — same production incident as the New-job modal (three impatient
  // clicks minted three jobs); the ref is checked synchronously because `disabled` only
  // lands on the next render.
  const inFlightRef = useRef(false);
  const [savingPath, setSavingPath] = useState<null | "plain" | "priced">(null);
  const saving = savingPath !== null;

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

  /** Create the job (unscheduled) + an unplaced visit — same as the New-job modal's
   *  create; the crew & time get set on the Schedule board. The kind derives from
   *  which exit ran: priced → "work", plain → "estimate".
   *
   *  addJob returns { job, persisted } — addVisit MUST run after `persisted` settles
   *  so the job has origin === "db" and addVisit fires v1.visits.createVisit.
   *  Earlier, and the visit is added while the job is still "manual" and is
   *  silently dropped by addVisit's origin guard on the next page refresh. The
   *  QUEUE is the requirement, not the caller waiting: the priced exit returns
   *  immediately (the builder opens on the client-authored id) while the visit
   *  still rides the settled create in the background.
   *
   *  Returns the optimistic Job on success, or null on failure (plain exit only —
   *  its error lands in this modal; the priced exit's failure surface is the
   *  builder's not-loaded notice).
   */
  async function createJobForLead(priced: boolean): Promise<Job | null> {
    const { job, persisted } = addJob({
      leadId: lead!.id,
      kind: priced ? "work" : "estimate",
      svc: "",
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

    // The visit queues behind the job reconcile (origin flips to "db") on every path —
    // addVisit is store-only before that, and the row would be silently dropped on refresh.
    const settled = persisted.then((persistedJob) => {
      addVisit(job.id); // unplaced — dragged onto the Schedule later
      return persistedJob;
    });

    if (priced) {
      // The priced exit is OPTIMISTIC — the price builder needs only the client-authored id,
      // which exists now, so the sheets land without waiting the create's round trip (same
      // hand-off as the New-job modal's "Create & price it"). A save inside the window queues
      // behind the create (setJobLines' pending-create gate); a refused create rolls the job
      // back and the builder shows its not-loaded notice — visible, never silent.
      void settled.catch(() => undefined);
      return job;
    }

    // The plain exit pops back to the lead sheet, which has nowhere to say "the job didn't
    // save" — so it keeps its await and names the failure here.
    try {
      await settled;
    } catch {
      setError("Couldn't save the job — check your connection and try again.");
      return null;
    }
    return job;
  }

  async function submit(priced: boolean) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSavingPath(priced ? "priced" : "plain");
    try {
      syncLead();
      const job = await createJobForLead(priced);
      if (!job) return; // error already set; modal stays open
      close(); // pop back to the lead that pushed this sheet
      if (priced) {
        // Land the builder ON the new job: ✕ / Price later pop back to its sheet, and
        // saving BOOKS the price (the price builder flips kind if ever needed — here it
        // is already "work").
        openModal(MODAL.JOB, { jobId: job.id });
        pushModal(MODAL.PRICE_BUILDER, { jobId: job.id });
      }
    } finally {
      inFlightRef.current = false;
      setSavingPath(null);
    }
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

      {/* Sticky footer — the fork lives HERE, not in a purpose chip (the New-job foot's
          grammar): Cancel (quiet, intrinsic) · Create job (bordered — scoped on site,
          then quoted) · Create & price it (filled primary). The two creates split the
          remaining width; `.sheet-pri` is width:100% at the class level so it takes
          flex:1 / width:auto here. */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button
          className="btn ghost"
          style={{ flexShrink: 0, minHeight: 44 }}
          onClick={cancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="btn"
          style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
          onClick={() => void submit(false)}
          disabled={saving}
        >
          {savingPath === "plain" ? "Creating…" : "Create job"}
        </button>
        <button
          className="sheet-pri"
          style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
          onClick={() => void submit(true)}
          disabled={saving}
        >
          {savingPath === "priced" ? "Creating…" : "Create & price it →"}
        </button>
      </div>
    </>
  );
}
