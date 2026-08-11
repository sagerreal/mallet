/**
 * features/quotes/quotes-ledger.tsx
 * /quotes — the book of paper, a sub-page of Customers (the navsub slot Tasks proved out).
 *
 * The BOARD answers "what is my move today"; this page answers "what is out, what is it worth,
 * what won and what died". Same relationship the Jobs PAGE has to the board's Jobs column. It is
 * the customers-page register on purpose — the toolbar search, the chips, the `n of m` count and
 * the sized list table — so the two tabs of the Customer area read as one place.
 *
 * Row → the existing quote sheet. + New quote → the composer. No kanban and no stages here: the
 * stage stays a fact about the PERSON (the Customers list); this is the paper.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { pressable } from "@/lib/a11y";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { fmt$ } from "@/lib/format";
import {
  ledgerCounts,
  ledgerRows,
  type QuoteFilter,
} from "./quotes-ledger-utils";

const FILTERS: ReadonlyArray<readonly [QuoteFilter, string]> = [
  ["all", "All"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["won", "Won"],
  ["lost", "Lost"],
];

/** Explicit widths — automatic layout strands short content mid-cell on a wide screen. */
const COLS = ["13%", "24%", "37%", "13%", "13%"] as const;

export function QuotesLedger() {
  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
  const openModal = useOpenModal();
  const router = useRouter();

  const [filter, setFilter] = useState<QuoteFilter>("all");
  const [q, setQ] = useState("");

  // The SAME query key the estimates hydrator holds, so this costs no second fetch — it exists to
  // tell the four list states apart (loading / failed / first-run / populated), which the store
  // alone cannot: an empty array is both "no quotes yet" and "nothing fetched yet".
  const listQ = api.v1.quoting.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  const counts = ledgerCounts(estimates);
  const rows = ledgerRows(estimates, leads, filter, q);
  const newQuote = () => router.push("/composer");
  // The predicates read the raw cache size — "anything in hand at all" — not the ledger's own
  // filtered count, so a book of purely archived paper still renders the populated shell.
  const listState = { isFetched: listQ.isFetched, isError: listQ.isError, count: estimates.length };

  return (
    <div>
      <div className="pagehead">
        <h1>Quotes</h1>
        <div className="pagehead-acts">
          <button className="btn primary" onClick={newQuote}>
            + New quote
          </button>
        </div>
      </div>
      <p className="sub">Every price you&rsquo;ve put in front of a customer.</p>

      {isFirstLoad(listState) ? (
        <ListLoading label="Loading quotes…" />
      ) : shouldShowLoadFailed(listState) ? (
        <LoadFailed noun="quotes" onRetry={() => void listQ.refetch()} retrying={listQ.isRefetching} />
      ) : shouldShowFirstRun({ ...listState, count: counts.all }) ? (
        <FirstRunEmptyState
          heading="No quotes yet."
          subtext="Price a job and it lands here — drafts, what's out the door, what won and what died."
          paths={[
            {
              title: "Write the first quote",
              description: "The composer builds it — lines, options, and the send.",
              actionLabel: "+ New quote",
              onAction: newQuote,
              variant: "primary",
            },
          ]}
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
                type="text"
                aria-label="Search quotes"
                placeholder="Search customer or job…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="jh-filters" role="group" aria-label="Filter quotes">
              {FILTERS.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  className={`chip${filter === f ? " on" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {label}
                  {f === "all" ? null : <span className="chip-n"> ({counts[f]})</span>}
                </button>
              ))}
            </div>
            {/* The page's one figure: the money sitting on customers' phones. */}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {rows.length} of {counts.all}
              {counts.sent > 0 ? <> · {fmt$(counts.outTheDoorDollars)} out</> : null}
            </span>
          </div>

          <table className="list-tbl cols-sized">
            <colgroup>
              {COLS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Status</th>
                <th>Customer</th>
                <th>Quote</th>
                <th>Total</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  onClick={() => openModal(MODAL.EST, { estId: r.id })}
                  {...pressable(() => openModal(MODAL.EST, { estId: r.id }))}
                >
                  <td>
                    <span className={`pill ${r.pill.tone}`}>{r.pill.label}</span>
                  </td>
                  <td>
                    <b>{r.customer}</b>
                  </td>
                  <td className="muted">{r.title}</td>
                  <td>
                    <b className="fig">{r.totalDollars ? fmt$(r.totalDollars) : ""}</b>
                  </td>
                  <td className="muted fig">{r.ageLabel}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-att" style={{ margin: "var(--space-3) 0" }}>
                      Nothing matches — clear the search or the filter.
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
