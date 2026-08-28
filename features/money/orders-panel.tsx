"use client";

/**
 * features/money/orders-panel.tsx
 * Money → Orders — what the shop buys from a supplier. Cash going OUT, the mirror of the money
 * ledger's cash coming IN; the two live as separate SETS reached via SectionTabs (`/money` vs
 * `/money?tab=orders`), never mixed into one ledger — see the Money branch of
 * components/shell/section-tabs.tsx.
 *
 * Ports the LIST portion of the approved mock (branch mock/money-purchase-orders,
 * app/(office)/money/po/page.tsx) against the real store: the `.list-tbl` of
 * # · Vendor · For job · Status · Total · Ordered, the draft/ordered/cancelled filter chips, and
 * the Placed/In draft footer totals. The mock's two modals (view + create) and its in-page
 * ViewToggle are deliberately NOT ported here — Task 8 builds the modals against
 * MODAL.PO/MODAL.NEW_PO, and the ViewToggle is replaced by SectionTabs, the app's real sub-nav
 * grammar. No row-open control or "+ New purchase order" button yet either: wiring either to a
 * modal that doesn't exist would be a dead control.
 *
 * Rows come straight from the store (OrdersHydrator → adoptPurchaseOrders) and arrive ordered
 * createdAt desc from the server — never re-sorted here, the same rule money-ledger.tsx follows
 * for invoices.
 *
 * `.po-scope` (app/prototype.css): nothing on a purchase order surface renders below
 * var(--type-md) (15px) — a standing requirement from Owen, not a preference. The shared chrome
 * this list borrows (.muted, .stpill, .chip, .list-tbl th/td) is 11-13px by default; the scope
 * class lifts all of it here.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { fmt$2 } from "@/lib/format";
import type { POStatus, PurchaseOrder } from "@/lib/store/types";

/**
 * One vocabulary for the status word + its pill colors on this surface — mirrors the mock's
 * PO_STATUS_META (features/money/po-defs.ts on mock/money-purchase-orders). Task 8 cherry-picks
 * that file (types swapped to the store's) for the two modals; when it lands, fold this local
 * copy into an import from there instead of letting two definitions drift apart.
 */
const PO_STATUS_META: Record<POStatus, { label: string; c: string; bg: string }> = {
  draft: { label: "Draft", c: "var(--ink-3)", bg: "var(--paper)" },
  ordered: { label: "Ordered", c: "var(--amber)", bg: "var(--amber-bg)" },
  cancelled: { label: "Cancelled", c: "var(--ink-3)", bg: "var(--paper)" },
};

const STATUS_BANDS: readonly POStatus[] = ["draft", "ordered", "cancelled"];

const FIRST_RUN = {
  heading: "No purchase orders yet",
  subtext:
    "What the shop buys from a supplier — draft one, place it, and its cost lands on the job it's for.",
} as const;

export function OrdersPanel() {
  const purchaseOrders = useAppStore((s) => s.purchaseOrders);
  const [band, setBand] = useState<POStatus | null>(null);

  // The SAME query key OrdersHydrator holds (v1.purchasing.list, no input) — this costs no
  // second fetch, and exists only to tell the four list states apart (loading / failed /
  // first-run / populated), which the store alone cannot: an empty array is both "no orders yet"
  // and "nothing fetched yet". Same convention quotes-ledger.tsx uses for estimates.
  const listQ = api.v1.purchasing.list.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const listState = { isFetched: listQ.isFetched, isError: listQ.isError, count: purchaseOrders.length };

  // Filter only — purchaseOrders arrives createdAt desc from the server and stays that way
  // through every hydrate/reconcile (mergeIncomingPO in purchase-orders-slice.ts preserves it).
  const rows = band ? purchaseOrders.filter((po) => po.status === band) : purchaseOrders;

  // Footer totals read the WHOLE book, not the filtered rows — same as the mock: with the Draft
  // chip on, the shop still sees what's placed across every order, not just the ones on screen.
  // Placed orders only — a draft is not money committed and a cancelled one never was.
  const placed = purchaseOrders
    .filter((po) => po.status === "ordered")
    .reduce((sum, po) => sum + po.total, 0);
  const drafted = purchaseOrders
    .filter((po) => po.status === "draft")
    .reduce((sum, po) => sum + po.total, 0);

  return (
    <div className="po-scope">
      <div className="pagehead">
        <h1>Orders</h1>
      </div>

      {isFirstLoad(listState) ? (
        <ListLoading label="Loading purchase orders…" />
      ) : shouldShowLoadFailed(listState) ? (
        <LoadFailed noun="purchase orders" onRetry={() => void listQ.refetch()} retrying={listQ.isRefetching} />
      ) : shouldShowFirstRun(listState) ? (
        <FirstRunEmptyState heading={FIRST_RUN.heading} subtext={FIRST_RUN.subtext} paths={[]} />
      ) : (
        <>
          <OrderStatusChips purchaseOrders={purchaseOrders} band={band} onBand={setBand} />

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
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((po) => <OrderRow key={po.id} po={po} />)
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-att">Nothing matches this filter.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <OrderTotals placed={placed} drafted={drafted} />
          </div>
        </>
      )}
    </div>
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

function OrderRow({ po }: { po: PurchaseOrder }) {
  const meta = PO_STATUS_META[po.status];
  return (
    <tr>
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
    </tr>
  );
}
