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
import { dtoEstimateSummaryToStore } from "@/lib/store/dto-mapper";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { Modal } from "../modal";
import { SheetRow } from "../sheet-row";
import { LeadSheetHeader, PhoneCell } from "./lead-header";
import { NotesBody, latestNoteSnippet } from "./lead-notes";
import { TasksBody, openTaskLabel } from "./tasks-card";
import { DetailsBody, CleanUpBody } from "./more-details";
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

export function LeadModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const activeModal = useActiveModal();
  const pushModal = usePushModal();
  const router = useRouter();
  const leads = useAppStore((s) => s.leads);
  const adoptLead = useAppStore((s) => s.adoptLead);
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
      <Modal open={open} onClose={close} wide label="Customer">
        <h2>Customer</h2>
        {missing && leadQ.isLoading ? (
          <p className="muted">Loading…</p>
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
    <Modal open={open} onClose={close} wide label={lead.name}>
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
          <button className="sheet-sec" onClick={() => pushModal(MODAL.VISIT, { leadId: lead.id })}>
            Site visit
          </button>
        )}
        {primaryKind !== "quote" && (
          <button className="sheet-sec" onClick={newQuote}>
            New quote
          </button>
        )}
      </div>

      {/* WORK — quotes and site visits, rows not cards, only when they exist. */}
      {hasWork && (
        <>
          <div className="sheet-worklab">Work</div>
          <QuoteRows estimates={leadEstimates} />
        </>
      )}

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

        <SheetRow
          label="Service address"
          value={lead.address?.trim() ? lead.address : "Add"}
          valueIsHint={!lead.address?.trim()}
          expandable
        >
          <AddressBody lead={lead} />
        </SheetRow>

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

        <SheetRow
          label="Details"
          value={lead.email?.trim() ? lead.email : "Add"}
          valueIsHint={!lead.email?.trim()}
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
