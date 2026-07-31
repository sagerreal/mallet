"use client";

/**
 * features/home/use-ok-queue.ts
 * The Dashboard's OK queue, computed where the data is.
 *
 * WHAT WAS WRONG. deriveOkQueue joined THREE store collections (leads × estimates ×
 * invoices), each capped at one hydrator page — so on a big book the hero figure was
 * simply a smaller number than the truth, and the biggest item at stake could be
 * invisible. The money kinds now come from the server:
 *   quote-viewed    ← v1.quoting.list {status:"sent"}   (same key the Pipeline rail uses)
 *   invoice-overdue ← v1.invoicing.listOverdue
 * The people kinds (replies, brand-new leads) stay store-derived ON PURPOSE: both are
 * defined by recency, and the hydrator page is newest-first — a new lead or an unread
 * reply is in the page by construction.
 */

import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { dtoEstimateSummaryToStore } from "@/lib/store/dto-mapper";
import type { Estimate, Invoice, Lead } from "@/lib/store/types";
import { estTotal } from "@/lib/estimates";
import { deriveOkQueue, type OkItem } from "./derive";

const QUEUE_CAP = 5;
const OVERDUE_AGE_DAYS = 7;
/** Matches the rail's COLUMN_CAP order of magnitude — enough to rank a real book. */
const FETCH_CAP = 200;

const daysSince = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/**
 * A display/send-capable stand-in for a customer outside the loaded page. Sending
 * works (the server resolves the phone from the lead id); the store-side note simply
 * no-ops for a lead the page doesn't hold — the real thread is server truth anyway.
 */
function leadStub(id: string, name: string | null): Lead {
  return {
    id,
    name: name ?? "Customer",
    phone: "",
    source: "",
    stage: "Quote Sent",
    age: 0,
    job: "",
    last: "",
    book: false,
    unread: false,
    archived: false,
    acts: [],
    evisits: [],
  } as unknown as Lead;
}

export interface OkQueueResult {
  readonly items: OkItem[];
  /** Dollars across the SHOWN items — the hero figure. */
  readonly value: number;
  readonly isLoading: boolean;
}

/** Uncapped, dismissal-blind ranked items — the Counter's runs want full intent. */
export function useOkItems(): { items: OkItem[]; isLoading: boolean } {
  const q = useOkQueueInternal([]);
  return { items: q.uncapped, isLoading: q.isLoading };
}

export function useOkQueue(): OkQueueResult {
  const dismissed = useAppStore((s) => s.dismissedAttention);
  const q = useOkQueueInternal(dismissed);
  const ranked = q.uncapped.filter((it) => !dismissed.includes(it.key)).slice(0, QUEUE_CAP);
  return { items: ranked, value: ranked.reduce((s, it) => s + it.value, 0), isLoading: q.isLoading };
}

function useOkQueueInternal(dismissed: string[]): { uncapped: OkItem[]; isLoading: boolean } {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);

  // Same query key as the Pipeline rail's Out column — React Query dedupes.
  const sentQ = api.v1.quoting.list.useQuery(
    { status: "sent", limit: FETCH_CAP },
    { refetchOnWindowFocus: true },
  );
  const overdueQ = api.v1.invoicing.listOverdue.useQuery(
    { limit: FETCH_CAP },
    { refetchOnWindowFocus: true },
  );

  return useMemo(() => {
    const leadOf = (id: string) => leads.find((l) => l.id === id && !l.archived);

    const items: OkItem[] = [];

    // Viewed, still-open quotes — server rows; "viewed" matches the store convention
    // (anything sent counts — the client approximation the whole app uses today).
    for (const dto of sentQ.data?.items ?? []) {
      const est: Estimate = dtoEstimateSummaryToStore(dto, { on: false, stage: 0 });
      if (est.archived || est.trash) continue;
      const lead = leadOf(dto.leadId) ?? leadStub(dto.leadId, dto.customerName);
      const value = estTotal(est);
      const age = daysSince(dto.createdAt);
      items.push({
        key: `okq-${est.id}`,
        kind: "quote-viewed",
        lead,
        estimate: est,
        value,
        situation: `read the $${Math.round(value).toLocaleString("en-US")} quote — ${age}d since it went out`,
        editLabel: "Change",
      });
    }

    // Overdue invoices — server rows (findOverdue already applies the due test).
    for (const dto of overdueQ.data?.items ?? []) {
      const dueDollars = dto.due.cents / 100;
      if (dueDollars <= 0) continue;
      const age = daysSince(dto.createdAt);
      if (age < OVERDUE_AGE_DAYS) continue;
      const lead = leadOf(dto.leadId) ?? leadStub(dto.leadId, dto.customerName);
      const invoice = {
        id: dto.id,
        num: dto.num,
        leadId: dto.leadId,
        age,
        status: dto.status,
        archived: false,
      } as unknown as Invoice;
      items.push({
        key: `oki-${dto.id}`,
        kind: "invoice-overdue",
        lead,
        invoice,
        value: dueDollars,
        situation: `owes $${Math.round(dueDollars).toLocaleString("en-US")} · ${dto.num} · ${age} days`,
        editLabel: "Soften it",
      });
    }

    // Replies + brand-new leads: recency-defined, so the newest-first store page holds
    // them by construction — reuse the existing derivation, keeping only those kinds.
    const storeKinds = deriveOkQueue(leads, estimates, invoices, dismissed).filter(
      (it) => it.kind === "reply" || it.kind === "new-lead",
    );
    items.push(...storeKinds);

    const uncapped = items
      .filter((it) => !dismissed.includes(it.key))
      .sort((a, b) => b.value - a.value);

    return { uncapped, isLoading: !sentQ.isFetched || !overdueQ.isFetched };
  }, [sentQ.data, sentQ.isFetched, overdueQ.data, overdueQ.isFetched, leads, estimates, invoices, dismissed]);
}
