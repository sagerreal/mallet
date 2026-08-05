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
 *   - the built line list (.card) with per-line editable rows + a per-tier Total
 *   - the "+ Add a line" builder: a 2×2 .addgrid of .addtile tiles
 *       Pricebook (browse saved items) · Custom item (one-off price)
 *       Labor    (browse your rates $/hr) · Custom labor (one-off $/hr)
 *     browsing a sublist stays open while building (adding does NOT collapse it)
 *   - the sticky .sheet-foot: ONE .sheet-pri "Save price →" (tqSavePrice) →
 *     updateJob(jobId, { lines }); "Price later" stays a quiet ghost beside it
 *
 * OUT OF SCOPE — correctly, for office single-tier mode (fromCreate=true):
 *   - the Good/Better/Best tier selector + the "Give the customer choices?"
 *     opt-in (prototype gates both on !tq.fromCreate) — office pricing is
 *     single-tier, so no tier chips and no per-tier tabs.
 *   - the "Present → / on glass" flow and the customer signature / sign sheet
 *     (tqPresent / tqSign / tqSigInit) — that is the crew's customer-facing
 *     path (see tech-quote-modal.tsx), never the office save path.
 */

"use client";

import { useMemo, useState } from "react";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, JobLine, Service } from "@/lib/store/types";
import type { LaborRate as StoreLaborRate } from "@/lib/store/slices/settings-slice";
import {
  type AddSub,
  type BuildLine,
  type LaborRate,
  type PricebookItem,
  AddMenu,
  LineRow,
  custLabel,
  lineAmt,
  linesTotal,
  seedLines,
} from "./pricing/build-line";
import { fmt$ } from "@/lib/format";

// ---- the modal body --------------------------------------------------------

export function PriceBuilderModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const setJobLines = useAppStore((s) => s.setJobLines);
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

  if (!job) return null;

  const lead = leads.find((l) => l.id === job.leadId);
  const total = linesTotal(lines);
  const anyPriced = total > 0;

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
  async function savePrice() {
    if (!job || saving) return;
    const jobLines: JobLine[] = lines
      .map((l) => ({ d: l.d || "Line item", q: 1, r: lineAmt(l), c: l.c ?? 0 }))
      .filter((l) => (l.r ?? 0) > 0);
    setSaving(true);
    setSaveError(null);
    const { ok } = await setJobLines(job.id, jobLines);
    setSaving(false);
    if (!ok) {
      setSaveError("Couldn't save the price — check your connection and try again.");
      return;
    }
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

      {/* Built line list + single-tier Total */}
      {lines.length ? (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          {lines.map((l, i) => (
            <LineRow
              key={i}
              line={l}
              onSet={(patch) => setLine(i, patch)}
              onRemove={() => removeLine(i)}
            />
          ))}
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
        </div>
      ) : null}

      {/* "+ Add a line" — open menu (picking) or the collapsed entry button */}
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
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => {
              setAdd(null);
              setPicking(true);
            }}
          >
            + Add a line
          </button>
        </div>
      )}

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
