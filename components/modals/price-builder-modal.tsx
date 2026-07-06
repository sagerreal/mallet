/**
 * components/modals/price-builder-modal.tsx
 * Faithful port of the prototype tech-quote builder (openTechQuote / tqRender /
 * tqSavePrice, prototype 7230-7339) in its OFFICE single-tier mode — the same
 * builder the crew uses, opened from the job's "Build the price" / "Edit" via
 * jobBuildPrice(id) which sets state.tq.fromCreate=true (prototype 4511).
 *
 * The line-building primitives (BuildLine model, lineAmt / linesTotal / seedLines,
 * fmt$ / custLabel, and the AddMenu / LineRow render pieces) are shared with the
 * tech GBB builder and live in ./pricing/build-line. The pricebook + labor rates
 * are read from the store and adapted to the shared PricebookItem / LaborRate
 * shape here, then handed to AddMenu as props.
 *
 * OFFICE single-tier mode (fromCreate=true) renders:
 *   - the eyebrow "PRICE THE JOB · <customer>" + <h2>Build the price</h2>
 *   - the built line list (.card) with per-line editable rows + a per-tier Total
 *   - the "+ Add a line" builder: a 2×2 .addgrid of .addtile tiles
 *       Pricebook (browse saved items) · Custom item (one-off price)
 *       Labor    (browse your rates $/hr) · Custom labor (one-off $/hr)
 *     browsing a sublist stays open while building (adding does NOT collapse it)
 *   - the footer "Save price →" (tqSavePrice) → updateJob(jobId, { lines })
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
import { useAppStore, useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, JobLine } from "@/lib/store/types";
import type { PbItem, LaborRate as StoreLaborRate } from "@/lib/store/slices/settings-slice";
import {
  type AddSub,
  type BuildLine,
  type LaborRate,
  type PricebookItem,
  AddMenu,
  LineRow,
  custLabel,
  fmt$,
  lineAmt,
  linesTotal,
  seedLines,
} from "./pricing/build-line";

// ---- the modal body --------------------------------------------------------

export function PriceBuilderModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const updateJob = useAppStore((s) => s.updateJob);
  // Reference data straight from the store (raw arrays — never derived in the
  // selector). Adapted below to the shared PricebookItem / LaborRate shape.
  const pricebookRaw = useAppStore((s) => s.pricebook);
  const laborRatesRaw = useAppStore((s) => s.laborRates);

  const pricebook: PricebookItem[] = useMemo(
    () => pricebookRaw.map((p: PbItem) => ({ d: p.d, r: p.r, c: p.c })),
    [pricebookRaw],
  );
  const laborRates: LaborRate[] = useMemo(
    () => laborRatesRaw.map((r: StoreLaborRate) => ({ name: r.name, rate: r.rate })),
    [laborRatesRaw],
  );

  const jobId = activeModal?.params?.jobId as number | undefined;
  const job = jobs.find((j) => j.id === jobId);

  // builder line set — seeded once from the job's existing lines so re-opening
  // ("Edit") builds on top of the current price, never loses it.
  const [lines, setLines] = useState<BuildLine[]>(() => (job ? seedLines(job) : []));
  // add-a-line menu: open (picking) once there are no lines to seed from, plus
  // which sublist (pb / labor) is showing.
  const [picking, setPicking] = useState<boolean>(() => !job || seedLines(job).length === 0);
  const [add, setAdd] = useState<AddSub>(null);

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
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: r.rate });
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

  // Close back to the job it came from (prototype tqClose re-opens openJob) —
  // so ✕ / Back land on the job, never a dead-end blank list.
  function returnToJob() {
    if (job) openModal(MODAL.JOB, { jobId: job.id });
    else close();
  }

  function savePrice() {
    if (!job) return;
    const jobLines: JobLine[] = lines
      .map((l) => ({ d: l.d || "Line item", q: 1, r: lineAmt(l), c: l.c ?? 0 }))
      .filter((l) => l.r > 0);
    updateJob(job.id, { lines: jobLines });
    returnToJob();
  }

  return (
    <div>
      {/* Header — eyebrow + title (office single-tier: "Price the job") */}
      <button className="x" onClick={returnToJob}>
        ✕
      </button>
      <div
        className="muted"
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--green-700)",
        }}
      >
        Price the job · {custLabel(job, lead)}
      </div>
      <h2 style={{ marginBottom: 14 }}>Build the price</h2>

      {/* Built line list + single-tier Total */}
      {lines.length ? (
        <div className="card" style={{ marginBottom: 14 }}>
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
              fontSize: 16,
              borderTop: "1px solid var(--line)",
              marginTop: 8,
              paddingTop: 9,
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

      {/* Footer — Back to the job + office single-tier save (prototype tqSavePrice) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 18,
        }}
      >
        <button className="btn ghost" onClick={returnToJob}>
          ← Back
        </button>
        <button
          className="btn primary"
          onClick={savePrice}
          disabled={!anyPriced}
          style={anyPriced ? undefined : { opacity: 0.45 }}
        >
          Save price →
        </button>
      </div>
    </div>
  );
}
