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
import { dtoEstimateSummaryToStore, dtoLeadNoteToStore } from "@/lib/store/dto-mapper";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { Modal } from "../modal";
import { SheetRow } from "../sheet-row";
import { PipelineStagePicker } from "@/features/customers/pipeline-stage-picker";
import { api } from "@/lib/trpc/client";
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
import { Field, FieldGroup } from "@/components/ui/input";
import { TagPicker } from "@/features/customers/tag-picker";
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

  // The chapters, all shut on open. Contact used to start expanded on the theory that it is why
  // the sheet gets opened, but it made the sheet land mid-scroll on a wall of fields instead of
  // the four-line summary the collapsed rows already carry. The primary "Add phone" still opens
  // it (askForPhone), so the one case that genuinely needs it still gets it.
  const [contactOpen, setContactOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);

  /**
   * ONLY WHEN THIS SHEET IS THE ONE ON SCREEN. ModalHost mounts the customer sheet on every page
   * and tells it whether it is open; `activeModal` is whatever is on TOP of the stack. Reading the
   * id without checking which modal that is meant any other sheet carrying a leadId — Call, Text,
   * New quote — resolved a subject here and woke all four of the reads below behind it. On a
   * technician's phone those are ownerOrOffice procedures, so tapping Call fired four 403s at a
   * surface he was not looking at.
   */
  const leadId = open ? (activeModal?.params?.leadId as string | undefined) : undefined;
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

  // The shop's pipeline stages — gates the "Pipeline stage" row. A shop with no pipeline never
  // sees the row (progressive disclosure); a tech's session cannot read it and gets the same
  // nothing. One cached read, shared with the board.
  //
  // MUST STAY ABOVE the `if (!lead) return` below. It lived under it, so the first render — before
  // the customer had loaded — ran one fewer hook than the second, which is React error #310
  // ("rendered more hooks than during the previous render") and took the whole modal down with
  // "Something went wrong." Every customer, every time.
  const pipelineQ = api.v1.customers.pipeline.board.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });

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
  // Defensive default: a store row hydrated by an older path may predate the column.
  const tagList = lead.tags ?? [];
  const isNew = lead.stage === "New customer";
  const canVisit = lead.stage !== "Won" && lead.stage !== "Lost";

  // The one loud action — stage-aware AND data-aware (see the header comment).
  type Action = "call" | "quote" | "addphone";
  const primaryKind: Action = !hasPhone ? "addphone" : isNew ? "call" : "quote";
  // One way to ask for a number, used by the primary AND by Call/Text when there is none.
  // Contact is all it takes now: the Phone field is typed in place inside it, so there is no
  // second row to open. It used to also set phoneOpen for the row that wrapped the input.
  const askForPhone = () => setContactOpen(true);

  const primary =
    primaryKind === "addphone"
      ? { label: "Add phone", run: askForPhone }
      : primaryKind === "call"
        ? { label: callLabel(lead), run: () => pushModal(MODAL.CALL, { leadId: lead.id }) }
        : { label: "New quote", run: newQuote };

  const pipelineStages = pipelineQ.data?.stages ?? [];

  const openTasksStore = tasks.filter((t) => t.leadId === lead.id && !t.done);
  const openTasks = Math.max(openTasksStore.length, leadTasksQ.data?.items.length ?? 0);

  return (
    <Modal open={open} onClose={close} wide label={lead.name} instant={instant}>
      <LeadSheetHeader lead={lead} />

      {/* Quiet secondaries — every contact/advance action that is NOT the primary.
          48px: the glove floor the first cut missed.

          WITH NO NUMBER ON FILE, Call and Text open the PHONE ROW on this sheet rather than
          pushing another sheet on top. Both used to stack a second modal whose whole job was one
          field — and it was titled with the customer's name, so a customer called "New customer"
          produced a sheet headed "New customer" over the sheet you were already reading. The row
          is six inches below the button; going to it is the shorter, less startling path, and it
          is what the primary "Add phone" action already does. */}
      <div className="sheet-secrow">
        {primaryKind !== "call" && (
          <button
            className="sheet-sec"
            onClick={() => (hasPhone ? pushModal(MODAL.CALL, { leadId: lead.id }) : askForPhone())}
          >
            Call
          </button>
        )}
        <button
          className="sheet-sec"
          onClick={() => (hasPhone ? pushModal(MODAL.THREAD, { leadId: lead.id }) : askForPhone())}
        >
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
      <SheetRow
        variant="section"
        label="Contact"
        value={contactSummary(lead)}
        expandable
        open={contactOpen}
        onOpenChange={setContactOpen}
      >
      {/* NO SECOND LAYER OF CHEVRONS. Every field in here was its own expandable row, so opening
          Contact revealed four more things to open and putting in a phone number cost two clicks
          before the keyboard. The chapters are all collapsed on arrival now, so opening one IS the
          request to see what is inside — a chevron on each field asks the same question twice.

          Phone has ONE home in every state; it used to live here when empty and in the header when
          filled, which left nowhere obvious to edit it. Email sits beside it rather than inside
          Details for the same reason: it is a way to reach the customer. Tags have ONE home and
          this is it — the single-select "Lead source" they replaced was a line of text in the
          header that rendered nothing when empty, so a customer typed in a hurry had no way back.
          Tags' onChange sends the FULL set, which is how a tag is removed. */}
      <div className="sheet-inline">
        <PhoneCell
          label="Phone"
          value={lead.phone ?? ""}
          onCommit={(phone) => updateLead(lead.id, { phone })}
        />
        <EmailBody lead={lead} />
        <FieldGroup label="Tags">
          <TagPicker
            value={tagList}
            onChange={(tags) => updateLead(lead.id, { tags: [...tags] })}
          />
        </FieldGroup>
        <AddressBody lead={lead} />
      </div>
      </SheetRow>

      {/* WORK — what is outstanding on this customer. */}
      <SheetRow
        variant="section"
        label="Work"
        value={workSummary(latestNoteSnippet(lead), openTasks)}
        expandable
        open={workOpen}
        onOpenChange={setWorkOpen}
      >
      {/* Flat, for the same reason Contact is — see the note there. */}
      <div className="sheet-inline">
        <FieldGroup label="Notes">
          <NotesBody lead={lead} />
        </FieldGroup>
        <FieldGroup label="Tasks">
          <TasksBody lead={lead} />
        </FieldGroup>
        {/* Only when the shop HAS a pipeline. */}
        {pipelineStages.length > 0 && (
          <FieldGroup label="Pipeline stage">
            <PipelineStagePicker leadId={lead.id} value={lead.pipelineStageId} />
          </FieldGroup>
        )}
      </div>
      </SheetRow>

      {/* Everything else. With email promoted, the summary is what is actually still in here. */}
      <SheetRow variant="section" label="Details" value={detailsSummary(lead, companies)} expandable>
        <DetailsBody lead={lead} />
      </SheetRow>

      {/* Neutral ink at the head; red only on Delete inside. */}
      <SheetRow variant="section" label="Clean up" value="mark Lost or archive" expandable>
        <CleanUpBody lead={lead} />
      </SheetRow>

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

/**
 * What a CLOSED chapter says on its right.
 *
 * The sheet's grammar is that you read the record without opening anything — that was the whole
 * argument for keeping phone and address at the top level rather than burying them. Collapsing
 * them into a chapter takes that away unless the head carries it, so each one reports what is
 * inside without being opened.
 */
/**
 * NOT A COUNT. This read "1 of 4", which is worse than useless on two counts: it reads like
 * pagination, and the "1" was usually Lead source — "Added manually" is not a way to reach anyone,
 * so a customer with no phone and no email still scored 1. The collapsed row is meant to answer
 * "can I reach this person", so it names the thing rather than tallying boxes.
 *
 * Phone first because that is what a shop actually needs, and because its absence is the one worth
 * shouting about — every action on this sheet routes through it.
 */
const contactSummary = (lead: Lead): string => {
  const has = (v: unknown): boolean => Boolean(v && String(v).trim());
  if (has(lead.phone)) return String(lead.phone);
  if (has(lead.email)) return String(lead.email);
  // "Add", like every other chapter head. This was the only head on the sheet that named a field
  // ("Add phone") and the only one that wrote a sentence ("Add phone · email on file").
  return "Add";
};

const workSummary = (noteSnippet: string | null, openTasks: number): string => {
  const parts = [
    openTasks > 0 ? openTaskLabel(openTasks) : null,
    noteSnippet ? "notes" : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Add";
};

/**
 * The Service-address field — the full-width AddressInput with its in-flow suggestion list,
 * committing on select/blur.
 *
 * It carries its OWN label. It used to be labelled by the SheetRow that wrapped it; with that
 * chevron gone the input would otherwise be nameless, which is both an a11y regression and a form
 * with an unexplained box in it. `Field` clones its single child with a generated id and
 * AddressInput forwards `id` to the inner input, so htmlFor actually reaches it.
 */
function AddressBody({ lead }: { lead: Lead }) {
  const updateLead = useAppStore((s) => s.updateLead);
  const [addrVal, setAddrVal] = useState(lead.address ?? "");
  return (
    <Field label="Service address">
      <AddressInput
        value={addrVal}
        onChange={setAddrVal}
        onSelect={(v) => updateLead(lead.id, { address: v })}
        onBlur={() => updateLead(lead.id, { address: addrVal })}
        placeholder="123 Main St, Oakland CA 94601"
        inputStyle={{ width: "100%", minHeight: 44, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "0 var(--space-3)", fontSize: "var(--type-md)" }}
      />
    </Field>
  );
}
