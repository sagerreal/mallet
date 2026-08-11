/**
 * components/modals/price-builder-modal.tsx
 * Faithful port of the prototype tech-quote builder (openTechQuote / tqRender /
 * tqSavePrice, prototype 7230-7339) in its OFFICE single-tier mode — the same
 * builder the crew uses, opened from the job's "Build the price" / "Edit" via
 * jobBuildPrice(id) which sets state.tq.fromCreate=true (prototype 4511).
 *
 * The line-building primitives (BuildLine model, lineAmt / linesTotal / seedLines,
 * fmt$ / custLabel, and the AddMenu / LineRow render pieces) are shared with the
 * tech GBB builder and live in ./pricing/build-line. The pricebook services +
 * labor rates are read from the store and adapted to the shared PricebookItem /
 * LaborRate shape here, then handed to AddMenu as props.
 *
 * OFFICE single-tier mode (fromCreate=true) renders:
 *   - the sticky .sheet-head: <h2>Build the price</h2> over one .sheet-meta line
 *     ("Price the job · <customer>")
 *   - the built line list (.card) with per-line editable rows + the Total (a full
 *     breakdown once a rate is set)
 *   - the "+ Add to the quote" picker: a 2×2 .addgrid of .addtile tiles
 *       Pricebook (browse saved items) · Custom item (one-off price)
 *       Labor    (browse your rates $/hr) · Custom labor (one-off $/hr)
 *     browsing a sublist stays open while building (adding does NOT collapse it)
 *   - Discount / Sales tax rows (the field builder's own collapsed rows; no
 *     Deposit — jobs store no deposit rate, a deposit rides the signed/sent
 *     document, and a row whose value evaporates on save is worse than none)
 *   - the sticky .sheet-foot: ONE .sheet-pri "Save price →" → setJobLines with
 *     the rates; "Price later" stays a quiet ghost beside it
 *
 * SAVING BOOKS THE PRICE (the one-job-type model): an unpriced job's kind flips
 * estimate → work on save, which is exactly what routes the tech's Quote tab to
 * the committed read-back + change orders instead of an editable draft. There is
 * no Type chip anywhere any more — this save IS the fork.
 *
 * OUT OF SCOPE — correctly, for office single-tier mode:
 *   - the Good/Better/Best tier selector + the "Give the customer choices?"
 *     opt-in — a BOOKED job stores one price; options exist to be PRESENTED,
 *     which is the composer's and the field builder's business.
 *   - the "Present → / on glass" flow and the customer signature / sign sheet
 *     (tqPresent / tqSign / tqSigInit) — that is the crew's customer-facing
 *     path (see tech-quote-modal.tsx), never the office save path.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { isEstimateJob } from "@/features/jobs/job-status-meta";
import type { Job, JobLine, Service } from "@/lib/store/types";
import type { LaborRate as StoreLaborRate } from "@/lib/store/slices/settings-slice";
import {
  type AddSub,
  type BuildLine,
  type LaborRate,
  type PricebookItem,
  AddMenu,
  AddToQuoteRow,
  LineRow,
  custLabel,
  lineAmt,
  linesTotal,
  seedLines,
} from "./pricing/build-line";
import {
  FieldPricingRows,
  PriceBreakdown,
  NO_FIELD_PRICING,
  fieldPricingRates,
  fieldPricingTotals,
  hasFieldPricing,
  type FieldPricing,
} from "./pricing/field-pricing";
import { fmt$ } from "@/lib/format";

// ---- the modal body --------------------------------------------------------

export function PriceBuilderModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const setJobLines = useAppStore((s) => s.setJobLines);
  const updateJob = useAppStore((s) => s.updateJob);
  // Reference data straight from the store (raw arrays — never derived in the
  // selector). Adapted below to the shared PricebookItem / LaborRate shape.
  const servicesRaw = useAppStore((s) => s.services);
  const laborRatesRaw = useAppStore((s) => s.laborRates);

  const pricebook: PricebookItem[] = useMemo(
    () =>
      [...servicesRaw]
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((svc: Service) => ({ d: svc.name, r: svc.unitPrice, c: svc.cost })),
    [servicesRaw],
  );
  const laborRates: LaborRate[] = useMemo(
    () => laborRatesRaw.map((r: StoreLaborRate) => ({ name: r.name, rate: r.rate, kind: r.kind })),
    [laborRatesRaw],
  );

  const jobId = activeModal?.params?.jobId as string | undefined;
  const job = jobs.find((j) => j.id === jobId);

  // builder line set — seeded once from the job's existing lines so re-opening
  // ("Edit") builds on top of the current price, never loses it.
  const [lines, setLines] = useState<BuildLine[]>(() => (job ? seedLines(job) : []));
  // add-a-line menu: open (picking) once there are no lines to seed from, plus
  // which sublist (pb / labor) is showing.
  const [picking, setPicking] = useState<boolean>(() => !job || seedLines(job).length === 0);
  const [add, setAdd] = useState<AddSub>(null);
  // Surfaced when the price fails to persist — the builder stays open for a
  // retry rather than closing on a lost price (no silent failure).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Discount / sales tax — the field builder's own rows (no Deposit: jobs store no
  // deposit rate). Seeded from the job's stored rates so re-opening shows the price
  // as it was saved, not a zeroed pair over the same lines.
  const [pricing, setPricing] = useState<FieldPricing>(() =>
    job?.pricing && (job.pricing.disc > 0 || job.pricing.tax > 0)
      ? { ...NO_FIELD_PRICING, discPct: job.pricing.disc, taxPct: job.pricing.tax }
      : NO_FIELD_PRICING,
  );

  // The shop's default sales-tax rate, seeded ONCE onto a fresh price the way the field
  // builder and a new office quote seed it — same org setting, same rule. Never over a
  // rate already stored or typed.
  const orgTaxRate = useAppStore((s) => s.taxRate);
  const seededOrgTax = useRef(false);
  useEffect(() => {
    if (seededOrgTax.current || orgTaxRate <= 0) return;
    seededOrgTax.current = true;
    setPricing((prev) => (prev.taxPct > 0 ? prev : { ...prev, taxPct: orgTaxRate }));
  }, [orgTaxRate]);

  if (!job) return null;

  const lead = leads.find((l) => l.id === job.leadId);
  const total = linesTotal(lines);
  const anyPriced = total > 0;
  // The active derivation — the breakdown the customer would be billed against.
  const subtotalCents = Math.round(total * 100);
  const editRates = fieldPricingRates(pricing, subtotalCents);
  const editTotals = fieldPricingTotals(pricing, subtotalCents);
  const editPriced = hasFieldPricing(editRates);

  // ---- immutable line ops (never mutate a line object) ----------------------

  function appendLine(l: BuildLine) {
    setLines((prev) => [...prev, l]);
  }

  function pickBook(item: PricebookItem) {
    appendLine({ kind: "book", d: item.d, amt: item.r, c: item.c ?? 0 });
    // pricebook pick keeps the sublist open (prototype tqPickBook leaves add).
  }

  function addCustom() {
    appendLine({ kind: "custom", d: "", amt: 0 });
    setAdd(null); // back to the tile menu, still picking (prototype tqAddCustom).
  }

  function pickRate(r: LaborRate) {
    if (r.kind === "flat_fee") {
      appendLine({ kind: "custom", d: r.name, amt: r.rate });
    } else {
      appendLine({ kind: "tm", d: "Labor", h: 1, rate: r.rate });
    }
    // labor pick keeps the sublist open (prototype tqPickRate leaves add).
  }

  function addCustomLabor() {
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: 0 });
    setAdd(null); // back to the tile menu (prototype tqAddCustomLabor).
  }

  function setLine(index: number, patch: Partial<BuildLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- save (prototype tqSavePrice) -----------------------------------------
  // Commit the built lines straight to the job — no signature, no on-site
  // approval (the office set the price). Map to JobLine[] and drop zero lines.

  // Close. The back-stack owns where that lands: pushed from a job record it pops back to it;
  // opened as a ROOT over the schedule board (the create flow, where the job's next step is a
  // slot, not a record sheet) it simply reveals the board. Never a dead end either way.
  function dismiss() {
    close();
  }

  // Persist the built lines to the job (v1.jobs.setLines) BEFORE closing so the
  // office-set price survives the next jobs.list refetch. Await the write and
  // only return on success — surface a retryable error otherwise.
  //
  // SAVING BOOKS THE PRICE. The rates ride the same write (derived from the same line
  // set, so they cannot describe a different subtotal), and an unpriced job's kind
  // flips estimate → work — the one-job-type model's commitment point. That flip is
  // what routes the tech's Quote tab to the booked read-back + change orders; a tech's
  // own draft stash never flips it, which is how a draft stays editable.
  async function savePrice() {
    if (!job || saving) return;
    const jobLines: JobLine[] = lines
      .map((l) => ({ d: l.d || "Line item", q: 1, r: lineAmt(l), c: l.c ?? 0 }))
      .filter((l) => (l.r ?? 0) > 0);
    setSaving(true);
    setSaveError(null);
    const rates = fieldPricingRates(
      pricing,
      jobLines.reduce((sum, l) => sum + Math.round((l.r ?? 0) * (l.q ?? 1) * 100), 0),
    );
    const { ok } = await setJobLines(job.id, jobLines, {
      discBps: rates.discBps,
      taxBps: rates.taxBps,
    });
    if (!ok) {
      setSaving(false);
      setSaveError("Couldn't save the price — check your connection and try again.");
      return;
    }
    if (isEstimateJob(job)) {
      const flip = await updateJob(job.id, { kind: "work" });
      if (!flip.ok) {
        // The price saved; the kind didn't. Booking is the point of the save, so surface it
        // for a retry rather than closing with the job half-flipped (the tech would still
        // see an editable draft over a price the office believes is booked).
        setSaving(false);
        setSaveError("The price saved, but booking it didn't stick — try Save again.");
        return;
      }
    }
    setSaving(false);
    dismiss();
  }

  return (
    <>
      {/* Sticky sheet header — the title as an <h2> over one calm meta line
          (task context · customer). The shell renders the ✕. */}
      <div className="sheet-head">
        <h2>Build the price</h2>
        <div className="sheet-meta">
          <span>Price the job · {custLabel(job, lead)}</span>
        </div>
      </div>

      {/* THE PRICE CARD — the lines, the one way to add to them, and the Total. Same shape as the
          field builder (tech-quote-builder), because it is the same job: the card renders even
          when empty so the add control has a fixed home, rather than floating below a card that
          only appears once the first line exists. */}
      <div className="card" style={{ marginBottom: "var(--space-4)" }}>
        {lines.map((l, i) => (
          <LineRow
            key={i}
            line={l}
            onSet={(patch) => setLine(i, patch)}
            onRemove={() => removeLine(i)}
          />
        ))}
        {/* Picking happens IN the card, under the lines it is about. */}
        {picking ? (
          <AddMenu
            sub={add}
            hasLines={lines.length > 0}
            pricebook={pricebook}
            laborRates={laborRates}
            onSetSub={setAdd}
            onPickBook={pickBook}
            onAddCustom={addCustom}
            onPickRate={pickRate}
            onAddCustomLabor={addCustomLabor}
            onDone={() => setPicking(false)}
          />
        ) : (
          <AddToQuoteRow
            onOpen={() => {
              setAdd(null);
              setPicking(true);
            }}
          />
        )}
        {/* No Total on an empty quote: nothing has been priced, so there is no figure to state
            and a $0 would be a claim about the job rather than a fact about the list. With a
            rate set, the single Total line becomes the full derivation — the arithmetic is the
            customer's business the moment it exists (same rule as the field builder). */}
        {lines.length === 0 ? null : editPriced ? (
          <PriceBreakdown totals={editTotals} rates={editRates} ruleColor="var(--line)" />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 800,
              fontSize: "var(--type-lg)",
              borderTop: "1px solid var(--line)",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-2)",
            }}
          >
            <span>Total</span>
            <span className="fig">{fmt$(total)}</span>
          </div>
        )}
      </div>

      {/* Discount / sales tax — the field builder's collapsed rows, appearing once a line is
          priced. No Deposit row here: jobs store no deposit rate (it rides the signed/sent
          document), and a control whose value silently evaporates on save is banned. */}
      {anyPriced ? (
        <FieldPricingRows
          pricing={pricing}
          subtotalCents={subtotalCents}
          showDeposit={false}
          onChange={setPricing}
        />
      ) : null}

      {saveError ? (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{saveError}</p>
      ) : null}

      {/* Sticky footer — ONE filled primary (the office single-tier save, prototype
          tqSavePrice) docked where the thumb is; Back stays quiet beside it. */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {/* Not "← Back": from the create flow there is nothing behind this but the board the
            user was sent to, and an arrow pointing at it is a lie. This says what leaving without
            a price actually means — the job is already saved, unpriced. */}
        <button className="btn ghost" onClick={dismiss} disabled={saving} style={{ flexShrink: 0 }}>
          Price later
        </button>
        <button
          className="sheet-pri"
          onClick={savePrice}
          disabled={!anyPriced || saving}
          style={{ flex: 1, opacity: anyPriced && !saving ? undefined : 0.45 }}
        >
          {saving ? "Saving…" : "Save price →"}
        </button>
      </div>
    </>
  );
}
