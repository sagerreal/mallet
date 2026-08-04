/**
 * components/modals/tech-job-modal/tech-job-modal.tsx
 * Faithful port of the prototype's techJobHtml (lines 4563-4634) — the TECH /
 * crew's field view of a job, opened from My Day. Same job data as the office
 * job-modal, DIFFERENT rendering: timer-first, no status pill, tappable address,
 * on-site step buttons, price-on-site.
 *
 * This file is the COMPOSITION only, in the sheet grammar: a sticky .sheet-head
 * (customer name + job meta), Call/Text as a .sheet-secrow, the in-flow spine
 * (address, visits, pricing, found work, checklist, notes — the section files in
 * this directory), and ONE sticky .sheet-foot primary. Two states-as-views:
 *   - working view (job not done): the address + the visit row are the hero;
 *     the foot primary is a plain Done (the step buttons are per-visit and
 *     assignment-gated, so they stay on their rows)
 *   - close-out view (job done, office): DoneBlock status card in-body; the
 *     branch's terminal action (charge on file / take payment / send to the
 *     office) IS the foot primary — see doneFootAction.
 *
 * There is no timer here. The one that used to be the hero was local React state that persisted
 * nothing — it lost the technician's time on every remount and never reached a timesheet. His hours
 * come from the day clock on My day plus these visit taps, which write real time entries.
 *
 * Estimating part 3: the view is tabbed — Job (the spine above) · Quote (quote-tab.tsx:
 * scope notes + photos + room scan, the embedded price builder, the estimate-visit dual exit).
 * No Hours tab: hours never lived in this modal (see the no-timer note above). The tabs are
 * SURFACE-based, not role-based: this modal's only entry is My day, and an owner-operator
 * scoping their own walkthrough needs the Quote tab exactly as a tech does (every endpoint
 * the tab writes through is anyRole). Per-CONTROL gates inside the spine stay role-based.
 */

"use client";

import { useCallback, useState } from "react";
import {
  useActiveModal,
  usePushModal,
  useCloseModal,
  useAppStore,
} from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { useOrgServiceFee } from "@/features/settings/use-org-service-fee";
import { VISIT_FEE_TITLE } from "@/features/invoices/visit-fee";
import type { VisitWriteSurface } from "@/lib/store/visit-status-write";
import { MODAL } from "@/lib/store/modal-ids";
import { CopilotSection } from "@/features/field-copilot/copilot-section";
import { fmt$ } from "@/lib/format";
import {
  colLabel,
  currentVisit,
  custNameOf,
  hmLabel,
  invDue,
  isUnpricedEstimate,
  jobMode,
  jobQuoted,
  jobTotal,
  vPlaced,
} from "./helpers";
import { TechHeader } from "./tech-header";
import { VisitRow } from "./visit-row";
import { WorkOrderSec } from "./work-order-sec";
import { FoundWorkSec } from "./found-work-sec";
import { ChecklistSec } from "./checklist-sec";
import { NoteFeed } from "./note-feed";
import { DoneBlock, ScopeHandoffBlock, doneFootAction } from "./done-block";
import { QuoteTab } from "./quote-tab";

/** The modal's two tabs. Hours are NOT a tab here on purpose — the clock lives on
 *  My day (day clock) + the visit step taps; this modal never carried a timer. */
type TechTab = "job" | "quote";

export function TechJobModalContent() {
  const activeModal = useActiveModal();
  const pushModal = usePushModal();
  const close = useCloseModal();

  // Tabs for EVERY role: Job (the working spine) · Quote (scope + the price
  // builder — estimating part 3). The Quote tab is this surface's one pricing
  // home; per-control gates inside the Job tab stay role-based below.
  const [tab, setTab] = useState<TechTab>("job");

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
  // Visit-fee collection (Task 5, rebuilt after review): the fee is a LEAD-tied MANUAL invoice
  // (addInvoice with jobId: null + sendInvoice) — never job-tied. invoices.source_job_id
  // carries a partial unique index (one active invoice per job); a job-tied fee invoice would
  // permanently claim that slot, so a later quote-accept converting this same job could never
  // raise its real bill (createFromJob's idempotent findBySourceJob would just hand back the
  // $89 fee draft forever). job.lines is never touched by this flow.
  const addInvoice = useAppStore((s) => s.addInvoice);
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const sendInvoice = useAppStore((s) => s.sendInvoice);
  const removeLocalInvoice = useAppStore((s) => s.removeLocalInvoice);
  // Durable re-collection guard: any non-archived invoice for THIS LEAD titled VISIT_FEE_TITLE.
  // Title + leadId survive reload (both come through the invoices hydrator); jobId does not —
  // the server never stamps sourceJobId on a manual invoice, so it's checked only when the
  // local record still happens to carry it (see the local patch in collectVisitFee below).
  const hasFeeInvoice = useAppStore((s) =>
    s.invoices.some(
      (i) =>
        i.leadId === leadId &&
        i.title === VISIT_FEE_TITLE &&
        !i.archived &&
        (i.jobId == null || i.jobId === jobId),
    ),
  );

  // Derived values computed after all hooks (never inside selectors to avoid
  // creating new object references on every store write).
  const custName = job ? custNameOf(job, lead) : "";
  const addr = (job?.addr || lead?.address || "") as string;
  const quoted = job ? jobQuoted(job) : false;
  const done = job?.status === "done";
  // The tech only sees PLACED visits — never "Invalid Date" rows in the field.
  const placed = (job?.visits ?? []).filter(vPlaced);
  const curVisit = currentVisit(placed);
  // Guarded, null-safe re-derivation of isUnpricedEstimate for use BEFORE the early return
  // below (hooks must run unconditionally) — the fee-fetch effect needs to know whether a
  // scoping visit's handoff will actually need the org's fee. `scoping` below (after the
  // return) reuses this exact value; job is guaranteed non-null there.
  const scopingCandidate = job ? isUnpricedEstimate(job) : false;

  // The field shell never mounts SettingsHydrator (it only mounts in the office layout — see
  // features/settings/use-org-service-fee.ts), so `booking.serviceFee` in the store is never
  // hydrated on this surface. Fetch the real fee once, only when the fee button could actually
  // render: a done, unpriced-estimate visit, viewed by office/owner (billing writes are
  // ownerOrOffice-only server-side — a tech could never collect it anyway).
  const orgServiceFee = useOrgServiceFee(done && isOffice && scopingCandidate);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);

  // --- useCallback-stabilized handlers for memoized child components ---------
  // These are referentially stable across re-renders when their captured
  // store-action dependencies don't change (store actions are stable by
  // Zustand's contract). jobId is a primitive string — stable once the modal is
  // open. curVisit.id can change, so the reopen handler captures curVisit.

  // Which API the visit writes go to. A tech's taps must reach the assignment-gated field
  // endpoints — those are the ones that also move his clock; owner/office keep v1.visits.
  const visitSurface: VisitWriteSurface = isOffice ? "office" : "field";

  const onVisitStatus = useCallback(
    (visitId: string, status: string) => {
      if (!jobId) return;
      setVisitStatus(jobId, visitId, status, visitSurface);
    },
    [jobId, setVisitStatus, visitSurface],
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

  // Collect the org's visit fee on a declined estimate visit (Task 5, rebuilt after review).
  // Raised as a LEAD-tied MANUAL invoice — addInvoice with jobId: null keeps it off the
  // fromJob/createFromJob path entirely (that path is also refused outright for a genuinely
  // unpriced estimate — see CreateInvoiceFromJobUseCase — and, worse, claims the job's one
  // invoice slot via source_job_id's partial unique index). job.lines is never touched. Does
  // NOT open the close-out sheet until the send has genuinely completed — a failed send must
  // never leave the tech staring at a dead/empty payment sheet.
  const collectVisitFee = useCallback(async () => {
    if (!job || !jobId || feeBusy) return;
    const fee = orgServiceFee ?? 0;
    if (fee <= 0) return; // no $0 fee collection — mirrors the button's own render guard
    setFeeError(null);
    setFeeBusy(true);
    const inv = addInvoice({
      jobId: null, // manual path — never claims this job's one invoice slot
      leadId: job.leadId,
      cust: custName,
      phone: job.phone || lead?.phone || "",
      title: VISIT_FEE_TITLE,
      lines: [{ d: VISIT_FEE_TITLE, q: 1, r: fee }],
      total: fee,
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
    // Best-effort local hint for the guard above and for close-out's invoice lookup during
    // THIS session — the send below's server reconcile will overwrite it back to null (the
    // domain never sets sourceJobId on a manual invoice), so it is never the durable signal;
    // the invoiceId passed to CLOSE_OUT below is what close-out actually relies on.
    updateInvoice(inv.id, { jobId });
    const { ok, error } = await sendInvoice(inv.id);
    setFeeBusy(false);
    if (!ok) {
      // The optimistic draft never reached the server (sendInvoice's own rollback reverts it
      // to its pre-send "manual" snapshot on any failure, including one after a partially
      // successful draft+send sequence — see sendInvoice's catch). Left in the store it would
      // satisfy hasFeeInvoice's lead+title guard forever, permanently hiding this retry button
      // until reload, while also leaking into the Money ledger and the office job-modal (which
      // still matches it via the un-reconciled local jobId hint above).
      removeLocalInvoice(inv.id);
      setFeeError(error || "Couldn't send the fee invoice — check your connection and try again.");
      return;
    }
    pushModal(MODAL.CLOSE_OUT, { jobId, invoiceId: inv.id });
  }, [
    job,
    jobId,
    lead,
    custName,
    orgServiceFee,
    feeBusy,
    addInvoice,
    updateInvoice,
    sendInvoice,
    removeLocalInvoice,
    pushModal,
  ]);

  const navigate = useCallback(() => {
    // maps deep-link — open the address in the device's maps app.
    if (addr) window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, "_blank");
  }, [addr]);

  // Early return AFTER all hooks (rules of hooks).
  if (!job) return null;

  // A done, unpriced ESTIMATE is a finished scoping visit — its close-out is a
  // scope handoff, never a billing branch. Signed-on-site estimates carry priced
  // lines, fall out of this predicate, and keep the payment close-out.
  // (scopingCandidate was computed off this exact job earlier in this render, pre-return.)
  const scoping = scopingCandidate;
  const hasScope = placed.some((v) => Boolean(v.scopeNotes?.trim()));

  // --- The ONE foot primary (sheet grammar) ----------------------------------
  // Close-out states hand the DoneBlock branch's terminal action to the sticky
  // foot; every other state gets a plain full-width Done so the field view is
  // never dismissable only via the tiny shell ✕. All non-destructive. An
  // unpriced estimate never gets a billing foot — its close-out is the handoff.
  const footKind = done && isOffice && !scoping ? doneFootAction(job, lead, invoice) : null;
  const footDue = invoice ? invDue(invoice) : jobTotal(job);
  const footCard = lead?.card;
  const footPri =
    footKind === "charge" && footCard
      ? { label: `Charge ${fmt$(footDue)} to ${footCard.brand} ···· ${footCard.last4}`, run: chargeOnFile }
      : footKind === "collect"
        ? { label: "Take payment →", run: openCloseOut }
        : footKind === "sendoffice"
          ? { label: "Send to the office to bill", run: sendToOffice }
          : { label: "Done", run: close };

  // The viewer's own visit (the one their scope belongs to), else the job's current
  // visit — an owner-operator scoping their own walkthrough still lands somewhere.
  const myVisit = placed.find((v) => v.techId === me.data?.userId);
  const scopeVisit = myVisit ?? curVisit;

  const onQuoteTab = tab === "quote";

  return (
    <>
      {/* 1. Sticky sheet header — customer name + service word + title. NO status pill. */}
      <TechHeader job={job} custName={custName} />

      {/* 1b. Tabs — Job · Quote (underline tab bar, same grammar as the Office page).
          Surface-based, not role-based: owner-operators quote on site too. */}
      <div className="otabs" role="tablist" aria-label="Job view">
        <button
          className={tab === "job" ? "otab on" : "otab"}
          role="tab"
          aria-selected={tab === "job"}
          onClick={() => setTab("job")}
        >
          Job
        </button>
        <button
          className={tab === "quote" ? "otab on" : "otab"}
          role="tab"
          aria-selected={tab === "quote"}
          onClick={() => setTab("quote")}
        >
          Quote
        </button>
      </div>

      {onQuoteTab ? (
        /* The Quote tab owns its whole body AND its sticky foot (the builder's
           "Present to customer →" is the sheet's one primary while it shows). */
        <QuoteTab job={job} scopeVisit={scopeVisit} readOnly={done} />
      ) : (
        <>
      {/* 2. Call / Text — the quiet peer-action row. CALL is for everyone: a technician ringing
          the customer on their way is the ordinary field case, and going through Mallet is what
          keeps their personal mobile off the customer's phone. myDay now carries the customers
          behind a tech's own jobs, so the lead is in the store on this surface too. TEXT stays
          office-only — outbound SMS is gated on the org's 10DLC registration, a separate question
          from voice. Both stay TAPPABLE: the call sheet / thread each prompt in-flow when no
          number is on file. They disable only with NO linked customer (nobody to call). */}
      <div className="sheet-secrow">
        <button
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (lead) pushModal(MODAL.CALL, { leadId: lead.id });
          }}
        >
          Call
        </button>
        {isOffice && (
          <button
            className="sheet-sec"
            disabled={!lead}
            title={!lead ? "No linked customer" : undefined}
            onClick={() => {
              if (lead) pushModal(MODAL.THREAD, { leadId: lead.id });
            }}
          >
            Text
          </button>
        )}
      </div>

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

      {/* 4. The close-out HERO. A done, UNPRICED ESTIMATE gets the scope handoff for every
          role — there is no bill on a scoping visit, so no billing branch may render. Otherwise
          the billing DoneBlock stays office-only: charge-on-file / take-payment / send-to-office
          all write through ownerOrOffice endpoints. A job that is NOT done has no hero of its
          own: the address above and the visit row below are what the technician needs on the
          doorstep, and they are already there. */}
      {done && scoping ? (
        <ScopeHandoffBlock
          scoped={hasScope}
          onOpenQuoteTab={() => setTab("quote")}
          // Office-only: billing writes (addInvoice's manual draft/send) are ownerOrOffice
          // server-side, so a tech would only get FORBIDDEN — feeAmount 0 hides the button for
          // them, the same guard that hides it while the fee is unset/loading.
          feeAmount={isOffice ? (orgServiceFee ?? 0) : 0}
          hasFeeInvoice={hasFeeInvoice}
          onCollectFee={collectVisitFee}
          feeError={feeError}
        />
      ) : done && isOffice ? (
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
              canReopen={isOffice}
              // A tech may only move THEIR OWN visit. A two-visit job shows both rows (they are
              // useful context — "my stop is the second one today"), but the step buttons appear
              // only on the row assigned to the viewer. Without this a tech tapping the wrong row
              // would move a colleague's visit and write time against it; the server refuses that
              // now, so the alternative is an unexplained error on a button that looked live.
              canAct={isOffice || v.techId === me.data?.userId}
              onStatus={(status) => onVisitStatus(v.id, status)}
            />
          ))
        ) : (
          <div className="empty-att" style={{ marginBottom: "0" }}>
            Not scheduled yet — the office will set the time.
          </div>
        )}
      </div>

      {/* 6. Pricing lives in the Quote tab — the one pricing home on this surface for
          every role. The old office-only PricingSec entry (a second door to the same
          builder) was removed with the role gate on the tabs. */}

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

      {/* THE primary — docked where the thumb is, whatever the sheet's height. */}
      <div className="sheet-foot">
        <button className="sheet-pri" onClick={footPri.run}>
          {footPri.label}
        </button>
      </div>
        </>
      )}
    </>
  );
}
