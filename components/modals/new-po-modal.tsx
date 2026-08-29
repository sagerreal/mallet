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
import { NoteComposer } from "@/components/shared/note-composer";
import { POLineTable } from "@/features/money/po-line-table";
import {
  PO_LABEL,
  STOCK_ORDER_LABEL,
  poLinesSummary,
  totalCents,
} from "@/features/money/po-defs";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/store/types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoPurchaseOrderToStore } from "@/lib/store/dto-mapper";
import { userMessage } from "@/lib/trpc/error-map";
import { jobAddr } from "@/features/jobs/jobs-helpers";
import { MAX_FILE_BYTES } from "@/lib/store/upload-job-file";
import {
  PO_NOTE_ATTACH_ACCEPT,
  uploadPONoteFile,
  type UploadedPONoteAttachment,
} from "@/lib/store/upload-po-note-file";

/** The extensions PO_NOTE_ATTACH_ACCEPT admits, as a set — mirrors staged-attachment.tsx's own
 *  derivation, but off the PURCHASING router's allowlist rather than the lead-note one. Validated
 *  at PICK time (before the order exists to upload against), same reasoning
 *  components/shared/staged-attachment.tsx documents: a rejected file must cost nothing, not a
 *  closed modal the office believes carried it. */
const PO_NOTE_EXTS = new Set(
  PO_NOTE_ATTACH_ACCEPT.split(",").map((e) => e.trim().replace(/^\./, "").toLowerCase()),
);
const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";

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
  // Needed only to resolve a selected job's service address for the ship-to prefill — see
  // handleJobChange below and jobAddr's own doc on why the store lead wins over the job's
  // per-read custAddr snapshot.
  const leads = useAppStore((s) => s.leads);
  const purchaseOrders = useAppStore((s) => s.purchaseOrders);
  const adoptPurchaseOrder = useAppStore((s) => s.adoptPurchaseOrder);
  const appendPONote = useAppStore((s) => s.appendPONote);

  // Vendors ALREADY USED, not a fixture list — house rule is no demo/sample data. An empty
  // datalist on a shop's first order is correct: there is nothing to suggest yet.
  const vendorSuggestions = [...new Set(purchaseOrders.map((po) => po.vendor).filter((v) => v.trim()))].sort((a, b) =>
    a.localeCompare(b),
  );

  const [vendor, setVendor] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [lines, setLines] = useState<PurchaseOrderLine[]>([blankLine()]);
  const [expectedAt, setExpectedAt] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");
  const [freight, setFreight] = useState(0);
  const [tax, setTax] = useState(0);
  // The one staged note, typed in the shared NoteComposer — same control the record sheet
  // renders, reused rather than hand-rolled a second time (see the file's own header comment).
  const [noteBody, setNoteBody] = useState("");
  // The staged file rides in a ref (never re-rendered on its own) plus a display name for the
  // DisclosureRow's own collapsed value — mirrors new-job-modal.tsx's staged.file/staged.name
  // split, just without useStagedAttachment's hook (that hook validates against the LEAD note
  // allowlist; this validates against the PURCHASING one — see PO_NOTE_EXTS above).
  const noteFileRef = useRef<File | null>(null);
  const [noteFileName, setNoteFileName] = useState<string | null>(null);
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

  /**
   * Picking a job defaults Ship to, to that job's service address — but only while the field is
   * still empty. This is the whole reason a dropdown was chosen originally ("a free-text ship-to
   * never gets the job address right"); prefilling solves it without taking the typing away, and
   * never overwrites an address someone already typed.
   */
  const handleJobChange = (v: string): void => {
    setJobId(v);
    if (!v || shipToAddress.trim()) return;
    const job = jobs.find((j) => j.id === v);
    const addr = job ? jobAddr(job, leads) : "";
    if (addr) setShipToAddress(addr);
  };

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
      shipToAddress: shipToAddress.trim() || null,
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

  /**
   * Add the staged note (text and/or file) to the now-created order. Returns false with the
   * reason on screen, and leaves the modal open rather than closing it, when the FILE fails to
   * attach — the order itself is already saved by this point, so a swallowed failure here would
   * close the modal on an office that believes its note (a counter receipt, a permit) went with
   * it. Mirrors new-job-modal.tsx's attachStagedFile.
   */
  async function attachStagedNote(poId: string): Promise<boolean> {
    const file = noteFileRef.current;
    if (!noteBody.trim() && !file) return true;
    let attachment: UploadedPONoteAttachment | undefined;
    if (file) {
      try {
        attachment = await uploadPONoteFile(poId, file);
      } catch (err: unknown) {
        setError(userMessage(err, "The order was saved, but the note's file wasn't — open it to try again."));
        return false;
      }
    }
    appendPONote(poId, { body: noteBody.trim(), ...(attachment ? { attachment } : {}) });
    return true;
  }

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
        shipToAddress: shipToAddress.trim() || null,
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

    if (!(await attachStagedNote(createdDto.id))) {
      // The order is saved; only the note's file failed. Leave the modal open on the error
      // rather than closing over a silent loss — see attachStagedNote's own doc.
      inFlightRef.current = false;
      setSavingPath(null);
      return;
    }

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
            {vendorSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>

        <Field label={PO_LABEL.job}>
          <SelectMenu
            value={jobId}
            onChange={handleJobChange}
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
            value={shipToAddress.trim() || "no address"}
            open={staged === "ship"}
            onToggle={toggle("ship")}
          >
            <Field label={PO_LABEL.shipTo} style={{ margin: 0 }}>
              <input
                type="text"
                value={shipToAddress}
                placeholder="counter pickup, or an address"
                aria-label={PO_LABEL.shipTo}
                onChange={(e) => setShipToAddress(e.target.value)}
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

          {/* One STAGED note on CREATE — a record that does not exist yet has no trail to append
              to. Reuses the same NoteComposer the record sheet's Notes chapter renders (never a
              second, hand-rolled control): attaching happens on pick as usual, but the file rides
              in noteFileRef rather than uploading immediately (there is no poId to upload against
              yet — see uploadPONoteFile), and the composer's "Add note" merely stages the typed
              text rather than persisting it. Both are flushed together, once, by
              attachStagedNote() after the order is created. */}
          <DisclosureRow
            label="Notes"
            value={noteBody.trim() || (noteFileName ? `1 file · ${noteFileName}` : "Add")}
            open={staged === "notes"}
            onToggle={toggle("notes")}
          >
            <NoteComposer
              placeholder="gate code, who to chase…"
              attachAccept={PO_NOTE_ATTACH_ACCEPT}
              onAttachFile={async (file) => {
                const ext = extOf(file.name);
                if (!PO_NOTE_EXTS.has(ext)) throw new Error(`Can't attach a .${ext || "unknown"} file.`);
                if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 10 MB.");
                noteFileRef.current = file;
                setNoteFileName(file.name);
              }}
              onAttachFileClear={() => {
                noteFileRef.current = null;
                setNoteFileName(null);
              }}
              onSubmit={(text) => {
                setNoteBody(text);
              }}
            />
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
