"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useOpenModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { whenDateLabel } from "@/lib/time";
import { todayISO } from "@/lib/clock";
import { fmt$ } from "@/lib/format";

/**
 * components/modals/trail.tsx
 * The customer › quote › job › invoice chain, as ONE line in the sheet header.
 *
 * The four sheets could not reach each other. A quote showed its customer's name as dead text; a job
 * offered no route to its quote or its invoice; an invoice could not name its job. This is the whole
 * fix, and it costs no rows: it lives in `.sheet-meta`, the subtitle strip already under every
 * title, which today holds the status pill and the phone.
 *
 * TYPES, NOT RECORD NUMBERS. The positions read "Quote" and "Job", never "EST-1044" — you already
 * know which record you are on, the title says so. What you could not tell was what else exists.
 * The customer keeps its NAME, because that is the one identifier worth reading at a glance and it
 * is already in that strip.
 *
 * FOUR STATES, and no legend needed:
 *   here    — ink, no underline. Where you are; it goes nowhere.
 *   one     — a link. One tap and you are there.
 *   several — "3 jobs". Tap opens a short list, anchored flush under the trail, in flow.
 *   none    — "no invoice". Grey, plain TEXT, not a control: there is nothing to navigate to, and a
 *             button that creates a record from a breadcrumb is a surprise, not an affordance.
 *
 * ONLY THE CUSTOMER ANCHOR IS EVER PLURAL. Two unique indexes make the chain 1:1 downstream —
 * jobs_org_source_estimate_uidx and invoices_org_source_job_uidx — so a quote produces at most one
 * job and a job carries at most one invoice. The picker therefore only ever appears on the customer
 * sheet; the other three are always singular.
 */

type Kind = "customer" | "quote" | "job" | "invoice";

export interface TrailProps {
  /** Which of the four you are standing on — decides which position reads as "here". */
  readonly kind: Kind;
  /** The record's own id. */
  readonly id: string;
}

/** Which position is plural-able, in chain order. The customer is never one of these. */
const SLOTS = ["quote", "job", "invoice"] as const;
type Slot = (typeof SLOTS)[number];

const SINGULAR: Record<Slot, string> = { quote: "Quote", job: "Job", invoice: "Invoice" };
const PLURAL: Record<Slot, string> = { quote: "quotes", job: "jobs", invoice: "invoices" };
const ABSENT: Record<Slot, string> = { quote: "no quote", job: "no job", invoice: "no invoice" };

export function Trail({ kind, id }: TrailProps) {
  const openModal = useOpenModal();
  const close = useCloseModal();
  /** Which slot's list is open, if any. Only one at a time — this is a chooser, not a panel. */
  const [picking, setPicking] = useState<Slot | null>(null);

  const q = api.v1.links.forRecord.useQuery({ kind, id }, { refetchOnWindowFocus: false });
  const t = q.data;

  // Nothing at all until the read lands. A half-drawn chain that fills in reads as a glitch, and
  // the strip has to hold its height anyway for the status pill beside it.
  if (!t) return null;

  const go = (fn: () => void) => {
    close();
    fn();
  };
  const openCustomer = (leadId: string) => go(() => openModal(MODAL.LEAD, { leadId }));
  const openQuote = (estId: string) => go(() => openModal(MODAL.EST, { estId }));
  const openJob = (jobId: string) => go(() => openModal(MODAL.JOB, { jobId }));
  const openInvoice = (invoiceId: string) => go(() => openModal(MODAL.INVOICE, { invoiceId }));

  const rowsFor = (slot: Slot) => (slot === "quote" ? t.quotes : slot === "job" ? t.jobs : t.invoices);
  const countFor = (slot: Slot) =>
    slot === "quote" ? t.counts.quotes : slot === "job" ? t.counts.jobs : t.counts.invoices;

  const openOne = (slot: Slot, recordId: string) =>
    slot === "quote" ? openQuote(recordId) : slot === "job" ? openJob(recordId) : openInvoice(recordId);

  /** The one fact that tells several of the same thing apart. */
  const subtitleFor = (slot: Slot, row: (typeof t.quotes | typeof t.jobs | typeof t.invoices)[number]) => {
    if (slot === "quote") return (row as (typeof t.quotes)[number]).status;
    if (slot === "job") {
      const j = row as (typeof t.jobs)[number];
      return j.completedAt ? `done ${whenDateLabel(j.completedAt.slice(0, 10), todayISO())}` : j.status;
    }
    const inv = row as (typeof t.invoices)[number];
    return inv.owedCents > 0 ? `${fmt$(inv.owedCents / 100)} owed` : "paid";
  };

  const titleFor = (slot: Slot, row: (typeof t.quotes | typeof t.jobs | typeof t.invoices)[number]) => {
    if (slot === "quote") return (row as (typeof t.quotes)[number]).num;
    if (slot === "job") return (row as (typeof t.jobs)[number]).title ?? "Job";
    return (row as (typeof t.invoices)[number]).num;
  };

  function slotNode(slot: Slot) {
    const isHere = kind === slot;
    const n = countFor(slot);
    const rows = rowsFor(slot);

    // WHERE YOU ARE. Plural on the customer sheet only, and the customer sheet is never "here" for
    // one of these slots — so this is always the singular label.
    if (isHere) return <span className="here">{SINGULAR[slot]}</span>;

    if (n === 0) {
      // Plain text, not a button: there is nothing to go to. Stated rather than dashed — a dash
      // reads as broken data (the register rule).
      return <span className="none">{ABSENT[slot]}</span>;
    }

    if (n === 1 && rows.length === 1) {
      return (
        <button type="button" className="hop" onClick={() => openOne(slot, rows[0]!.id)}>
          {SINGULAR[slot]}
        </button>
      );
    }

    // SEVERAL — the label carries the count, so you know before you tap.
    return (
      <button
        type="button"
        className={`hop${picking === slot ? " open" : ""}`}
        aria-expanded={picking === slot}
        onClick={() => setPicking((p) => (p === slot ? null : slot))}
      >
        {n} {PLURAL[slot]}
      </button>
    );
  }

  const pickRows = picking ? rowsFor(picking) : [];
  const pickTotal = picking ? countFor(picking) : 0;

  return (
    <>
      <span className="trail">
        {t.customer ? (
          kind === "customer" ? (
            <span className="here">{t.customer.name}</span>
          ) : (
            <button type="button" className="hop" onClick={() => openCustomer(t.customer!.id)}>
              {t.customer.name}
            </button>
          )
        ) : (
          <span className="none">no customer</span>
        )}
        {SLOTS.map((slot) => (
          <span key={slot} className="trail-step">
            <span className="sep" aria-hidden="true">
              ›
            </span>
            {slotNode(slot)}
          </span>
        ))}
      </span>

      {/* ANCHORED AND FLUSH under the trail, in flow — never a popover (house rule). */}
      {picking && pickRows.length > 0 && (
        <div className="trail-pick" role="group" aria-label={`Choose a ${picking}`}>
          {pickRows.map((row) => (
            <button key={row.id} type="button" className="pk" onClick={() => openOne(picking, row.id)}>
              <span className="who">{titleFor(picking, row)}</span>
              <span className="when">{subtitleFor(picking, row)}</span>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
          {/* The list is a chooser, not a list view. Past the cap it says so rather than pretending
              these are all of them. */}
          {pickTotal > pickRows.length && (
            <span className="pk-more">
              {pickRows.length} of {pickTotal} — open {PLURAL[picking]} to see the rest
            </span>
          )}
        </div>
      )}
    </>
  );
}
