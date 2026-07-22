/**
 * components/modals/tech-job-modal/tech-job-modal.tsx
 * Faithful port of the prototype's techJobHtml (lines 4563-4634) — the TECH /
 * crew's field view of a job, opened from My Day. Same job data as the office
 * job-modal, DIFFERENT rendering: timer-first, no status pill, tappable address,
 * on-site step buttons, price-on-site.
 *
 * This file is the COMPOSITION only. The modal has two states-as-views:
 *   - working view (job not done): FieldTimer hero + WorkOrderSec + PricingSec
 *   - close-out view (job done):   DoneBlock hero + the visit summary line
 * with the shared spine (header, address, visits, found work, checklist, notes)
 * rendered by the section files in this directory.
 */

"use client";

import { useCallback } from "react";
import {
  useActiveModal,
  usePushModal,
  useCloseModal,
  useAppStore,
} from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { MODAL } from "@/lib/store/modal-ids";
import { CopilotSection } from "@/features/field-copilot/copilot-section";
import {
  colLabel,
  currentVisit,
  custNameOf,
  hmLabel,
  invDue,
  jobMode,
  jobQuoted,
  vPlaced,
} from "./helpers";
import { TechHeader } from "./tech-header";
import { FieldTimer } from "./field-timer";
import { VisitRow } from "./visit-row";
import { PricingSec } from "./pricing-sec";
import { WorkOrderSec } from "./work-order-sec";
import { FoundWorkSec } from "./found-work-sec";
import { ChecklistSec } from "./checklist-sec";
import { NoteFeed } from "./note-feed";
import { DoneBlock } from "./done-block";

export function TechJobModalContent() {
  const activeModal = useActiveModal();
  const pushModal = usePushModal();
  const close = useCloseModal();

  // Role gate: this modal is shared by owner/office (full controls) and techs.
  // Controls wired to ownerOrOffice endpoints (visit status, add-ons, payments,
  // send-to-office) would FORBIDDEN + silently roll back for a tech — they are
  // office-only. Fail closed: until the role loads, show the tech (reduced) view.
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";

  // Extract jobId before all store subscriptions so by-id selectors below can
  // capture it in their closure. useActiveModal is already narrow (scalar).
  const jobId = activeModal?.params?.jobId as string | undefined;

  // --- By-id selectors (narrow subscriptions) --------------------------------
  // reconcileJob replaces only the matched entry in jobs.map — untouched jobs
  // keep their object identity, so find(j => j.id === jobId) is referentially
  // stable across unrelated writes. Same pattern for lead and invoice.
  const job = useAppStore((s) => s.jobs.find((j) => j.id === jobId));
  const leadId = job?.leadId;
  const lead = useAppStore((s) => s.leads.find((l) => l.id === leadId));
  // The job's invoice links via invoice.jobId (NOT job.invoiceId).
  const invoice = useAppStore((s) => s.invoices.find((i) => i.jobId === jobId));

  // Store actions — stable function references (Zustand guarantees action
  // identity across renders; selecting them here avoids re-subscribing the
  // parent when only the job object changes).
  const setVisitStatus = useAppStore((s) => s.setVisitStatus);
  const updateJob = useAppStore((s) => s.updateJob);
  const recordPayment = useAppStore((s) => s.recordPayment);
  // Money in the tech view is gated by this permission toggle (a scalar — safe
  // to select directly; never derive an array in a selector).
  const seesPrice = useAppStore((s) => s.toggles.techSeesPrice);
  const addAddon = useAppStore((s) => s.addAddon);
  const addAddonField = useAppStore((s) => s.addAddonField);
  const setAddonStatus = useAppStore((s) => s.setAddonStatus);
  const checkVerifyItem = useAppStore((s) => s.checkVerifyItem);
  const overrideVerifyItem = useAppStore((s) => s.overrideVerifyItem);
  const uncheckVerifyItem = useAppStore((s) => s.uncheckVerifyItem);
  const addJobPhoto = useAppStore((s) => s.addJobPhoto);

  // Derived values computed after all hooks (never inside selectors to avoid
  // creating new object references on every store write).
  const custName = job ? custNameOf(job, lead) : "";
  const addr = (job?.addr || lead?.address || "") as string;
  const quoted = job ? jobQuoted(job) : false;
  const done = job?.status === "done";
  // The tech only sees PLACED visits — never "Invalid Date" rows in the field.
  const placed = (job?.visits ?? []).filter(vPlaced);
  const curVisit = currentVisit(placed);

  // --- useCallback-stabilized handlers for memoized child components ---------
  // These are referentially stable across re-renders when their captured
  // store-action dependencies don't change (store actions are stable by
  // Zustand's contract). jobId is a primitive string — stable once the modal is
  // open. curVisit.id can change, so the reopen handler captures curVisit.

  const onVisitStatus = useCallback(
    (visitId: string, status: string) => {
      if (!jobId) return;
      setVisitStatus(jobId, visitId, status);
    },
    [jobId, setVisitStatus],
  );

  const chargeOnFile = useCallback(() => {
    // charge the balance to the card on file — the "paid before they left" play.
    if (!invoice) return;
    const card = lead?.card;
    const dueNow = invDue(invoice);
    if (dueNow <= 0 || !card) return;
    recordPayment(invoice.id, { amt: dueNow, when: "Just now", method: "card", onFile: true });
  }, [invoice, lead, recordPayment]);

  const openCloseOut = useCallback(() => {
    if (!jobId) return;
    pushModal(MODAL.CLOSE_OUT, { jobId });
  }, [jobId, pushModal]);

  const openInvoiceModal = useCallback(
    (invoiceId: string) => pushModal(MODAL.INVOICE, { invoiceId }),
    [pushModal],
  );

  const sendToOffice = useCallback(() => {
    if (!jobId) return;
    updateJob(jobId, { invRequested: true });
    close();
  }, [jobId, updateJob, close]);

  const onReopen = useCallback(() => {
    if (curVisit) onVisitStatus(curVisit.id, "scheduled");
  }, [curVisit, onVisitStatus]);

  const navigate = useCallback(() => {
    // maps deep-link — open the address in the device's maps app.
    if (addr) window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, "_blank");
  }, [addr]);

  const onPriceOnSite = useCallback(() => {
    if (!jobId) return;
    pushModal(MODAL.TECH_QUOTE, { jobId });
  }, [jobId, pushModal]);

  // Early return AFTER all hooks (rules of hooks).
  if (!job) return null;

  return (
    <div>
      {/* 1. Header — avatar + name + service word + title. NO status pill. */}
      <TechHeader job={job} custName={custName} />

      {/* 2. Call / Text — office only. Techs don't see these at all (leads never
          hydrate under the field shell; the myDay summary carries no customer
          phone). For the office the buttons stay TAPPABLE: the call sheet / thread
          each prompt to add a number in-flow when none is on file. They disable
          only with NO linked customer (nobody to call). */}
      {isOffice && (
        <div style={{ marginBottom: "0" }}>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={!lead}
              title={!lead ? "No linked customer" : undefined}
              onClick={() => {
                if (lead) pushModal(MODAL.CALL, { leadId: lead.id });
              }}
            >
              Call
            </button>
            <button
              className="btn"
              disabled={!lead}
              title={!lead ? "No linked customer" : undefined}
              onClick={() => {
                if (lead) pushModal(MODAL.THREAD, { leadId: lead.id });
              }}
            >
              Text
            </button>
          </div>
        </div>
      )}

      {/* 3. Address — tappable Navigate row, or the muted no-address line. */}
      {addr ? (
        <button className="jaddr" onClick={navigate}>
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}>{addr}</span>
          <span className="nav">Navigate →</span>
        </button>
      ) : (
        <div className="muted" style={{ fontSize: "var(--type-base)", margin: "var(--space-3) 0 var(--space-1)" }}>
          No address on this job yet.
        </div>
      )}

      {/* 4. Field timer (hero when not done) — or the on-site close-out HERO.
          The close-out hero is office-only: charge-on-file / take-payment /
          send-to-office all write through ownerOrOffice endpoints. */}
      {done ? (
        isOffice ? (
          <DoneBlock
            job={job}
            lead={lead}
            invoice={invoice}
            onOpenCloseOut={openCloseOut}
            onOpenInvoice={openInvoiceModal}
            onChargeOnFile={chargeOnFile}
            onSendToOffice={sendToOffice}
            onReopen={onReopen}
          />
        ) : null
      ) : curVisit ? (
        <FieldTimer key={curVisit.id} visit={curVisit} />
      ) : null}

      {/* Work order (5a) — install job, not done, with scope lines (office-sold). */}
      {jobMode(job) === "install" &&
      !done &&
      (job.lines ?? []).some((l) => (l.d ?? "").trim()) ? (
        <WorkOrderSec job={job} seesPrice={seesPrice} />
      ) : null}

      {/* 5. Your visit(s). */}
      <div className="fsec">
        <div className="fsec-h">
          <span>Your visit{placed.length > 1 ? "s" : ""}</span>
          {done && (
            <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Done</span>
          )}
        </div>
        {done ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
            <span className="muted" style={{ fontSize: "var(--type-base)" }}>
              {curVisit
                ? `${colLabel(curVisit.date)} · ~${hmLabel(curVisit.dur)} on site`
                : "Completed"}
            </span>
            {/* Reopen writes visit status (ownerOrOffice) — office only. */}
            {isOffice && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  if (curVisit) onVisitStatus(curVisit.id, "scheduled");
                }}
              >
                ↩ Reopen
              </button>
            )}
          </div>
        ) : placed.length ? (
          placed.map((v) => (
            <VisitRow
              key={v.id}
              visit={v}
              quoted={quoted}
              readOnly={!isOffice}
              onStatus={(status) => onVisitStatus(v.id, status)}
            />
          ))
        ) : (
          <div className="empty-att" style={{ marginBottom: "0" }}>
            Not scheduled yet — the office will set the time.
          </div>
        )}
      </div>

      {/* 6. Pricing / Scope (only when not done). */}
      {!done && (
        <PricingSec
          job={job}
          quoted={quoted}
          onPriceOnSite={onPriceOnSite}
        />
      )}

      {/* Copilot (field AI advisor — camera + ask + found-work card). Tech only. */}
      {!isOffice && jobId && (
        <CopilotSection job={job} addAddonField={addAddonField} />
      )}

      {/* Found work / add-ons (5b) — read-only for techs (add + status are office writes). */}
      <FoundWorkSec
        job={job}
        seesPrice={seesPrice}
        readOnly={!isOffice}
        addAddon={addAddon}
        setAddonStatus={setAddonStatus}
      />

      {/* 7. Before you leave — attached checklist, INTERACTIVE (5c). */}
      <ChecklistSec
        job={job}
        checkItem={checkVerifyItem}
        overrideItem={overrideVerifyItem}
        uncheckItem={uncheckVerifyItem}
        addPhoto={addJobPhoto}
      />

      {/* 8. Notes feed — office composes while the job is open (same gate as
          Call/Text; the server refuses note edits once the job is complete). */}
      <NoteFeed job={job} canCompose={isOffice && !done} updateJob={updateJob} />

      {/* Close — a real full-width Done so the field view isn't dismissable only
          via the tiny shell ✕ (every other modal ends with a primary action). */}
      <div style={{ display: "flex", marginTop: "var(--space-5)" }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
