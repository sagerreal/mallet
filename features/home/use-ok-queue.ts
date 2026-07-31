"use client";

import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { OkItem } from "./derive";

/**
 * The morning queue: things waiting on the owner's OK, fetched from the DATABASE.
 *
 * TWO KINDS, by design — and both were broken in a different way.
 *
 * QUOTES THE CUSTOMER OPENED. The old queue treated "sent" as "seen", because the store's `viewed`
 * flag is set from the status. So it drafted "Saw you had a look at the quote" to people who may
 * never have opened it — telling a customer something about themselves that the shop does not
 * know. It now keys on `first_viewed_at`, stamped when the public quote link is actually loaded.
 *
 * OVERDUE INVOICES. These were meant to be here all along and never appeared: the queue derived
 * from the browser's loaded page, and on a shop with 239 open invoices none of the overdue ones
 * were in it. $67,790 of late money, invisible on the screen whose whole job is to surface what
 * needs chasing.
 *
 * Both are worklists, not ledgers — capped, and the cap is reported rather than hidden.
 */

/** Past this many, it is a backlog to work through, not a morning queue. */
const QUEUE_CAP = 50;

export interface OkQueue {
  readonly items: OkItem[];
  /** Total value sitting in the queue — what the hero figure counts. */
  readonly value: number;
  /** The overdue-invoice subset, for the bulk action. */
  readonly overdue: OkItem[];
  readonly truncated: boolean;
  readonly isFetched: boolean;
  readonly isError: boolean;
}

const daysSinceIso = (iso: string | null): number => {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
};

export function useOkQueue(): OkQueue {
  const dismissed = useAppStore((s) => s.dismissedAttention);
  const leads = useAppStore((s) => s.leads);

  const quotes = api.v1.quoting.followUps.useQuery(
    { limit: QUEUE_CAP },
    { refetchOnWindowFocus: true },
  );
  const overdueInvoices = api.v1.invoicing.list.useQuery(
    { view: "over", limit: QUEUE_CAP, sort: "oldestUnpaid" },
    { refetchOnWindowFocus: true },
  );

  const quoteRows = quotes.data;
  const invoiceRows = overdueInvoices.data?.items;

  const items = useMemo(() => {
    const out: OkItem[] = [];

    for (const q of quoteRows ?? []) {
      const key = `okq-${q.id}`;
      if (dismissed.includes(key)) continue;
      const name = q.customerName ?? "there";
      const dollars = q.total.cents / 100;
      // The card needs a lead for its Call/Text actions. It may not be loaded — the customers
      // collection has its own page — so a minimal stand-in carries the name and id, and the
      // actions that need a phone find it when the record is there.
      const lead = leads.find((l) => l.id === q.leadId) ?? {
        id: q.leadId, name, phone: "", stage: "", age: 0, job: "", last: "", source: "", archived: false,
      };
      out.push({
        key,
        kind: "quote-viewed",
        lead: lead as OkItem["lead"],
        value: dollars,
        situation: `read the $${Math.round(dollars).toLocaleString("en-US")} quote — ${daysSinceIso(q.sentAt)}d since it went out`,
        editLabel: "Change",
      } as OkItem);
    }

    for (const i of invoiceRows ?? []) {
      const key = `oki-${i.id}`;
      if (dismissed.includes(key)) continue;
      const name = i.customerName ?? "there";
      const dollars = i.due.cents / 100;
      const lead = leads.find((l) => l.id === i.leadId) ?? {
        id: i.leadId, name, phone: "", stage: "", age: 0, job: "", last: "", source: "", archived: false,
      };
      const late = daysSinceIso(i.dueAt);
      out.push({
        key,
        kind: "invoice-overdue",
        lead: lead as OkItem["lead"],
        value: dollars,
        situation: `owes $${Math.round(dollars).toLocaleString("en-US")} — ${late}d past due`,
        editLabel: "Change",
      } as OkItem);
    }

    return out;
  }, [quoteRows, invoiceRows, dismissed, leads]);

  return {
    items,
    value: items.reduce((sum, i) => sum + i.value, 0),
    overdue: items.filter((i) => i.kind === "invoice-overdue"),
    truncated: (quoteRows?.length ?? 0) >= QUEUE_CAP || (invoiceRows?.length ?? 0) >= QUEUE_CAP,
    isFetched: quotes.isFetched && overdueInvoices.isFetched,
    isError: quotes.isError || overdueInvoices.isError,
  };
}
