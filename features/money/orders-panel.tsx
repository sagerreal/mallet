"use client";

/**
 * features/money/orders-panel.tsx
 * Money → Purchase orders — what the shop buys from a supplier. Cash going OUT, the mirror of the
 * money ledger's cash coming IN; the two live as separate SETS reached via SectionTabs (`/money` vs
 * `/money?tab=orders`), never mixed into one ledger — see the Money branch of
 * components/shell/section-tabs.tsx.
 *
 * MATCHES THE INVOICES LIST (money-ledger.tsx/money-toolbar.tsx), not the mock. Owen's review of
 * the shipped feature: "look at the sizing of invoices … purchase order is just not the same and
 * not done correctly" — measured header cells 11px vs 15px, body cells 13px vs 15px, chips 13px
 * vs 15px, row height 81px vs 65px, and the toolbar was missing outright. This root no longer
 * carries `.po-scope` (app/prototype.css) — that 15px floor stays on the two PO MODALS only
 * (components/modals/new-po-modal.tsx, components/modals/po-modal/po-modal.tsx); this table, its
 * chips and its toolbar now inherit the same `.list-tbl` chrome every other list uses.
 *
 * Search is CLIENT-SIDE over the store (the list is unpaginated today, same as the mock) —
 * vendor, PO number, and job title. Rows come straight from the store (OrdersHydrator →
 * adoptPurchaseOrders) and arrive ordered createdAt desc from the server — never re-sorted here,
 * the same rule money-ledger.tsx follows for invoices.
 *
 * NO ARCHIVED TOGGLE. Invoices' Active/Archived pair needs a server-side archived query; purchase
 * orders' v1.purchasing.list has no such input (it only ever excludes soft-deleted rows), and
 * wiring a toggle that always shows nothing (or that quietly does nothing) is the half-wired
 * control the house rule forbids. Skipped here — flagged in the followups report — rather than
 * built against an endpoint that doesn't exist yet.
 *
 * Per-row actions: a DRAFT gets "Order it" (places it directly, same v1.purchasing.place the
 * record sheet's footer button calls); an ORDERED or CANCELLED row gets nothing — there is no
 * home for a second control on either, and a house rule forbids inventing one that isn't wired.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { dtoPurchaseOrderToStore } from "@/lib/store/dto-mapper";
import { userMessage } from "@/lib/trpc/error-map";
import { fmt$2 } from "@/lib/format";
import { pressable } from "@/lib/a11y";
import { PO_STATUS_META } from "./po-defs";
import type { POStatus, PurchaseOrder } from "@/lib/store/types";

const STATUS_BANDS: readonly POStatus[] = ["draft", "ordered", "cancelled"];

const FIRST_RUN = {
  heading: "No purchase orders yet",
  subtext:
    "What the shop buys from a supplier — draft one, place it, and its cost lands on the job it's for.",
  add: {
    title: "Draft a purchase order",
    description: "Vendor, lines, and what it's for — place it when it's ready.",
    actionLabel: "+ Draft an order",
  },
} as const;

/** Vendor, PO number, or job title — case-insensitive substring, same fields Owen asked for. */
function matchesSearch(po: PurchaseOrder, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    po.vendor.toLowerCase().includes(needle) ||
    (po.num ?? "").toLowerCase().includes(needle) ||
    (po.jobTitle ?? "").toLowerCase().includes(needle)
  );
}

export function OrdersPanel() {
  const purchaseOrders = useAppStore((s) => s.purchaseOrders);
  const adoptPurchaseOrder = useAppStore((s) => s.adoptPurchaseOrder);
  const openModal = useOpenModal();
  const [band, setBand] = useState<POStatus | null>(null);
  const [q, setQ] = useState("");

  // Single-flight "Order it" from the list — a second click while one is in flight must not
  // place twice. Mirrors money-ledger.tsx's armedCharge/charging split (a distinct busy flag per
  // concern rather than one shared boolean gating unrelated rows).
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);

  function placeOrder(poId: string) {
    if (placingId) return;
    setPlaceError(null);
    setPlacingId(poId);
    trpcVanilla.v1.purchasing.place
      .mutate({ poId })
      .then((dto) => adoptPurchaseOrder(dtoPurchaseOrderToStore(dto)))
      .catch((err: unknown) => {
        setPlaceError(userMessage(err, "Couldn't place the order — check your connection and try again."));
      })
      .finally(() => setPlacingId(null));
  }

  // The SAME query key OrdersHydrator holds (v1.purchasing.list, no input) — this costs no
  // second fetch, and exists only to tell the four list states apart (loading / failed /
  // first-run / populated), which the store alone cannot: an empty array is both "no orders yet"
  // and "nothing fetched yet". Same convention quotes-ledger.tsx uses for estimates.
  const listQ = api.v1.purchasing.list.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const listState = { isFetched: listQ.isFetched, isError: listQ.isError, count: purchaseOrders.length };

  // Search, then the status chip — purchaseOrders arrives createdAt desc from the server and
  // stays that way through every hydrate/reconcile (mergeIncomingPO in purchase-orders-slice.ts
  // preserves it), so filtering never needs to re-sort.
  const searched = purchaseOrders.filter((po) => matchesSearch(po, q));
  const rows = band ? searched.filter((po) => po.status === band) : searched;

  // Footer totals read the WHOLE book, not the filtered rows — same as the mock: with a chip or a
  // search term narrowing the view, the shop still sees what's placed across every order, not
  // just the ones on screen. Placed orders only — a draft is not money committed and a cancelled
  // one never was.
  const placed = purchaseOrders
    .filter((po) => po.status === "ordered")
    .reduce((sum, po) => sum + po.total, 0);
  const drafted = purchaseOrders
    .filter((po) => po.status === "draft")
    .reduce((sum, po) => sum + po.total, 0);

  // Reachable only once the book itself is non-empty (shouldShowFirstRun already handled the
  // whole-book-empty case above), so an empty `rows` here always means a filter narrowed it.
  const emptyState = (
    <>
      Nothing matches —{" "}
      <span
        className="linklike"
        onClick={() => {
          setQ("");
          setBand(null);
        }}
      >
        clear the filters
      </span>
    </>
  );

  return (
    <>
      <div className="pagehead">
        <h1>Purchase orders</h1>
        <div className="pagehead-acts">
          <button type="button" className="btn primary" onClick={() => openModal(MODAL.NEW_PO)}>
            + New purchase order
          </button>
        </div>
      </div>

      {isFirstLoad(listState) ? (
        <ListLoading label="Loading purchase orders…" />
      ) : shouldShowLoadFailed(listState) ? (
        <LoadFailed noun="purchase orders" onRetry={() => void listQ.refetch()} retrying={listQ.isRefetching} />
      ) : shouldShowFirstRun(listState) ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[{ ...FIRST_RUN.add, onAction: () => openModal(MODAL.NEW_PO), variant: "primary" }]}
        />
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="22" y2="22" />
              </svg>
              <input
                enterKeyHint="search"
                type="text"
                aria-label="Search purchase orders"
                placeholder="Search vendor, PO #, job…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <span className="muted" style={{ marginLeft: "auto" }}>
              {rows.length} of {purchaseOrders.length}
            </span>
          </div>

          <OrderStatusChips purchaseOrders={purchaseOrders} band={band} onBand={setBand} />

          {placeError ? (
            <p
              role="alert"
              style={{ color: "var(--red)", fontSize: "var(--type-sm)", fontWeight: 600, margin: "0 0 var(--space-2)" }}
            >
              {placeError}
            </p>
          ) : null}

          <div className="card" style={{ padding: "var(--space-2) var(--space-4)" }}>
            <table className="list-tbl cols-sized">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vendor</th>
                  <th>For job</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Ordered</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((po) => (
                    <OrderRow
                      key={po.id}
                      po={po}
                      placing={placingId === po.id}
                      onOpen={() => openModal(MODAL.PO, { poId: po.id })}
                      onPlace={() => placeOrder(po.id)}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-att">{emptyState}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <OrderTotals placed={placed} drafted={drafted} />
          </div>
        </>
      )}
    </>
  );
}

/** The draft/ordered/cancelled filter chips, with per-status counts over the WHOLE book. */
function OrderStatusChips({
  purchaseOrders,
  band,
  onBand,
}: {
  purchaseOrders: PurchaseOrder[];
  band: POStatus | null;
  onBand: (b: POStatus | null) => void;
}) {
  return (
    <div className="jh-filters" role="group" aria-label="Filter purchase orders">
      <button type="button" className={`chip${band === null ? " on" : ""}`} aria-pressed={band === null} onClick={() => onBand(null)}>
        All
      </button>
      {STATUS_BANDS.map((b) => {
        const n = purchaseOrders.filter((po) => po.status === b).length;
        return (
          <button
            key={b}
            type="button"
            className={`chip${band === b ? " on" : ""}`}
            aria-pressed={band === b}
            onClick={() => onBand(band === b ? null : b)}
          >
            {PO_STATUS_META[b].label}
            <span className="chip-n"> ({n})</span>
          </button>
        );
      })}
    </div>
  );
}

/** Placed (red — cash committed out the door) and In draft (plain — not money yet). */
function OrderTotals({ placed, drafted }: { placed: number; drafted: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-5)", padding: "var(--space-3) 0 var(--space-2)" }}>
      <span className="muted">
        Placed <b style={{ color: "var(--red)", fontFamily: "var(--font-mono)" }}>{fmt$2(placed)}</b>
      </span>
      <span className="muted">
        In draft <b style={{ fontFamily: "var(--font-mono)" }}>{fmt$2(drafted)}</b>
      </span>
    </div>
  );
}

/** A draft's only row action — "Order it" places it directly. Nothing for ordered/cancelled: no
 *  verb has a home there, and a house rule forbids a control that isn't wired to one. */
function OrderRowActions({ po, placing, onPlace }: { po: PurchaseOrder; placing: boolean; onPlace: () => void }) {
  // Nothing at all, not a dash: the invoices list leaves its action cell EMPTY when a row has no
  // next step, and a stray "—" reads as a value that failed to load rather than as "no action".
  if (po.status !== "draft") return null;
  return (
    <button
      type="button"
      className="btn sm primary"
      disabled={placing}
      onClick={(e) => {
        e.stopPropagation();
        onPlace();
      }}
    >
      {placing ? "Ordering…" : "Order it"}
    </button>
  );
}

function OrderRow({
  po,
  placing,
  onOpen,
  onPlace,
}: {
  po: PurchaseOrder;
  placing: boolean;
  onOpen: () => void;
  onPlace: () => void;
}) {
  const meta = PO_STATUS_META[po.status];
  return (
    <tr className="clickable" onClick={onOpen} {...pressable(onOpen)}>
      <td className="muted mono-num" data-label="#">
        {po.num ?? "—"}
      </td>
      <td data-primary data-label="Vendor">
        <b>{po.vendor}</b>
      </td>
      <td className="muted" data-label="For job">
        {po.jobTitle ?? "stock"}
      </td>
      <td data-label="Status">
        <span className="stpill" style={{ color: meta.c, background: meta.bg }}>
          {meta.label}
        </span>
      </td>
      <td
        style={{ textAlign: "right", fontWeight: 700, color: "var(--red)", fontVariantNumeric: "tabular-nums" }}
        data-label="Total"
      >
        {fmt$2(po.total)}
      </td>
      <td className="muted" style={{ textAlign: "right" }} data-label="Ordered">
        {po.orderedAt ?? "—"}
      </td>
      <td className="cardacts" style={{ textAlign: "right" }}>
        <span className="macts">
          <OrderRowActions po={po} placing={placing} onPlace={onPlace} />
        </span>
      </td>
    </tr>
  );
}
