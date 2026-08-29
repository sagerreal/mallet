"use client";

/**
 * components/modals/po-modal/po-modal.tsx — READING an order that exists.
 *
 * Chapters, because you arrive to check one thing. Ported from po-view-modal.tsx on
 * mock/money-purchase-orders. Its twin is ../new-po-modal.tsx. Both read
 * features/money/po-defs.ts for labels, field order and the status vocabulary, and both render
 * features/money/po-line-table.tsx — so the two cannot drift.
 *
 * The mock's single `onPatch` callback is now real store actions, split by what the server
 * actually accepts: `updatePurchaseOrder` writes vendor/job/dates/ship-to/freight/tax/lines per
 * field ON BLUR (no Save button, no per-keystroke network write); a status change — placing or
 * cancelling — is its own server endpoint (v1.purchasing.place / .cancel), not update()'s, so
 * those go through trpcVanilla directly and adopt the returned DTO.
 */

import { useEffect, useRef, useState } from "react";
import { useAppStore, useCloseModal, useActiveModal } from "@/lib/store/app-store";
import { SheetRow } from "../sheet-row";
import { NoteComposer } from "@/components/shared/note-composer";
import { NoteChip } from "../lead-modal/note-row";
import { Field } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { DraftNumberInput } from "@/components/shared/draft-number-input";
import { ModalLoading } from "../modal-loading";
import { POLineTable } from "@/features/money/po-line-table";
import {
  PO_LABEL,
  PO_STATUS_META,
  SHIP_TO_LABEL,
  STOCK_ORDER_LABEL,
  poLinesSummary,
  poNotesSummary,
  poOrderSummary,
  subtotalCents,
  totalCents,
} from "@/features/money/po-defs";
import type { POShipTo, PurchaseOrder, PurchaseOrderLine, PurchaseOrderNote } from "@/lib/store/types";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoPurchaseOrderToStore, dtoPurchaseOrderNoteToStore } from "@/lib/store/dto-mapper";
import {
  uploadPONoteFile,
  PO_NOTE_ATTACH_ACCEPT,
  type UploadedPONoteAttachment,
} from "@/lib/store/upload-po-note-file";
import { userMessage } from "@/lib/trpc/error-map";
import { shortWhen } from "@/lib/format";

const money = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

/** Reads the LIVE staged lines/freight/tax, not the store's last-committed values, so the total
 *  updates as you type instead of only after the next blur commit lands. */
function Totals({
  po,
  lines,
  freight,
  tax,
}: {
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  freight: number;
  tax: number;
}) {
  const live: PurchaseOrder = { ...po, lines, freight, tax };
  const rows: Array<[string, number, boolean]> = [
    ["Subtotal", subtotalCents(live), false],
    [PO_LABEL.freight, Math.round(freight * 100), false],
    [PO_LABEL.tax, Math.round(tax * 100), false],
    ["Order total", totalCents(live), true],
  ];
  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      {rows.map(([l, c, strong]) => (
        <div
          key={l}
          style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-4)", padding: "var(--space-1) 0" }}
        >
          <span className="muted">{l}</span>
          <span
            style={{
              ...MONO,
              minWidth: 92,
              textAlign: "right",
              fontWeight: strong ? 700 : 500,
              color: strong ? "var(--red)" : undefined,
            }}
          >
            {money(c)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * One note's attachment, opened via purchasing's OWN noteViewUrl — never
 * components/modals/lead-modal/note-row.tsx's NoteAttachment, which is hardcoded to
 * v1.customers.noteViewUrl and would mint a link against the wrong record entirely. Same shape
 * (mint short-lived URL on click, open the tab created before the await so a popup blocker does
 * not eat it) as every other note surface's attachment control.
 */
function PONoteAttachment({ poId, noteId, name }: { poId: string; noteId: string; name: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (opening) return;
    setError(null);
    setOpening(true);
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await trpcVanilla.v1.purchasing.noteViewUrl.mutate({ poId, id: noteId });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError("That file wouldn't open — try again.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-1)" }}>
      <button
        type="button"
        className="linklike"
        style={{
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
        }}
        onClick={() => void open()}
        aria-busy={opening ? true : undefined}
      >
        {opening ? "Opening…" : name}
      </button>
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One entry in the Notes feed — the same .nrow/.nmeta/.ntext markup NoteRow renders (NoteChip is
 * the same shared piece), so the trail reads identically to every other note surface. Not NoteRow
 * itself: that component's attachment slot is hardcoded to the lead's noteViewUrl, and a purchase
 * order is a different record with its own endpoint.
 */
function PONoteRow({ poId, note }: { poId: string; note: PurchaseOrderNote }) {
  return (
    <div className="nrow">
      <div className="nmeta">
        <NoteChip type="note" />
        <span className="nwho">
          {note.authorName ?? "Office"}
          {note.createdAt ? ` · ${shortWhen(note.createdAt)}` : ""}
        </span>
      </div>
      {note.body && <div className="ntext">{note.body}</div>}
      {note.attachment && <PONoteAttachment poId={poId} noteId={note.id} name={note.attachment.name} />}
    </div>
  );
}

export interface POModalProps {
  poId: string;
}

export function POModal({ poId }: POModalProps) {
  const po = useAppStore((s) => s.purchaseOrders.find((p) => p.id === poId));
  const jobs = useAppStore((s) => s.jobs);
  const updatePurchaseOrder = useAppStore((s) => s.updatePurchaseOrder);
  const removePurchaseOrder = useAppStore((s) => s.removePurchaseOrder);
  const appendPONote = useAppStore((s) => s.appendPONote);
  const adoptPurchaseOrder = useAppStore((s) => s.adoptPurchaseOrder);
  const close = useCloseModal();

  const [open, setOpen] = useState<string | null>(null);
  const chapter = (k: string) => ({ open: open === k, onOpenChange: (v: boolean) => setOpen(v ? k : null) });

  /**
   * LOCAL STAGED lines/freight/tax. po-line-table.tsx's DraftNumberInput calls `onChange` on
   * every keystroke by design — the create form uses that locally, for free, since it has no
   * server row yet. This sheet is the one caller for whom that would otherwise be a real network
   * write per keystroke, which the brief's "per-field write on blur, no Save button" forbids.
   * Typing updates this local mirror instantly (so the Amount column and the totals below track
   * what is on screen); a blur anywhere in the chapter commits it in one `updatePurchaseOrder`.
   */
  const [lines, setLines] = useState<PurchaseOrderLine[]>(po?.lines ?? []);
  const [freight, setFreight] = useState(po?.freight ?? 0);
  const [tax, setTax] = useState(po?.tax ?? 0);
  const dirtyRef = useRef(false);

  useEffect(() => {
    // Resync from the store whenever the record's own fields change — UNLESS an edit here is
    // mid-flight, so a reconcile triggered by an unrelated field's blur cannot clobber it.
    if (po && !dirtyRef.current) {
      setLines(po.lines);
      setFreight(po.freight);
      setTax(po.tax);
    }
  }, [po]);

  /**
   * THE NOTE TRAIL, from the database. No DTO on this router carries notes (list/create/update/
   * place/cancel all omit them — see dtoPurchaseOrderToStore's own comment), so a fresh page load
   * hydrates this record with `notes: []` even when the server holds a real trail; without this
   * fetch, the sheet would show "Add" on an order somebody already wrote a note against, the same
   * bug the job sheet's own listNotes fetch exists to prevent for a customer's notes. Reused
   * adoptPurchaseOrder as the write path — see purchase-orders-slice.ts's own doc on why no new
   * action was needed for this.
   */
  const notesQ = api.v1.purchasing.listNotes.useQuery({ poId }, { staleTime: 30_000, refetchOnWindowFocus: false });
  useEffect(() => {
    const items = notesQ.data?.items;
    if (!items || !po) return;
    adoptPurchaseOrder({ ...po, notes: items.map(dtoPurchaseOrderNoteToStore) });
    // Keyed off the id STRING, never the `po` object: adoptPurchaseOrder returns a fresh record
    // every call, so a `po` dependency here would re-fire itself forever — same reasoning
    // job-modal.tsx's own custNotesQ effect gives for keying off custLeadId instead of `lead`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesQ.data, poId, adoptPurchaseOrder]);

  // The file picked for the note being written — it rides the entry, same as the job and
  // customer sheets (components/modals/lead-modal/lead-notes.tsx).
  const pendingAtt = useRef<UploadedPONoteAttachment | null>(null);

  const [placeBusy, setPlaceBusy] = useState(false);
  const [footError, setFootError] = useState<string | null>(null);

  if (!po) return <ModalLoading size="lg" />;

  const m = PO_STATUS_META[po.status];
  const isDraft = po.status === "draft";
  const isCancelled = po.status === "cancelled";

  // The closures below use the `poId` PROP (a plain string, never undefined) rather than `po.id`
  // — and are ARROW expressions, not function declarations, so TypeScript's narrowing of `po`
  // (possibly undefined before the guard above) still holds wherever they do read `po` directly;
  // a hoisted function declaration would not narrow.

  const jobOptions = [...jobs]
    .map((j) => ({ value: j.id, label: j.title }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const commitLines = (nextLines: PurchaseOrderLine[]): void => {
    dirtyRef.current = false;
    updatePurchaseOrder(poId, { lines: nextLines, freight, tax });
  };
  const patchLine = (id: string, patch: Partial<PurchaseOrderLine>): void => {
    dirtyRef.current = true;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const removeLine = (id: string): void => {
    const next = lines.filter((l) => l.id !== id);
    setLines(next);
    commitLines(next);
  };
  const addLine = (): void => {
    dirtyRef.current = true;
    setLines((ls) => [
      ...ls,
      { id: crypto.randomUUID(), description: "", qty: 1, uom: "ea", unitCostMillicents: 0, amount: 0 },
    ]);
  };
  const onLinesChapterBlur = (): void => {
    if (!dirtyRef.current) return;
    commitLines(lines);
  };

  const place = async (): Promise<void> => {
    setFootError(null);
    setPlaceBusy(true);
    try {
      const dto = await trpcVanilla.v1.purchasing.place.mutate({ poId });
      adoptPurchaseOrder(dtoPurchaseOrderToStore(dto));
    } catch (err: unknown) {
      setFootError(userMessage(err, "Couldn't place the order — check your connection and try again."));
    } finally {
      setPlaceBusy(false);
    }
  };

  const cancelOrder = async (): Promise<void> => {
    setFootError(null);
    setPlaceBusy(true);
    try {
      const dto = await trpcVanilla.v1.purchasing.cancel.mutate({ poId });
      adoptPurchaseOrder(dtoPurchaseOrderToStore(dto));
    } catch (err: unknown) {
      setFootError(userMessage(err, "Couldn't cancel the order — check your connection and try again."));
    } finally {
      setPlaceBusy(false);
    }
  };

  const deleteDraft = (): void => {
    removePurchaseOrder(poId);
    close();
  };

  return (
    <div className="po-scope">
      <div className="sheet-head">
        {/* The VENDOR is the title — "the Ferguson order" is what people call it. The number is
            a reference, and a draft does not have one yet. */}
        <h2>{po.vendor}</h2>
        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}
        >
          <span className="stpill" style={{ color: m.c, background: m.bg }}>
            {m.label}
          </span>
          <span className="muted">
            {po.num ?? "unnumbered"} ·{" "}
            {po.jobTitle ? (
              <>
                for <b>{po.jobTitle}</b>
              </>
            ) : (
              "stock order"
            )}
          </span>
        </div>
      </div>

      <div className="sheet-rows">
        {/* ORDER — the facts. Every one of these was read-only text before. */}
        <SheetRow variant="section" label="Order" value={poOrderSummary(po)} expandable {...chapter("order")}>
          <div className="sheet-inline">
            <Field label={PO_LABEL.vendor} style={{ margin: 0 }}>
              <input
                type="text"
                defaultValue={po.vendor}
                disabled={isCancelled}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== po.vendor) updatePurchaseOrder(po.id, { vendor: v });
                }}
              />
            </Field>
            <Field label={PO_LABEL.job} style={{ margin: 0 }}>
              <SelectMenu
                value={po.jobId ?? ""}
                onChange={(v) => updatePurchaseOrder(po.id, { jobId: v || null })}
                options={[{ value: "", label: STOCK_ORDER_LABEL }, ...jobOptions]}
                aria-label={PO_LABEL.job}
                disabled={isCancelled}
              />
            </Field>
            {/* Stamped, never asked — see PO_LABEL.orderedBy below. Placing the order is the only
                way this fills in (v1.purchasing.place), so it is never an editable box. */}
            <Field label={PO_LABEL.orderedAt} style={{ margin: 0 }}>
              <input type="text" value={po.orderedAt ?? "—"} disabled readOnly />
            </Field>
            <Field label={PO_LABEL.expectedAt} style={{ margin: 0 }}>
              <input
                type="date"
                defaultValue={po.expectedAt ?? ""}
                disabled={isCancelled}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  if (v !== po.expectedAt) updatePurchaseOrder(po.id, { expectedAt: v });
                }}
              />
            </Field>
            <Field label={PO_LABEL.shipTo} style={{ margin: 0 }}>
              <SelectMenu
                value={po.shipTo}
                onChange={(v) => updatePurchaseOrder(po.id, { shipTo: v as POShipTo })}
                options={(Object.keys(SHIP_TO_LABEL) as POShipTo[]).map((k) => ({ value: k, label: SHIP_TO_LABEL[k] }))}
                aria-label={PO_LABEL.shipTo}
                disabled={isCancelled}
              />
            </Field>
            {/* Stamped, never asked. "Who put a $2,140 boiler on the shop account" is a real
                question, and it is also who to call about the order. */}
            <Field label={PO_LABEL.orderedBy} style={{ margin: 0 }}>
              <input type="text" value={po.orderedByName ?? "—"} disabled readOnly />
            </Field>
          </div>
        </SheetRow>

        {/* LINES — the same table the create modal renders. Frozen once ordered. */}
        <SheetRow
          variant="section"
          label="Lines"
          value={poLinesSummary({ ...po, lines, freight, tax })}
          valueIsHint={lines.length === 0}
          expandable
          {...chapter("lines")}
        >
          <div onBlur={onLinesChapterBlur}>
            <POLineTable
              lines={lines}
              readOnly={!isDraft}
              onChange={isDraft ? patchLine : undefined}
              onRemove={isDraft ? removeLine : undefined}
              onAdd={isDraft ? addLine : undefined}
            />
            {!isDraft && (
              <p className="muted" style={{ marginTop: "var(--space-2)" }}>
                Locked — the order is placed. Reconciling a bill by editing what you ordered
                erases the variance this exists to show.
              </p>
            )}
            <div className="sheet-inline" style={{ marginTop: "var(--space-3)" }}>
              {/*
                Freight and tax stay editable after the order is placed — see
                UpdatePurchaseOrderUseCase's own doc: neither is a promise already made to the
                vendor, and freight in particular is often quoted LATE. The only time the real
                figures are known is when the vendor's invoice arrives, which is always after
                placing. Locking these (the way Lines correctly does) would make the field
                unreachable in exactly the situation it exists for. Only a CANCELLED order
                refuses every field — that's handled by the isCancelled disables on the Order
                chapter's own controls, and update() itself refuses the write server-side too.
              */}
              <Field label={PO_LABEL.freight} style={{ margin: 0 }}>
                <DraftNumberInput
                  value={freight}
                  decimals={2}
                  disabled={isCancelled}
                  aria-label={PO_LABEL.freight}
                  onCommit={(v) => {
                    dirtyRef.current = true;
                    setFreight(v);
                  }}
                />
              </Field>
              {/* RECORDED, never computed. org_settings.tax_bps is the SELL-side rate — wrong
                  jurisdiction and wrong direction. Mallet is national; the states disagree. */}
              <Field label={PO_LABEL.tax} style={{ margin: 0 }}>
                <DraftNumberInput
                  value={tax}
                  decimals={2}
                  disabled={isCancelled}
                  aria-label={PO_LABEL.tax}
                  onCommit={(v) => {
                    dirtyRef.current = true;
                    setTax(v);
                  }}
                />
              </Field>
            </div>
            <Totals po={po} lines={lines} freight={freight} tax={tax} />
          </div>
        </SheetRow>

        {/* NOTES — the same trail every other record has: append an entry, clip a file to it. */}
        <SheetRow
          variant="section"
          label="Notes"
          value={poNotesSummary(po)}
          valueIsHint={po.notes.length === 0}
          expandable
          {...chapter("notes")}
        >
          {po.notes.length > 0 && (
            <div className="nfeed">
              {po.notes.map((n) => (
                <PONoteRow key={n.id} poId={po.id} note={n} />
              ))}
            </div>
          )}
          {/* The paperclip goes IN the row, as on every other note surface. */}
          <NoteComposer
            placeholder="what happened, what to chase…"
            autoFocus={open === "notes"}
            attachAccept={PO_NOTE_ATTACH_ACCEPT}
            onAttachFile={async (file) => {
              pendingAtt.current = await uploadPONoteFile(po.id, file);
            }}
            onSubmit={(text) => {
              const att = pendingAtt.current;
              appendPONote(po.id, { body: text, ...(att ? { attachment: att } : {}) });
              pendingAtt.current = null;
            }}
          />
        </SheetRow>
      </div>

      {footError && (
        <p role="alert" style={{ color: "var(--red)", margin: "0 var(--modal-pad-x, 0)" }}>
          {footError}
        </p>
      )}

      <div className="sheet-foot">
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
          <button
            type="button"
            className="btn ghost"
            style={{ flexShrink: 0, minHeight: 44 }}
            disabled={placeBusy}
            onClick={() => {
              if (isDraft) deleteDraft();
              else if (isCancelled) close();
              else void cancelOrder();
            }}
          >
            {isDraft ? "Delete draft" : isCancelled ? "Close" : "Cancel order"}
          </button>
          {/* A placed order is finished as far as this sheet is concerned — there is nothing to
              check in. Cancelling is the only state left to reach, and it is the quiet control. */}
          <button
            type="button"
            className="sheet-pri"
            style={{ flex: 1, width: "auto" }}
            disabled={placeBusy}
            onClick={() => (isDraft ? void place() : close())}
          >
            {isDraft ? (placeBusy ? "Ordering…" : "Order it →") : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** modal-host.tsx's content component — reads the poId this modal was opened with. */
export function POModalContent() {
  const activeModal = useActiveModal();
  const poId = activeModal?.params?.poId as string | undefined;
  if (!poId) return <ModalLoading size="lg" />;
  return <POModal poId={poId} />;
}
