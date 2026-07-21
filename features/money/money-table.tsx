"use client";

/**
 * features/money/money-table.tsx
 * The ledger table + per-row action buttons. Presentational — takes the already
 * filtered/ordered rows and calls back for every action; the ledger owns state.
 */

import { fmt$ } from "@/lib/format";
import { IST, type MoneyRow } from "./money-derive";

export type MoneyColKey = "job" | "status" | "age" | "paid" | "due";
export const MONEY_COLS: Record<MoneyColKey, { l: string; right?: boolean }> = {
  job: { l: "Job" },
  status: { l: "Status" },
  age: { l: "Age" },
  paid: { l: "Paid", right: true },
  due: { l: "Due", right: true },
};
export const MONEY_COL_ORDER: readonly MoneyColKey[] = ["job", "status", "age", "paid", "due"];

export interface MoneyRowCallbacks {
  onOpenRow: (row: MoneyRow) => void;
  onCreateInvoice: (jobId: string) => void;
  onOpenInvoice: (id: string) => void;
  onRemind: (id: string) => void;
  onCharge: (id: string) => void;
  onCancelCharge: () => void;
}

function RowActions({ row, armedCharge, cb }: { row: MoneyRow; armedCharge: string | null; cb: MoneyRowCallbacks }) {
  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };
  if (row.statusKey === "ready" && row.jobId != null) {
    return (
      <button className="btn sm primary" onClick={(e) => stop(e, () => cb.onCreateInvoice(row.jobId!))}>
        Create invoice
      </button>
    );
  }
  if (row.statusKey === "draft" && row.invoiceId != null) {
    return (
      <button className="btn sm primary" onClick={(e) => stop(e, () => cb.onOpenInvoice(row.invoiceId!))}>
        Finish &amp; send
      </button>
    );
  }
  if (row.due > 0 && row.invoiceId != null) {
    return (
      <>
        <button className="btn sm" onClick={(e) => stop(e, () => cb.onRemind(row.invoiceId!))}>
          Remind
        </button>
        {row.card ? (
          // Charging real money is a two-step. The trigger must NOT relabel itself into
          // its own confirm — same control, two meanings, and a double-click charges the
          // card. Armed state swaps in an explicit Confirm / Cancel pair instead.
          armedCharge === row.invoiceId ? (
            <>
              <button className="btn sm danger" onClick={(e) => stop(e, () => cb.onCharge(row.invoiceId!))}>
                Confirm charge ···· {row.card.last4}
              </button>
              <button className="btn sm ghost" onClick={(e) => stop(e, () => cb.onCancelCharge())}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn sm primary" onClick={(e) => stop(e, () => cb.onCharge(row.invoiceId!))}>
              Charge ···· {row.card.last4}
            </button>
          )
        ) : (
          <button className="btn sm primary" onClick={(e) => stop(e, () => cb.onOpenInvoice(row.invoiceId!))}>
            Take payment
          </button>
        )}
      </>
    );
  }
  return <span className="muted">—</span>;
}

function ageLabel(row: MoneyRow): string {
  if (row.ageDays == null) return "—";
  return row.ageDays === 0 ? "today" : `${row.ageDays}d`;
}

function MoneyCell({ row, col }: { row: MoneyRow; col: MoneyColKey }) {
  const label = MONEY_COLS[col].l; // doubles as the mobile-card row label
  switch (col) {
    case "job":
      return (
        <td data-label={label}>
          {row.jobTitle}
          {row.sub && <div className="mwhy">{row.sub}</div>}
        </td>
      );
    case "status": {
      const s = IST[row.statusKey] ?? { l: row.statusKey, c: "var(--ink-2)", bg: "var(--paper)" };
      return (
        <td data-label={label}>
          <span className="stpill" style={{ color: s.c, background: s.bg }}>{s.l}</span>
        </td>
      );
    }
    case "age":
      return <td className="muted" data-label={label}>{ageLabel(row)}</td>;
    case "paid":
      return <td style={{ textAlign: "right" }} data-label={label}>{row.paid == null ? "—" : fmt$(row.paid)}</td>;
    case "due":
      return (
        <td style={{ textAlign: "right", fontWeight: 700, color: row.statusKey === "over" ? "var(--red)" : undefined }} data-label={label}>
          {fmt$(row.due)}
        </td>
      );
  }
}

export interface MoneyTableProps {
  rows: MoneyRow[];
  visibleCols: MoneyColKey[];
  armedCharge: string | null;
  cb: MoneyRowCallbacks;
  emptyState: React.ReactNode;
}

export function MoneyTable({ rows, visibleCols, armedCharge, cb, emptyState }: MoneyTableProps) {
  const cols = MONEY_COL_ORDER.filter((c) => visibleCols.includes(c));
  return (
    <div className="card" style={{ padding: "var(--space-2) var(--space-4)" }}>
      <table className="list-tbl">
        <thead>
          <tr>
            <th style={{ width: 84 }}>#</th>
            <th>Customer</th>
            {cols.map((c) => (
              <th key={c} style={MONEY_COLS[c].right ? { textAlign: "right" } : undefined}>
                {MONEY_COLS[c].l}
              </th>
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={row.key}
                className="clickable"
                onClick={() => cb.onOpenRow(row)}
              >
                <td className="muted mono-num" data-label="Invoice">{row.num ?? "—"}</td>
                <td data-primary>
                  {/* The focusable "open" control — keeps keyboard access without making
                      the whole <tr> a button (which nests the row's action buttons). */}
                  <button
                    type="button"
                    className="rowopen"
                    aria-label={`Open ${row.cust} · ${row.jobTitle}`}
                    onClick={(e) => { e.stopPropagation(); cb.onOpenRow(row); }}
                  >
                    <b>{row.cust}</b>
                  </button>
                </td>
                {cols.map((c) => (
                  <MoneyCell key={c} row={row} col={c} />
                ))}
                <td className="cardacts" style={{ textAlign: "right" }}>
                  <span className="macts">
                    <RowActions row={row} armedCharge={armedCharge} cb={cb} />
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3 + cols.length}>
                <div className="empty-att">{emptyState}</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
