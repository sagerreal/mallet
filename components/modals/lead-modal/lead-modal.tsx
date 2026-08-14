/**
 * components/modals/lead-modal/lead-modal.tsx
 * The customer sheet — the flagship of the record-modal grammar.
 *
 * Shape (top to bottom): sticky header (name · stage · source), a row of quiet
 * secondaries, WORK rows (quotes + site visits, only when they exist), then the
 * quiet level-0 rows — Phone, Service address, Notes, Tasks, Details, Clean up —
 * each expanding in-flow, and ONE filled primary docked in a sticky footer where a
 * one-handed thumb actually is.
 *
 * The primary is stage-aware AND data-aware. Four of five design critics
 * independently flagged the first cut, whose loudest element was "Call Sean" on a
 * customer with no phone number: a promoted action that cannot run is worse than no
 * promotion. Order of truth:
 *   no phone on file      → "Add phone"   (opens the Phone row, keyboard up)
 *   new customer w/ phone → "Call {name}" (first contact is the move)
 *   otherwise             → "New quote"   (the money action)
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { dtoEstimateSummaryToStore, dtoLeadNoteToStore } from "@/lib/store/dto-mapper";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { Modal } from "../modal";
import { SheetRow } from "../sheet-row";
import { LeadSheetHeader, PhoneCell } from "./lead-header";
import { NotesBody, latestNoteSnippet } from "./lead-notes";
import { TasksBody, openTaskLabel } from "./tasks-card";
import { DetailsBody, CleanUpBody, EmailBody, detailsSummary } from "./more-details";
import {
  useCloseModal,
  useActiveModal,
  useAppStore,
  usePushModal,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate, Lead } from "@/lib/store/types";
import { estTotal } from "@/lib/estimates";
import { fmtPhone } from "@/lib/format";
import { AddressInput } from "@/components/ui/address-input";
import { SourcePicker } from "@/features/customers/source-picker";
import { ModalLoading } from "../modal-loading";

/**
 * The pill on a quote row.
 *
 * "Signed" and "Accepted" are DIFFERENT and must not be conflated. This used to return "Signed"
 * for every accepted quote, including one an office user marked accepted after a phone call with
 * no signature behind it anywhere.
 *
 * That is worse than showing nothing. This is the row a shop reads before deciding whether to
 * chase a balance, and "Signed" told them they held evidence when they held a status field.
 * "Accepted" is the honest word for a phone approval — it is still a real acceptance, just not a
 * signed one.
 */
function statusStamp(status: string, signed: boolean): string {
  switch (status) {
    case "accepted": return signed ? "Signed" : "Accepted";
    case "sent": return "Sent";
    case "draft": return "Draft";
    case "declined": return "Declined";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function statusStampCls(status: string): string {
  switch (status) {
    case "accepted": return "green";
    case "sent": return "blue";
    case "declined": return "red";
    default: return "gray";
  }
}

/** Quote rows under the WORK label. One status statement per row: the pill carries
 *  the status, the subtitle carries the document number — not both twice. */
function QuoteRows({ estimates }: { estimates: Estimate[] }) {
  const pushModal = usePushModal();
  return (
    <>
      {estimates.map((e) => (
        <button
          key={e.id}
          type="button"
          className="sheet-workrow"
          onClick={() => pushModal(MODAL.EST, { estId: e.id })}
        >
          <div className="t">
            <b>{e.title}</b>
            <span>Quote {e.num}</span>
          </div>
          <span className="amt">${estTotal(e).toLocaleString()}</span>
          <span className={`pill ${statusStampCls(e.status)}`}>{statusStamp(e.status, Boolean(e.signed))}</span>
          <span className="chev" style={{ color: "var(--ink-3)" }} aria-hidden="true">›</span>
        </button>
      ))}
    </>
  );
}

/** "Call Sean" only when the record is one person with a clean first name —
 *  "Call Danville" (an LLC) or "Call Sean &" (a couple) would be worse than "Call". */
function callLabel(lead: Lead): string {
  const first = lead.name.trim().split(/\s+/)[0] ?? "";
  const looksLikePerson =
    /^[A-Z][a-z]+$/.test(first) && !/&|,|\bLLC\b|\bInc\b|\bCo\b/i.test(lead.name);
  return looksLikePerson ? `Call ${first}` : "Call";
}

export function LeadModal({ open, instant }: { open: boolean; instant?: boolean }) {
  const close = useCloseModal();
  const activeModal = useActiveModal();
  const pushModal = usePushModal();
  const router = useRouter();
  const leads = useAppStore((s) => s.leads);
  // For the Details row's summary — the linked business is what is left in that drawer.
  const companies = useAppStore((s) => s.companies);
  const adoptLead = useAppStore((s) => s.adoptLead);
  const adoptEstimateRecord = useAppStore((s) => s.adoptEstimateRecord);
  const adoptLeadNotes = useAppStore((s) => s.adoptLeadNotes);
  const estimates = useAppStore((s) => s.estimates);
  const tasks = useAppStore((s) => s.tasks);
  const updateLead = useAppStore((s) => s.updateLead);

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead = leads.find((l) => l.id === leadId);

  // FETCH-ON-MISS. The Customers list is served by the database a page at a time, so it shows
  // customers the store never hydrated. Opening one of those found nothing here and rendered
  // "no longer available — they may have been archived", which is not just unhelpful, it is
  // FALSE: the customer exists and is not archived. Mirrors job-modal.
  const missing = Boolean(leadId) && !lead;
  const leadQ = api.v1.customers.get.useQuery(
    { leadId: leadId ?? "" },
    { enabled: missing, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (missing && leadQ.data) adoptLead(toStoreLead(leadQ.data));
  }, [missing, leadQ.data, adoptLead]);

  // THIS CUSTOMER'S work comes from the server — the store holds one page per collection,
  // so a customer opened from the paginated list used to show an EMPTY Work section and
  // "0 open tasks" while their quotes and tasks sat in the database. Store rows win on id
  // collision (they carry optimistic/local state like fu).
  const workQ = api.v1.quoting.listByLead.useQuery(
    { leadId: leadId ?? "" },
    { enabled: Boolean(lead), refetchOnWindowFocus: false },
  );
  // THE TRAIL, from the database. Notes/calls/texts used to live only in the store, which the
  // hydrator resets on every refetch — so a gate code typed here vanished. Fetched per customer
  // rather than ridden along on the list: the list shows 50 rows and reads none of their trails.
  const notesQ = api.v1.customers.listNotes.useQuery(
    { leadId: leadId ?? "" },
    { enabled: Boolean(lead), refetchOnWindowFocus: false },
  );
  useEffect(() => {
    const items = notesQ.data?.items;
    if (!items || !leadId) return;
    adoptLeadNotes(leadId, items.map(dtoLeadNoteToStore));
  }, [notesQ.data, leadId, adoptLeadNotes]);

  const leadTasksQ = api.v1.tasks.list.useQuery(
    { leadId: leadId ?? "", done: false, limit: 100 },
    { enabled: Boolean(lead), refetchOnWindowFocus: false },
  );
  const leadEstimates = useMemo(() => {
    if (!lead) return [];
    const fromStore = estimates.filter((e) => e.leadId === lead.id);
    const seen = new Set(fromStore.map((e) => e.id));
    const fromServer = (workQ.data?.items ?? [])
      .filter((dto) => !seen.has(dto.id))
      .map((dto) => dtoEstimateSummaryToStore(dto, { on: false, stage: 0 }));
    return [...fromStore, ...fromServer];
  }, [lead, estimates, workQ.data]);
  const hasWork = leadEstimates.length > 0;

  // ADOPT what this sheet already fetched. The rows above were built from the server response and
  // kept LOCAL, so opening one sent the estimate modal looking in the store, finding nothing, and
  // blocking on a second round-trip for a record this component was already holding — the pause
  // Owen sees between the tap and the sheet.
  //
  // Adopting the summary means the sheet opens immediately with what a header can say (title,
  // number, total, status) while the lines load behind it. That is what `needsFull` is already
  // written to handle; it just never had a header to work with here.
  useEffect(() => {
    const items = workQ.data?.items;
    if (!items?.length) return;
    const known = new Set(estimates.map((e) => e.id));
    for (const dto of items) {
      // The SUMMARY mapper and adoptEstimateRecord, not adoptEstimate — a list row carries no
      // lines or pricing, and the full mapper reads both.
      if (!known.has(dto.id)) adoptEstimateRecord(dtoEstimateSummaryToStore(dto, { on: false, stage: 0 }));
    }
    // `estimates` deliberately not a dep: adopting appends to it and would loop.
  }, [workQ.data, adoptEstimateRecord]);

  // "New quote" → the real composer, seeded with this customer. Close first so the
  // sheet doesn't sit over the composer page.
  function newQuote() {
    if (!lead) return;
    close();
    router.push(`/composer?lead=${lead.id}`);
  }

  if (!lead) {
    // Three genuinely different states, said apart. Claiming "archived" while a fetch is still in
    // flight is what made this modal lie.
    return (
      <Modal open={open} onClose={close} wide label="Customer" instant={instant}>
        <h2>Customer</h2>
        {missing && leadQ.isLoading ? (
          <ModalLoading size="lg" />
        ) : missing && leadQ.isError ? (
          <p className="muted">Couldn&apos;t load this customer. Close and try again.</p>
        ) : (
          <p className="muted">This customer is no longer available — they may have been archived.</p>
        )}
      </Modal>
    );
  }

  const hasPhone = Boolean(lead.phone && lead.phone.trim());
  const isNew = lead.stage === "New customer";
  const canVisit = lead.stage !== "Won" && lead.stage !== "Lost";

  // The one loud action — stage-aware AND data-aware (see the header comment).
  type Action = "call" | "quote" | "addphone";
  const primaryKind: Action = !hasPhone ? "addphone" : isNew ? "call" : "quote";
  const primary =
    primaryKind === "addphone"
      ? { label: "Add phone", run: () => setPhoneOpen(true) }
      : primaryKind === "call"
        ? { label: callLabel(lead), run: () => pushModal(MODAL.CALL, { leadId: lead.id }) }
        : { label: "New quote", run: newQuote };

  const openTasksStore = tasks.filter((t) => t.leadId === lead.id && !t.done);
  const openTasks = Math.max(openTasksStore.length, leadTasksQ.data?.items.length ?? 0);

  return (
    <Modal open={open} onClose={close} wide label={lead.name} instant={instant}>
      <LeadSheetHeader lead={lead} />

      {/* Quiet secondaries — every contact/advance action that is NOT the primary.
          Call and Text stay tappable even with no number: their sheets prompt to add
          one in-flow (the #197/#198 behaviour), so nothing here is a dead button.
          48px: the glove floor the first cut missed. */}
      <div className="sheet-secrow">
        {primaryKind !== "call" && (
          <button className="sheet-sec" onClick={() => pushModal(MODAL.CALL, { leadId: lead.id })}>
            Call
          </button>
        )}
        <button className="sheet-sec" onClick={() => pushModal(MODAL.THREAD, { leadId: lead.id })}>
          Text
          {lead.unread ? (
            <span className="pill blue" style={{ padding: "var(--space-2xs) var(--space-2)", fontSize: "var(--type-xs)" }}>
              new
            </span>
          ) : null}
        </button>
        {canVisit && (
          // The New job modal, carrying this customer. It used to open a thin "Site visit" form
          // that made the same thing — a job with an unplaced visit — from fewer fields, so the
          // two disagreed about what a job needs and only one of them knew about checklists,
          // pricing and multiple visits.
          <button className="sheet-sec" onClick={() => pushModal(MODAL.NEW_JOB, { leadId: lead.id })}>
            Create a job
          </button>
        )}
        {primaryKind !== "quote" && (
          <button className="sheet-sec" onClick={newQuote}>
            New quote
          </button>
        )}
      </div>

      {/* QUOTES — rows not cards, only when they exist. Called "Work" until the rows below were
          grouped; two headings reading "Work" on one sheet named two different things. It renders
          QuoteRows off leadEstimates, so this is also just the more accurate word. */}
      {hasWork && (
        <>
          <div className="sheet-worklab">Quotes</div>
          <QuoteRows estimates={leadEstimates} />
        </>
      )}

      {/* CONTACT — the ways to reach this customer. These carry their value in the collapsed row,
          which is how the sheet is read without opening anything. */}
      <div className="sheet-worklab">Contact</div>
      <div className="sheet-rows">
        {/* Phone has ONE home in every state — it used to live here when empty and
            in the header when filled, which left nowhere obvious to edit it. */}
        <SheetRow
          label="Phone"
          value={hasPhone ? fmtPhone(lead.phone ?? "") : "Add"}
          valueIsHint={!hasPhone}
          expandable
          open={phoneOpen}
          onOpenChange={setPhoneOpen}
        >
          <PhoneCell
            value={lead.phone ?? ""}
            onCommit={(phone) => updateLead(lead.id, { phone })}
          />
        </SheetRow>

        {/* Email sits beside Phone, not inside Details: it is a way to reach the customer, and
            burying it left the sheet showing an email as the summary of a drawer that also holds
            the company and arbitrary custom fields. */}
        <SheetRow
          label="Email"
          value={lead.email?.trim() ? lead.email : "Add"}
          valueIsHint={!lead.email?.trim()}
          expandable
        >
          <EmailBody lead={lead} />
        </SheetRow>

        {/* Lead source has ONE home now, and this is it for an existing customer. It used to be a
            line of TEXT in the header that rendered nothing at all when empty — so a customer typed
            in a hurry with the source skipped had no way back, even though the API has always
            accepted the change. */}
        <SheetRow
          label="Lead source"
          value={lead.source?.trim() ? lead.source : "Add"}
          valueIsHint={!lead.source?.trim()}
          expandable
        >
          <SourcePicker
            value={lead.source ?? ""}
            onPick={(source) => updateLead(lead.id, { source })}
          />
        </SheetRow>

        <SheetRow
          label="Service address"
          value={lead.address?.trim() ? lead.address : "Add"}
          valueIsHint={!lead.address?.trim()}
          expandable
        >
          <AddressBody lead={lead} />
        </SheetRow>
      </div>

      {/* WORK — what is outstanding on this customer. */}
      <div className="sheet-worklab">Work</div>
      <div className="sheet-rows">
        <SheetRow
          label="Notes"
          value={latestNoteSnippet(lead) ?? "Add"}
          valueIsHint={!latestNoteSnippet(lead)}
          expandable
          open={notesOpen}
          onOpenChange={setNotesOpen}
        >
          <NotesBody lead={lead} autoFocus={notesOpen} />
        </SheetRow>

        <SheetRow
          label="Tasks"
          value={openTaskLabel(openTasks) ?? "Add"}
          valueIsHint={openTasks === 0}
          expandable
        >
          <TasksBody lead={lead} />
        </SheetRow>
      </div>

      {/* Everything else. With email promoted, the summary is what is actually still in here. */}
      <div className="sheet-rows">
        <SheetRow
          label="Details"
          value={detailsSummary(lead, companies)}
          valueIsHint={detailsSummary(lead, companies) === "Add"}
          expandable
        >
          <DetailsBody lead={lead} />
        </SheetRow>

        {/* Neutral ink at level 0; red only on Delete inside. */}
        <SheetRow label="Clean up" value="mark Lost or archive" valueIsHint expandable>
          <CleanUpBody lead={lead} />
        </SheetRow>
      </div>

      {/* THE primary — docked where the thumb is, whatever the sheet's height. */}
      <div className="sheet-foot">
        <button className="sheet-pri" onClick={primary.run}>
          {primaryKind === "call" && (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          )}
          {primary.label}
        </button>
      </div>
    </Modal>
  );
}

/** The Service-address accordion body — the full-width AddressInput with its
 *  in-flow suggestion list, committing on select/blur. */
function AddressBody({ lead }: { lead: Lead }) {
  const updateLead = useAppStore((s) => s.updateLead);
  const [addrVal, setAddrVal] = useState(lead.address ?? "");
  return (
    <AddressInput
      value={addrVal}
      onChange={setAddrVal}
      onSelect={(v) => updateLead(lead.id, { address: v })}
      onBlur={() => updateLead(lead.id, { address: addrVal })}
      placeholder="123 Main St, Oakland CA 94601"
      inputStyle={{ width: "100%", minHeight: 44, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "0 var(--space-3)", fontSize: "var(--type-md)" }}
    />
  );
}
