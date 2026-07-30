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
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import {
  deriveMoneyRows,
  deriveArchivedMoneyRows,
  filterMoneyRows,
  invDue,
  type MoneyRow,
} from "./money-derive";
import { MoneyTable, MONEY_COL_ORDER, type MoneyColKey, type MoneyRowCallbacks } from "./money-table";
import { MoneyToolbar, MoneyColumnsPanel, MoneyFiltersPanel, type MoneySet } from "./money-toolbar";
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
      <div className="sub">Every dollar from done-work to paid.</div>
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
    [moneySet, invoices, jobs, leads] // jobs unused on the archived branch — harmless over-recompute, kept for simplicity
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
    onCancelCharge: () => setArmedCharge(null),
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

  // Same query key + options as InvoicesHydrator → React Query dedupes it (no extra fetch). Gate on
  // the TOTAL invoice count so a no-match search on a populated shop still falls through to the
  // table. Never flashes mid-fetch / on a failed load.
  const invQuery = api.v1.invoicing.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  // The ledger's "ready to bill" rows come from JOBS (a different hydrator that can land after
  // invoices) — without this second gate, a shop with finished-but-unbilled jobs was told
  // "Nothing owed — every finished job is billed and paid." / "No invoices yet" for a beat.
  const jobsQuery = api.v1.jobs.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const jobsLoading = isFirstLoad({ isFetched: jobsQuery.isFetched, isError: jobsQuery.isError, count: jobs.length });
  const firstRun =
    shouldShowFirstRun({ isFetched: invQuery.isFetched, isError: invQuery.isError, count: invoices.length }) && !jobsLoading;
  const loadFailed = shouldShowLoadFailed({ isFetched: invQuery.isFetched, isError: invQuery.isError, count: invoices.length });
  const loading =
    isFirstLoad({ isFetched: invQuery.isFetched, isError: invQuery.isError, count: invoices.length }) || jobsLoading;

  return (
    <>
      <MoneyHeader autoRemind={autoRemind} onAutoRemind={() => setAutoRemind((v) => !v)} onNewInvoice={newInvoice} />

      <div className="mob-new">
        <button className="btn primary" onClick={newInvoice}>+ New invoice</button>
      </div>

      {loading ? (
        <ListLoading />
      ) : loadFailed ? (
        <LoadFailed noun="invoices" onRetry={() => void invQuery.refetch()} retrying={invQuery.isRefetching} />
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
            total={source.length}
          />

          {colsOpen && <MoneyColumnsPanel visible={visibleCols} onToggle={toggleCol} />}
          {filtersOpen && <MoneyFiltersPanel statusFilter={statusFilter} onStatus={setStatusFilter} onClear={clearFilters} />}

          <MoneyTable rows={rows} visibleCols={visibleCols} armedCharge={armedCharge} cb={cb} emptyState={emptyState} />
        </>
      )}
    </>
  );
}
