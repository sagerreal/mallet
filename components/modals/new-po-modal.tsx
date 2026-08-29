"use client";

/**
 * components/modals/new-po-modal.tsx — WRITING an order that does not exist yet.
 *
 * Twin of po-modal/po-modal.tsx. The two must feel like one record, and the mechanism for that is
 * not discipline: both import features/money/po-defs.ts for the labels, the field ORDER and the
 * status vocabulary, and both render features/money/po-line-table.tsx. If a field appears in both
 * it carries the same label, the same position and the same input.
 *
 * WHERE THEY DIFFER, AND WHY. Create is a FORM — the two essentials open with autoFocus, the rest
 * staged in DisclosureRows, one atomic submit. The record sheet is CHAPTERS — everything shut on
 * arrival, written per field on blur, no Save button. That split is the codebase's existing
 * register (new-job-modal vs job-modal): a create modal never uses SheetRow, a record sheet never
 * uses DisclosureRow. Create also simply LACKS what a new record cannot have — a status, a
 * number, a placed date.
 *
 * PORTED FROM po-create-modal.tsx (mock/money-purchase-orders). The mock's single `onCreate`
 * callback is now a real two-step server round trip: v1.purchasing.create always mints a DRAFT
 * (the server enforces this — a placed order needs a gapless number that only place() allocates),
 * so "Order it →" creates, then places, then adopts whichever DTO is the final truth. A failure
 * partway (the draft saved, placing it did not) still adopts the draft rather than losing it or
 * risking a duplicate create on retry.
 */

import { useRef, useState } from "react";
import { useAppStore, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { Field } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { DraftNumberInput } from "@/components/shared/draft-number-input";
import { POLineTable } from "@/features/money/po-line-table";
import {
  PO_LABEL,
  SHIP_TO_LABEL,
  STOCK_ORDER_LABEL,
  poLinesSummary,
  totalCents,
} from "@/features/money/po-defs";
import type { POShipTo, PurchaseOrder, PurchaseOrderLine } from "@/lib/store/types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoPurchaseOrderToStore } from "@/lib/store/dto-mapper";
import { userMessage } from "@/lib/trpc/error-map";

const VENDOR_SUGGESTIONS = ["Ferguson", "Home Depot", "SupplyHouse", "Winsupply"];

const blankLine = (): PurchaseOrderLine => ({
  id: crypto.randomUUID(),
  description: "",
  qty: 1,
  uom: "ea",
  unitCostMillicents: 0,
  amount: 0,
});

/** The staged (below-the-essentials) rows — one open at a time. */
type RowKey = "when" | "ship" | "money" | "notes";

export function NewPOModal() {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const adoptPurchaseOrder = useAppStore((s) => s.adoptPurchaseOrder);
  const appendPONote = useAppStore((s) => s.appendPONote);

  const [vendor, setVendor] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [lines, setLines] = useState<PurchaseOrderLine[]>([blankLine()]);
  const [expectedAt, setExpectedAt] = useState("");
  const [shipTo, setShipTo] = useState<POShipTo>("counter_pickup");
  const [freight, setFreight] = useState(0);
  const [tax, setTax] = useState(0);
  const [note, setNote] = useState("");
  const [staged, setStaged] = useState<RowKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const [savingPath, setSavingPath] = useState<null | "draft" | "place">(null);
  const saving = savingPath !== null;

  const jobOptions = [...jobs]
    .map((j) => ({ value: j.id, label: j.title }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const patchLine = (id: string, p: Partial<PurchaseOrderLine>): void =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  /** A full local `PurchaseOrder` shape, for the shared summary/total helpers only — `id`/
   *  `total`/`createdAt` etc. are placeholders never read for a not-yet-persisted draft (the
   *  helpers always recompute the money figures from lines/freight/tax, never from these). */
  function draft(): PurchaseOrder {
    return {
      id: "new",
      num: null,
      vendor: vendor.trim(),
      status: "draft",
      jobId: jobId || null,
      jobTitle: jobs.find((j) => j.id === jobId)?.title ?? null,
      orderedAt: null,
      expectedAt: expectedAt || null,
      shipTo,
      orderedByUserId: null,
      orderedByName: null,
      freight,
      tax,
      total: 0,
      lines,
      createdAt: new Date().toISOString(),
      notes: [],
    };
  }

  const toggle = (k: RowKey) => () => setStaged((s) => (s === k ? null : k));

  async function submit(place: boolean): Promise<void> {
    if (inFlightRef.current) return;
    if (!vendor.trim()) {
      setError("Who is this order with? A PO needs a vendor.");
      return;
    }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (place && cleanLines.length === 0) {
      setError("Add at least one line — an order with nothing on it cannot be placed.");
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setSavingPath(place ? "place" : "draft");

    let createdDto: Awaited<ReturnType<typeof trpcVanilla.v1.purchasing.create.mutate>>;
    try {
      createdDto = await trpcVanilla.v1.purchasing.create.mutate({
        id: crypto.randomUUID(),
        vendor: vendor.trim(),
        jobId: jobId || null,
        expectedAt: expectedAt || null,
        shipTo,
        freightCents: Math.round(freight * 100),
        taxCents: Math.round(tax * 100),
        lines: cleanLines.map((l) => ({
          id: l.id,
          description: l.description.trim(),
          qty: l.qty,
          uom: l.uom.trim() || "ea",
          unitCostMillicents: l.unitCostMillicents,
        })),
      });
    } catch (err: unknown) {
      setError(userMessage(err, "Couldn't save the purchase order — check your connection and try again."));
      inFlightRef.current = false;
      setSavingPath(null);
      return;
    }

    // The draft is real the moment create() answers — adopt it before anything else can fail, so
    // a placement error below never loses it or tempts a retry into minting a duplicate.
    adoptPurchaseOrder(dtoPurchaseOrderToStore(createdDto));
    if (note.trim()) appendPONote(createdDto.id, { body: note.trim() });

    if (!place) {
      close();
      openModal(MODAL.PO, { poId: createdDto.id });
      inFlightRef.current = false;
      setSavingPath(null);
      return;
    }

    try {
      const placedDto = await trpcVanilla.v1.purchasing.place.mutate({ poId: createdDto.id });
      adoptPurchaseOrder(dtoPurchaseOrderToStore(placedDto));
    } catch (err: unknown) {
      // The draft exists and is already visible; only placing it failed. Say so and hand off to
      // the record sheet rather than re-running create with a fresh client id.
      setError(userMessage(err, "Saved as a draft, but couldn't place the order — open it to try again."));
    } finally {
      close();
      openModal(MODAL.PO, { poId: createdDto.id });
      inFlightRef.current = false;
      setSavingPath(null);
    }
  }

  return (
    <div className="po-scope">
      <div className="sheet-head">
        <h2>New purchase order</h2>
      </div>

      {/* No type="submit" anywhere: Enter in the vendor box must never place an order. */}
      <form onSubmit={(e) => e.preventDefault()}>
        {/* THE TWO ESSENTIALS, open — same first two fields, in the same order, as the record
            sheet's Order chapter. */}
        <Field label={PO_LABEL.vendor}>
          <input
            type="text"
            value={vendor}
            autoFocus
            list="po-vendors"
            placeholder="Ferguson"
            onChange={(e) => {
              setVendor(e.target.value);
              setError(null);
            }}
          />
          {/* Free text over a datalist of vendors already used — no vendor table yet. */}
          <datalist id="po-vendors">
            {VENDOR_SUGGESTIONS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>

        <Field label={PO_LABEL.job}>
          <SelectMenu
            value={jobId}
            onChange={setJobId}
            options={[{ value: "", label: STOCK_ORDER_LABEL }, ...jobOptions]}
            aria-label={PO_LABEL.job}
          />
        </Field>

        <div style={{ marginTop: "var(--space-4)" }}>
          <span className="lab">Lines</span>
          <POLineTable
            lines={lines}
            onChange={patchLine}
            onRemove={(id) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.id !== id)))}
            onAdd={() => setLines((ls) => [...ls, blankLine()])}
          />
        </div>

        {/* Everything else staged — the collapsed value is the CURRENT value, never a hint. */}
        <div style={{ marginTop: "var(--space-4)" }}>
          <DisclosureRow
            label={PO_LABEL.expectedAt}
            value={expectedAt || "not set"}
            open={staged === "when"}
            onToggle={toggle("when")}
          >
            <Field label={PO_LABEL.expectedAt} style={{ margin: 0 }}>
              <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </Field>
          </DisclosureRow>

          <DisclosureRow
            label={PO_LABEL.shipTo}
            value={SHIP_TO_LABEL[shipTo]}
            open={staged === "ship"}
            onToggle={toggle("ship")}
          >
            <Field label={PO_LABEL.shipTo} style={{ margin: 0 }}>
              <SelectMenu
                value={shipTo}
                onChange={(v) => setShipTo(v as POShipTo)}
                options={(Object.keys(SHIP_TO_LABEL) as POShipTo[]).map((k) => ({ value: k, label: SHIP_TO_LABEL[k] }))}
                aria-label={PO_LABEL.shipTo}
              />
            </Field>
          </DisclosureRow>

          <DisclosureRow
            label="Freight &amp; tax"
            value={freight || tax ? poLinesSummary(draft()) : "none"}
            open={staged === "money"}
            onToggle={toggle("money")}
          >
            <div className="sheet-inline">
              <Field label={PO_LABEL.freight} style={{ margin: 0 }}>
                <DraftNumberInput
                  value={freight}
                  decimals={2}
                  aria-label={PO_LABEL.freight}
                  onCommit={setFreight}
                />
              </Field>
              <Field label={PO_LABEL.tax} style={{ margin: 0 }}>
                <DraftNumberInput value={tax} decimals={2} aria-label={PO_LABEL.tax} onCommit={setTax} />
              </Field>
            </div>
          </DisclosureRow>

          {/* One box on CREATE — a record that does not exist yet has no trail to append to and
              nothing to clip a file to. The record sheet's Notes chapter is the full feed. */}
          <DisclosureRow label="Notes" value={note.trim() || "Add"} open={staged === "notes"} onToggle={toggle("notes")}>
            <Field label="Notes" style={{ margin: 0 }}>
              <input
                type="text"
                value={note}
                placeholder="gate code, who to chase…"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </DisclosureRow>
        </div>

        {error && <p role="alert" style={{ color: "var(--red)", margin: "var(--space-3) 0 0" }}>{error}</p>}

        <div className="sheet-foot">
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
            <button type="button" className="btn ghost" style={{ flexShrink: 0, minHeight: 44 }} onClick={close} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
              onClick={() => void submit(false)}
              disabled={saving}
            >
              {savingPath === "draft" ? "Saving…" : "Save as draft"}
            </button>
            <button
              type="button"
              className="sheet-pri"
              style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
              onClick={() => void submit(true)}
              disabled={saving}
            >
              {savingPath === "place" ? "Ordering…" : "Order it →"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Exported for tests / any surface wanting the same total the record sheet shows. */
export const createTotal = totalCents;
