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
import { useCanText } from "@/features/messaging/use-can-text";
import { useOrgServiceFee } from "@/features/settings/use-org-service-fee";
import { VISIT_FEE_TITLE } from "@/features/invoices/visit-fee";
import type { VisitWriteSurface } from "@/lib/store/visit-status-write";
import type { InvoiceWriteSurface } from "@/lib/store/invoice-write";
import { isJobAssignedTo } from "@/lib/store/job-assignment";
import { MODAL } from "@/lib/store/modal-ids";
import { CopilotSection } from "@/features/field-copilot/copilot-section";
import { currentVisit, custNameOf, invDue, isUnpricedEstimate, vPlaced } from "./helpers";
import { TechHeader } from "./tech-header";
import { VisitsSec } from "./visits-sec";
import { WorkOrderSec } from "./work-order-sec";
import { FoundWorkSec } from "./found-work-sec";
import { ChecklistSec } from "./checklist-sec";
import { NoteFeed } from "./note-feed";
import { DoneBlock, ScopeHandoffBlock } from "./done-block";
import { footActions } from "./tech-job-foot";
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
  // Controls wired to ownerOrOffice endpoints with NO field sibling (visit status, add-on
  // approval, send-to-office, on-site re-pricing) would FORBIDDEN + silently roll back for a
  // tech — they stay office-only. Fail closed: until the role loads, show the tech (reduced)
  // view. Taking payment is NOT one of them any more; see canTakePayment below.
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";

  // May the SHOP text at all (A2P 10DLC campaign active)? A capability, asked of every role —
  // see the Call/Text row below for why this replaced the old isOffice gate.
  const canText = useCanText();

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
  // Visit-fee collection. The fee is a LEAD-tied invoice (never job-tied): invoices.source_job_id
  // carries a partial unique index (one active invoice per job), so a job-tied fee would
  // permanently claim that slot and a later quote-accept on this same job could never raise its
  // real bill. The job rides `scope_job_id` instead — a link that leaves the slot free and exists
  // so the technician at the door can be AUTHORIZED to collect. job.lines is never touched.
  const raiseVisitFee = useAppStore((s) => s.raiseVisitFee);
  // The durable re-collection signal: any non-archived (non-void) invoice for THIS LEAD titled
  // VISIT_FEE_TITLE. Title + leadId survive a reload on the office surface (both come through the
  // invoices hydrator); on the field surface the store holds no invoices until this flow adopts
  // one, so a technician's guard is per-session — which is safe, because the raise is idempotent
  // per job in the DATABASE now: a second tap returns the SAME invoice instead of a duplicate.
  //
  // The button hides only once the fee is genuinely out the door (sent/partial/paid); an unsent
  // draft keeps it visible, since a tap RESUMES that same invoice.
  const existingFeeInvoice = useAppStore((s) =>
    s.invoices.find((i) => i.leadId === leadId && i.title === VISIT_FEE_TITLE && !i.archived),
  );
  const hasFeeInvoice = Boolean(existingFeeInvoice) && existingFeeInvoice?.status !== "draft";

  // Derived values computed after all hooks (never inside selectors to avoid
  // creating new object references on every store write).
  const custName = job ? custNameOf(job, lead) : "";
  const addr = (job?.addr || lead?.address || "") as string;
  const done = job?.status === "done";
  // The tech only sees PLACED visits — never "Invalid Date" rows in the field.
  const placed = (job?.visits ?? []).filter(vPlaced);
  const curVisit = currentVisit(placed);
  // Guarded, null-safe re-derivation of isUnpricedEstimate for use BEFORE the early return
  // below (hooks must run unconditionally) — the fee-fetch effect needs to know whether a
  // scoping visit's handoff will actually need the org's fee. `scoping` below (after the
  // return) reuses this exact value; job is guaranteed non-null there.
  const scopingCandidate = job ? isUnpricedEstimate(job) : false;

  // THE PAYMENT GATE — deliberately not "am I a tech", but "am I on this job", mirroring the
  // server's own `assertFieldInvoiceScope` (Job.isAssignedTo + status complete). A technician may
  // transact on the job in front of them; they may never administer the shop's money.
  //
  // It is a SEPARATE name from isOffice and must stay one: folding the two together would send a
  // technician's visit taps to v1.visits.* (see visitSurface below) and kill their clock.
  const assignedToMe = isJobAssignedTo(job?.visits, me.data?.userId);
  const canTakePayment = isOffice || assignedToMe;
  // Which API this viewer's money writes go to. Office keeps the desk's endpoints; everyone else
  // goes through v1.fieldInvoicing.*, which is job-authorized and answers with a redacted record.
  const invoiceSurface: InvoiceWriteSurface = isOffice ? "office" : "field";

  // The field shell never mounts SettingsHydrator (it only mounts in the office layout — see
  // features/settings/use-org-service-fee.ts), so `booking.serviceFee` in the store is never
  // hydrated on this surface. Fetch the real fee once, only when the OFFICE fee button could
  // actually render: v1.settings.get is ownerOrOffice, so a technician's copy would be FORBIDDEN
  // anyway — and they do not need it. `raiseVisitFee` reads the fee from the shop's own settings
  // server-side, so the amount is never an input and the field button simply names no number.
  const orgServiceFee = useOrgServiceFee(done && isOffice && scopingCandidate);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);

  // --- useCallback-stabilized handlers for memoized child components ---------
  // These are referentially stable across re-renders when their captured
  // store-action dependencies don't change (store actions are stable by
  // Zustand's contract). jobId is a primitive string — stable once the modal is
  // open.

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
    // charge the balance to the card on file — the "paid before they left" play. Unreachable on
    // the field surface by construction (the field customer DTO carries no card), but the write
    // still names its surface: nothing here may depend on a control happening to be hidden.
    if (!invoice) return;
    const card = lead?.card;
    const dueNow = invDue(invoice);
    if (dueNow <= 0 || !card) return;
    void recordPayment(
      invoice.id,
      { amt: dueNow, when: "Just now", method: "card", onFile: true },
      invoiceSurface,
    );
  }, [invoice, lead, recordPayment, invoiceSurface]);

  const openCloseOut = useCallback(() => {
    if (!jobId) return;
    // Pass the invoice id whenever this surface already knows it, so the sheet matches on a
    // DURABLE id rather than re-deriving the job link — the same belt-and-braces the visit-fee
    // path uses. The link itself is now durable (invoicing.list carries sourceJobId), so this is
    // no longer load-bearing; it costs one property and removes the whole class of failure.
    // `from` declares the OPENER'S INTENT, and it is what the close-out branches on to decide
    // where Done lands. Opened from here, the close-out is the last step of a field visit: the
    // next thing this person does is the next stop, so Done dismisses to My day rather than
    // popping back to a job sheet nobody needs again. Role can't stand in for this — an
    // owner-operator collecting at the door is `owner` and still belongs on My day.
    pushModal(
      MODAL.CLOSE_OUT,
      invoice
        ? { jobId, invoiceId: invoice.id, from: "field-job" }
        : { jobId, from: "field-job" },
    );
  }, [jobId, invoice, pushModal]);

  const openInvoiceModal = useCallback(
    (invoiceId: string) => pushModal(MODAL.INVOICE, { invoiceId }),
    [pushModal],
  );

  const sendToOffice = useCallback(() => {
    if (!jobId) return;
    updateJob(jobId, { invRequested: true });
    close();
  }, [jobId, updateJob, close]);

  // Collect the shop's visit fee on a declined estimate visit.
  //
  // ONE call, to `v1.fieldInvoicing.raiseVisitFee`, carrying the JOB ID AND NOTHING ELSE. That is
  // the whole point of this rewrite: the old flow drafted the invoice client-side through
  // `v1.invoicing.draft`, which (a) is ownerOrOffice, so the technician standing at the door — the
  // only person who knows the customer declined — got FORBIDDEN, and (b) stamped no scope link, so
  // even a fee the office raised was unreachable by the person sent to collect it.
  //
  // Everything that used to live here is now the server's, and safer for it: the AMOUNT comes from
  // the shop's settings (the tablet cannot choose what the customer is charged), the ID is minted
  // server-side (a caller-supplied one would be an unchecked write target — "raise a fee on my own
  // job, into THAT invoice"), and the raise is idempotent on the job in the database, so the
  // duplicate-draft retry hazard — and the local-orphan cleanup that mitigated it — are both gone.
  //
  // The sheet is opened only once a real invoice exists, so a refusal never strands the technician
  // in front of an empty payment sheet; the refusal itself is named in place instead.
  const collectVisitFee = useCallback(async () => {
    if (!jobId || feeBusy) return;
    setFeeError(null);

    // Already out the door (sent/partial/paid) — nothing to raise; take them straight to it.
    if (existingFeeInvoice && existingFeeInvoice.status !== "draft") {
      pushModal(MODAL.CLOSE_OUT, {
        jobId,
        invoiceId: existingFeeInvoice.id,
        from: "field-job",
      });
      return;
    }

    setFeeBusy(true);
    const { ok, invoiceId, error } = await raiseVisitFee(jobId);
    setFeeBusy(false);
    if (!ok || !invoiceId) {
      setFeeError(error || "Couldn't raise the visit fee — check your connection and try again.");
      return;
    }
    pushModal(MODAL.CLOSE_OUT, { jobId, invoiceId, from: "field-job" });
  }, [jobId, feeBusy, existingFeeInvoice, raiseVisitFee, pushModal]);

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

  // The viewer's own visit (the one their scope belongs to), else the job's current
  // visit — an owner-operator scoping their own walkthrough still lands somewhere.
  const myVisit = placed.find((v) => v.techId === me.data?.userId);
  const scopeVisit = myVisit ?? curVisit;

  /**
   * The visit this sheet's FOOT moves. Own visit first; an owner/office viewer may move the
   * job's current one either way. A technician looking at a colleague's visit gets neither the
   * step nor the finish — the server refuses both, so a live-looking button would just error.
   */
  const actVisit = !done ? (myVisit ?? (isOffice ? curVisit : undefined)) : undefined;

  // The foot — sheet grammar: ONE loud primary, and a quiet Finish under it whenever the primary
  // is something else. The branch is a pure view model; see tech-job-foot.ts for the four rules.
  const { primary: footPri, quiet: footQuiet } = footActions(
    { job, lead, invoice, isOffice, canTakePayment, scoping, done, actVisit },
    {
      setVisitStatus: onVisitStatus,
      chargeOnFile,
      openCloseOut,
      sendToOffice,
      dismiss: close,
    },
  );

  const onQuoteTab = tab === "quote";

  return (
    <>
      {/* 1. Sticky sheet header — customer name over "<trade> · <when>". NO status pill. */}
      <TechHeader job={job} custName={custName} visit={scopeVisit} />

      {/* 1b. Tabs — Job · Quote. TWO EQUAL HALVES of the sheet's width, centred, with the active
          one carrying a heavy underline: at arm's length in a van, a pair of small left-aligned
          words does not read as a choice. Surface-based, not role-based — owner-operators quote
          on site too. Each half is a real tab with a matching tabpanel; the panels were missing,
          so the tablist named controls that pointed at nothing. */}
      <div className="otabs tj-tabs" role="tablist" aria-label="Job view">
        <button
          id="tj-tab-job"
          className={tab === "job" ? "otab on" : "otab"}
          role="tab"
          type="button"
          aria-selected={tab === "job"}
          aria-controls="tj-panel-job"
          onClick={() => setTab("job")}
        >
          Job
        </button>
        <button
          id="tj-tab-quote"
          className={tab === "quote" ? "otab on" : "otab"}
          role="tab"
          type="button"
          aria-selected={tab === "quote"}
          aria-controls="tj-panel-quote"
          onClick={() => setTab("quote")}
        >
          Quote
        </button>
      </div>

      {onQuoteTab ? (
        /* The Quote tab owns its whole body AND its sticky foot (the builder's
           "Present to customer →" is the sheet's one primary while it shows). */
        <div role="tabpanel" id="tj-panel-quote" aria-labelledby="tj-tab-quote">
          {/* Signing does not end the visit — in the walkthrough-then-do-it flow it STARTS the
              work. Land back on the Job tab with the sold work order showing, rather than
              dismissing the technician out of the job he has just been told to perform. */}
          <QuoteTab
            job={job}
            scopeVisit={scopeVisit}
            readOnly={done}
            onSigned={() => setTab("job")}
          />
        </div>
      ) : (
        <div role="tabpanel" id="tj-panel-job" aria-labelledby="tj-tab-job">
      {/* 2. Address — the tappable Navigate row, or the muted no-address line. It leads the body:
          the first thing a technician does with this sheet is get to it. Navigate carries the
          AMBER accent (see .jaddr .nav) — the app's accent colour, which also carries pending and
          due-now (.pill.amber, .tdue.now, the awaiting-OK pill on this very sheet). There is no
          blue anywhere in Mallet. */}
      {addr ? (
        <button type="button" className="jaddr" onClick={navigate}>
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
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

      {/* 3. Call / Text — the quiet peer-action row, side by side beneath the address.
          CALL is for everyone: a technician ringing the customer on their way is the ordinary
          field case, and going through Mallet keeps their personal mobile off the customer's
          phone. TEXT is gated on CAPABILITY, not on role — `canText` is the org's A2P 10DLC
          campaign being active (see features/messaging/use-can-text.ts). It used to be gated on
          `isOffice`, which answered a different question: a shop that has not finished carrier
          registration cannot text whoever is holding the phone, and a shop that HAS finished it
          has no reason to withhold the thread from the man standing at the door. When the org
          cannot text, no button is drawn at all — a control that is certain to be refused is a
          dead control. Both stay TAPPABLE: the call sheet / thread each prompt in-flow when no
          number is on file. They disable only with NO linked customer (nobody to call). */}
      <div className="sheet-secrow">
        <button
          type="button"
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (lead) pushModal(MODAL.CALL, { leadId: lead.id });
          }}
        >
          Call
        </button>
        {canText && (
          <button
            type="button"
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

      {/* 4. The close-out HERO. A done, UNPRICED ESTIMATE gets the scope handoff for every
          role — there is no bill on a scoping visit, so no billing branch may render. The
          billing DoneBlock now renders for anyone who may COLLECT on this job: the office, or a
          technician assigned to it — that is the whole "take payment at the door" change, and the
          per-control gates inside the card keep the office-only writes (hand-off, on-site
          re-pricing, the unredacted receipt) where they were. A job that is NOT done has no hero
          of its own: the address above and the visit row below are what the technician needs on
          the doorstep, and they are already there. */}
      {done && scoping ? (
        <ScopeHandoffBlock
          scoped={hasScope}
          onOpenQuoteTab={() => setTab("quote")}
          // The office waits for its own settings read so the button can name the number; a
          // technician gets the button as soon as the job is theirs, and the server names the
          // amount by raising the invoice.
          canCollectFee={isOffice ? (orgServiceFee ?? 0) > 0 : canTakePayment}
          feeAmount={isOffice ? orgServiceFee : null}
          hasFeeInvoice={hasFeeInvoice}
          onCollectFee={collectVisitFee}
          feeError={feeError}
        />
      ) : done && canTakePayment ? (
        <DoneBlock
          job={job}
          lead={lead}
          invoice={invoice}
          onOpenCloseOut={openCloseOut}
          // Office only — the invoice modal reads the unredacted office record (line cost, the
          // customer's pay-link token). Omitted for the field, so the receipt link isn't drawn.
          onOpenInvoice={isOffice ? openInvoiceModal : undefined}
          onChargeOnFile={chargeOnFile}
          // No hand-off prop: on a job with money owed the card offers taking the money and
          // nothing else. `sendToOffice` still reaches the foot below, which carries it as the
          // primary on a genuinely unpriced job — the one state with nothing to collect.
          canSetBill={isOffice}
        />
      ) : null}

      {/* 5. The visit — WHERE THIS JOB HAS GOT TO, and it sits ABOVE the work order on purpose.
          A technician opening this sheet is answering "am I on my way, am I here, am I finished"
          before "what did we sell". The approved design puts the status readout directly under the
          contact row for that reason; the work order is reference material beneath it. */}
      <VisitsSec
        placed={placed}
        curVisit={curVisit}
        done={done}
        isOffice={isOffice}
        onStatus={onVisitStatus}
      />

      {/* 5a. Work order — ONE gate: is there anything to show?
          It used to be gated three ways — `jobMode === "install"` AND not done AND at least one
          described line. `jobMode` reads "install" only for PRICED lines, so a plain service call
          never showed a work order at all: the technician arrived knowing the customer's name and
          nothing about the work. A finished job hid it too, exactly when someone wants to check
          what was sold. The remaining condition is the honest one. */}
      {(job.lines ?? []).some((l) => (l.d ?? "").trim()) ? (
        <WorkOrderSec job={job} seesPrice={seesPrice} />
      ) : null}

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
        <button type="button" className="sheet-pri" onClick={footPri.run}>
          {footPri.label}
        </button>
        {footQuiet ? (
          <button type="button" className="sheet-quiet" onClick={footQuiet.run}>
            {footQuiet.label}
          </button>
        ) : null}
      </div>
        </div>
      )}
    </>
  );
}
