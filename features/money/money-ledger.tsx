"use client";

/**
 * features/money/money-ledger.tsx
 * The Money page — one ledger of every stage of getting paid, with the next
 * action on the row (Create invoice → Finish & send → Remind / Charge / Take
 * payment). Rows rank needs-you first. This file owns state + store actions;
 * math in money-derive, UI leaves in money-table / money-toolbar.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import {
  deriveMoneyRows,
  deriveArchivedMoneyRows,
  type MoneyRow,
} from "./money-derive";
import { MoneyTable, MONEY_COL_ORDER, type MoneyColKey, type MoneyRowCallbacks } from "./money-table";
import { MoneyToolbar, MoneyColumnsPanel, MoneyFiltersPanel, type MoneySet } from "./money-toolbar";
import { useMoneyQuery, useMoneyQueryState } from "./use-money-query";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

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
          {/* QuickBooks lives in Settings, which is where it is actually connected and where the
              crew matching is. This used to be a no-op button next to an "Offer financing" one that
              was also a no-op; financing does not exist, so its button is gone rather than lying. */}
          <Link className="btn ghost" href="/settings?tab=quickbooks">
            QuickBooks
          </Link>
          <button className="btn primary" onClick={onNewInvoice}>
            + New invoice
          </button>
        </div>
      </div>
    </div>
  );
}

// First-run empty-state copy. Shown when a brand-new shop opens Money with zero invoices.
const FIRST_RUN = {
  heading: "No invoices yet",
  subtext: "This is where you get paid — every dollar from finished work to money in the bank.",
  create: {
    title: "Create an invoice",
    description: "Bill a customer directly — add the line items and send it.",
    actionLabel: "+ New invoice",
  },
  fromJob: {
    title: "Bill a finished job",
    description: "Wrap up a job and turn it into an invoice in one tap.",
    actionLabel: "Go to jobs",
  },
} as const;

export function MoneyLedger() {
  const router = useRouter();
  const leads = useAppStore((s) => s.leads);
  // Was useState(true) — a switch that promised reminder texts on a schedule and wrote nowhere.
  const autoRemind = useAppStore((s) => s.toggles.autoRemind);
  const setToggle = useAppStore((s) => s.setToggle);

  const openModal = useOpenModal();
  const addInvoice = useAppStore((s) => s.addInvoice);
  const chargeCardOnFile = useAppStore((s) => s.chargeCardOnFile);
  const updateInvoice = useAppStore((s) => s.updateInvoice);

  const [moneySet, setMoneySet] = useState<MoneySet>("active");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<MoneyColKey[]>([...MONEY_COL_ORDER]);

  // Armed "charge card on file" — first tap arms, second tap charges.
  const [armedCharge, setArmedCharge] = useState<string | null>(null);
  // The last charge-on-file refusal — Stripe's decline sentence verbatim, or the connection
  // fallback — shown above the table. Cleared when a new charge is armed.
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [charging, setCharging] = useState<string | null>(null);

  // The ledger is served by the database now. It is a UNION of two things, so it is fetched as
  // two: the ready-to-bill WORKLIST whole (it is short by nature, and if it ever is not, that is
  // the signal this screen exists to give), and the invoices a page at a time in ledger order.
  // `ready` ranks 0, so concatenating is the same order the merged derive produced.
  const mq = useMoneyQueryState();
  const money = useMoneyQuery({ search: q, archived: moneySet === "archived", statusFilter });
  // Under a status filter the database has already ordered the band — Paid comes back
  // most-recently-settled first — and re-sorting the page here would undo it. See
  // deriveMoneyRows.
  const source = useMemo(
    () =>
      moneySet === "active"
        ? deriveMoneyRows(money.invoiceRows, money.readyJobs, leads, Boolean(statusFilter))
        : deriveArchivedMoneyRows(money.invoiceRows, leads),
    [moneySet, money.invoiceRows, money.readyJobs, leads, statusFilter],
  );
  // Status, search and the ready-to-bill worklist are all resolved in the DATABASE now, so the
  // rows arriving here are already the right ones and are counted against the whole book rather
  // than the loaded page. Filtering client-side made "show me the overdue ones" mean "show me the
  // overdue ones among the fifty rows on screen", which on an 847-invoice ledger is a wrong answer
  // presented as a complete one.
  const rows = source;
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
    // On-screen rows only — a user cannot act on a row they cannot see.
    const j = money.readyJobs.find((x) => x.id === jobId);
    if (!j) return;
    const lead = leads.find((l) => l.id === j.leadId);
    // Office surface: rates are never redacted here; ?? 0 only satisfies the shared type.
    const total = (j.lines ?? []).reduce((s, l) => s + l.q * (l.r ?? 0), 0);
    const { invoice: inv } = addInvoice({
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
    const { invoice: inv } = addInvoice({
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
      const i = money.invoiceRows.find((x) => x.id === id);
      if (!i) return;
      updateInvoice(id, { fu: { on: true, stage: Math.min((i.fu?.stage ?? 0) + 1, 2) } });
    },
    onCancelCharge: () => setArmedCharge(null),
    onCharge: (id) => {
      if (armedCharge !== id) {
        setArmedCharge(id);
        setChargeError(null);
        return;
      }
      // REAL money: v1.invoicing.chargeOnFile — a Stripe off-session charge of the full
      // balance, recorded server-side only after it settles. This used to record a manual
      // "card" payment with onFile: true, a ledger row for money that never moved.
      if (charging) return; // single-flight — a second confirm mid-flight must not double-charge
      setCharging(id);
      setChargeError(null);
      void chargeCardOnFile(id, "office")
        .then((res) => {
          if (!res.ok) setChargeError(res.error ?? "Couldn't charge the card — try again.");
        })
        .finally(() => setCharging(null));
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

  // Gated on the SERVER's total, never on the loaded page: a no-match search on a shop that HAS
  // invoices must fall through to an empty list, not to "No invoices yet". `?? 1` while the count
  // is in flight keeps the first-run screen from flashing before it lands.
  // Unfiltered book size — a no-match search must fall through to the empty list, never
  // to "No invoices yet" on a shop with a full ledger.
  const firstRun = shouldShowFirstRun({ isFetched: money.isFetched, isError: money.isError, count: money.bookTotal ?? 1 });
  const loadFailed = shouldShowLoadFailed({ isFetched: money.isFetched, isError: money.isError, count: money.total ?? 0 });
  const loading = money.isLoading && rows.length === 0 && !money.isFetched;

  return (
    <>
      <MoneyHeader autoRemind={autoRemind} onAutoRemind={() => setToggle("autoRemind", !autoRemind)} onNewInvoice={newInvoice} />

      <div className="mob-new">
        <button className="btn primary" onClick={newInvoice}>+ New invoice</button>
      </div>

      {loading ? (
        <ListLoading />
      ) : loadFailed ? (
        <LoadFailed noun="invoices" onRetry={money.refetch} retrying={money.isRefetching} />
      ) : firstRun ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.create, onAction: newInvoice, variant: "primary" },
            { ...FIRST_RUN.fromJob, onAction: () => router.push("/jobs") },
          ]}
        />
      ) : (
        <>
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
            total={money.total ?? source.length}
          />

          {colsOpen && <MoneyColumnsPanel visible={visibleCols} onToggle={toggleCol} />}
          {filtersOpen && <MoneyFiltersPanel statusFilter={statusFilter} onStatus={setStatusFilter} onClear={clearFilters} />}

          <>
            {chargeError ? (
              <p
                role="alert"
                style={{ color: "var(--red)", fontSize: "var(--type-sm)", fontWeight: 600, margin: "0 0 var(--space-2)" }}
              >
                {chargeError}
              </p>
            ) : null}
            <MoneyTable rows={rows} visibleCols={visibleCols} armedCharge={armedCharge} cb={cb} emptyState={emptyState} />
          </>
        </>
      )}
    </>
  );
}
