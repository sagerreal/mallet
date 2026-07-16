"use client";

/**
 * features/money/money-ledger.tsx
 * The Money page — one ledger of every stage of getting paid, with the next
 * action on the row (Create invoice → Finish & send → Remind / Charge / Take
 * payment). Rows rank needs-you first. This file owns state + store actions;
 * math in money-derive, UI leaves in money-table / money-toolbar.
 */

import { useState, useMemo } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import {
  deriveMoneyRows,
  deriveArchivedMoneyRows,
  filterMoneyRows,
  invDue,
  type MoneyRow,
} from "./money-derive";
import { MoneyTable, MONEY_COL_ORDER, type MoneyColKey, type MoneyRowCallbacks } from "./money-table";
import { MoneyToolbar, MoneyColumnsPanel, MoneyFiltersPanel, type MoneySet } from "./money-toolbar";

function MoneyHeader({
  autoRemind,
  onAutoRemind,
  onNewInvoice,
}: {
  autoRemind: boolean;
  onAutoRemind: () => void;
  onNewInvoice: () => void;
}) {
  return (
    <div className="money-head">
      <div className="pagehead">
        <h1>Money</h1>
        <div className="pagehead-acts">
          <button
            className="mrem"
            role="switch"
            aria-checked={autoRemind}
            title="Unpaid invoices get a reminder text on a schedule until they’re paid"
            onClick={onAutoRemind}
          >
            Auto-remind
            <span className={`switch${autoRemind ? "" : " off"}`} aria-hidden="true" />
          </button>
          <button className="btn ghost" onClick={() => { /* deferred: financing */ }}>
            Offer financing
          </button>
          <button className="btn ghost" onClick={() => { /* deferred: QuickBooks */ }}>
            Connect QuickBooks
          </button>
          <button className="btn primary" onClick={onNewInvoice}>
            + New invoice
          </button>
        </div>
      </div>
      <div className="sub">Every dollar from done-work to paid.</div>
    </div>
  );
}

export function MoneyLedger() {
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);

  const openModal = useOpenModal();
  const addInvoice = useAppStore((s) => s.addInvoice);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const updateInvoice = useAppStore((s) => s.updateInvoice);

  const [moneySet, setMoneySet] = useState<MoneySet>("active");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<MoneyColKey[]>([...MONEY_COL_ORDER]);
  const [autoRemind, setAutoRemind] = useState(true);
  // Armed "charge card on file" — first tap arms, second tap charges.
  const [armedCharge, setArmedCharge] = useState<string | null>(null);

  const source = useMemo(
    () =>
      moneySet === "active"
        ? deriveMoneyRows(invoices, jobs, leads)
        : deriveArchivedMoneyRows(invoices, leads),
    [moneySet, invoices, jobs, leads]
  );
  const rows = useMemo(
    () => filterMoneyRows(source, { statusFilter, q }),
    [source, statusFilter, q]
  );
  const activeFilterCount = statusFilter ? 1 : 0;

  function toggleCol(key: MoneyColKey) {
    setVisibleCols((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : MONEY_COL_ORDER.filter((c) => prev.includes(c) || c === key)
    );
  }

  function clearFilters() {
    setQ("");
    setStatusFilter("");
  }

  function switchSet(v: MoneySet) {
    setMoneySet(v);
    setArmedCharge(null);
  }

  function openInvoice(id: string) {
    openModal(MODAL.INVOICE, { invoiceId: id });
  }

  // Build the draft from what was sold + approved add-ons, then open it.
  function createFromJob(jobId: string) {
    const j = jobs.find((x) => x.id === jobId);
    if (!j) return;
    const lead = leads.find((l) => l.id === j.leadId);
    // Office surface: rates are never redacted here; ?? 0 only satisfies the shared type.
    const total = (j.lines ?? []).reduce((s, l) => s + l.q * (l.r ?? 0), 0);
    const inv = addInvoice({
      jobId: j.id,
      leadId: j.leadId,
      cust: lead?.name ?? "",
      phone: j.phone || (lead?.phone ?? ""),
      title: j.title,
      lines: (j.lines ?? []).map((l) => ({ d: l.d, q: l.q, r: l.r ?? 0, c: l.c })),
      total,
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
    openInvoice(inv.id);
  }

  function newInvoice() {
    const inv = addInvoice({
      jobId: null,
      leadId: "",
      cust: "",
      phone: "",
      title: "New invoice",
      lines: [],
      total: 0,
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
    openInvoice(inv.id);
  }

  const cb: MoneyRowCallbacks = {
    onOpenRow: (row: MoneyRow) => {
      if (row.kind === "ready" && row.jobId != null) openModal(MODAL.JOB, { jobId: row.jobId });
      else if (row.invoiceId != null) openInvoice(row.invoiceId);
    },
    onCreateInvoice: createFromJob,
    onOpenInvoice: openInvoice,
    onRemind: (id) => {
      const i = invoices.find((x) => x.id === id);
      if (!i) return;
      updateInvoice(id, { fu: { on: true, stage: Math.min((i.fu?.stage ?? 0) + 1, 2) } });
    },
    onCharge: (id) => {
      if (armedCharge !== id) {
        setArmedCharge(id);
        return;
      }
      const i = invoices.find((x) => x.id === id);
      if (!i) return;
      recordPayment(id, { amt: invDue(i), when: "Just now", method: "card", onFile: true });
      setArmedCharge(null);
    },
  };

  const emptyState =
    moneySet === "archived" ? (
      "No archived invoices."
    ) : source.length ? (
      <>
        Nothing matches —{" "}
        <span className="linklike" onClick={clearFilters}>
          clear the filters
        </span>
      </>
    ) : (
      "Nothing owed — every finished job is billed and paid."
    );

  return (
    <>
      <MoneyHeader autoRemind={autoRemind} onAutoRemind={() => setAutoRemind((v) => !v)} onNewInvoice={newInvoice} />

      <div className="mob-new">
        <button className="btn primary" onClick={newInvoice}>+ New invoice</button>
      </div>

      <MoneyToolbar
        moneySet={moneySet}
        onMoneySet={switchSet}
        q={q}
        onQ={setQ}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        colsOpen={colsOpen}
        onToggleCols={() => setColsOpen((v) => !v)}
        activeFilterCount={activeFilterCount}
        shown={rows.length}
        total={source.length}
      />

      {colsOpen && <MoneyColumnsPanel visible={visibleCols} onToggle={toggleCol} />}
      {filtersOpen && <MoneyFiltersPanel statusFilter={statusFilter} onStatus={setStatusFilter} onClear={clearFilters} />}

      <MoneyTable rows={rows} visibleCols={visibleCols} armedCharge={armedCharge} cb={cb} emptyState={emptyState} />
    </>
  );
}
