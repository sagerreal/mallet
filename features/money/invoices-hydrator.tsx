"use client";

/**
 * features/money/invoices-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.invoicing.list and writes
 * the result into the Zustand store so every existing consumer (money ledger,
 * OK queue, pipeline, etc.) sees real DB data without changes.
 *
 * The list endpoint returns invoiceSummaryDTO — id/num/leadId/title/status/
 * total{cents}/due{cents}/dueAt/createdAt. Lines and payments are only on the
 * full invoiceDTO (fetched per-modal via invoicing.get). The store Invoice.lines
 * defaults to [] and Invoice.payments to [] until the modal loads the full record.
 *
 * Units: the store Invoice.total/depPaid are in DOLLARS. The DTO money field
 * is a { cents } object (integer); the hydrator divides by 100 to convert to
 * dollars before writing into the store. All format helpers (fmt$, formatMoney)
 * and derivations (invDue, invPaid in money-derive.ts) operate on dollar values.
 * Payment.amt is also dollars when loaded by the invoice modal.
 *
 * Status mapping: backend INVOICE_STATUSES = draft|sent|partial|paid|void.
 * Store status values used by money-derive.ts invStatusKey: "draft", "sent",
 * "partial", "paid". "void" does not appear in IST — we pass it through as-is;
 * money-derive.ts will fall through to "sent" label which is acceptable for the
 * pilot. archived flag: void invoices are treated as archived (hidden from live
 * ledger) to match prototype behaviour.
 *
 * cust/phone/email: not in summary DTO. The money-derive.ts invCustName does a
 * leads lookup by leadId — so cust="" is correct; it falls back to the lead name.
 * phone/email default to ""; the modal fetches the full DTO on open.
 *
 * age: calendar days since createdAt, matching the prototype and invOver logic
 * (INVOICE_OVERDUE_DAYS = 7 calendar days).
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Invoice } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

type InvoiceSummaryDTO = RouterOutputs["v1"]["invoicing"]["list"]["items"][number];

function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

function toStoreInvoice(dto: InvoiceSummaryDTO): Invoice {
  // void invoices are archived — hidden from the live ledger, same as prototype.
  const archived = dto.status === "void";

  return {
    id: dto.id,
    num: dto.num,
    // sourceJobId in the full DTO; not in summary — null until modal loads full record.
    jobId: null,
    leadId: dto.leadId,
    // cust: money-derive.invCustName falls back to leads[leadId].name, so "" is correct.
    cust: "",
    phone: "",
    email: undefined,
    title: dto.title ?? "Invoice",
    // Status: draft|sent|partial|paid|void — all pass through directly.
    // invStatusKey in money-derive handles draft/sent/partial/paid; void treated as archived.
    status: dto.status,
    // Money values are DOLLARS — DTO .cents divided by 100 at hydration.
    total: dto.total.cents / 100,
    // depositPaid not in summary DTO; 0 until full record is loaded.
    depPaid: 0,
    // amountPaid not in summary DTO; 0 until full record is loaded.
    // invDue = total - depPaid - invPaid(payments); using due.cents from DTO is more
    // accurate but invDue recalculates from parts. We store total and let payments=[]
    // and depPaid=0 make invDue approximate (= total). The modal hydrates the real value.
    payments: [],
    age: daysAgo(dto.createdAt),
    // termsDays: not in summary DTO; undefined until modal loads full record.
    termsDays: undefined,
    // lines: empty from list DTO; modal fetches them on open.
    lines: [],
    archived,
    // Every invoice from the list endpoint is DB-origin. Without this flag,
    // the origin !== "db" guards in invoices-slice (recordPayment / sendInvoice /
    // archiveInvoice) silently skip persistence after a page reload.
    origin: "db" as const,
  };
}

export function InvoicesHydrator() {
  const setInvoices = useAppStore((s) => s.setInvoices);
  // refetchOnWindowFocus: false — prevents the hydrator from clobbering
  // optimistic writes that the slice applied while the window was in the background.
  const { data, isError, error } = api.v1.invoicing.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreInvoice,
    setSlice: setInvoices,
    label: "invoices",
  });

  return null;
}
