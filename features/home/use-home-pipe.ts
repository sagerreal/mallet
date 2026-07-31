"use client";

import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { fmt$ } from "@/lib/format";
import { localToday } from "@/features/jobs/use-jobs-query";
import { useRailColumns } from "@/features/pipeline/use-rail-columns";
import { QUOTE_COLD_DAYS, type PipeStage } from "./pipe";

/**
 * The Dashboard's six headline figures, each computed where the data is.
 *
 * WHAT WAS WRONG. Every one of them was added up from the store — one page per collection — and
 * three of them were joins ACROSS two capped collections ("to bill" pairs jobs with invoices,
 * "quoted" pairs quotes with customers). So on a 606-customer, 847-invoice, 1,534-job shop, the
 * first screen of the app stated money figures derived from whichever rows happened to be cached.
 * "Owed" under-reported. These are the numbers an owner reads before anything else, and a number
 * that is confidently wrong is worse than one that is missing.
 *
 * Each figure now comes from the module that owns it — job sums from the jobs view query, balances
 * from the invoice totals query, quotes from the Pipeline columns — and nothing is joined in the
 * browser. Composed here rather than in one cross-module endpoint, because a single endpoint
 * spanning four modules would put customers, quoting, jobs and invoicing logic in one place, which
 * is the boundary this codebase keeps.
 */

export interface HomePipe {
  readonly stages: PipeStage[];
  readonly isLoading: boolean;
  readonly isError: boolean;
}

const cents$ = (cents: number): string => fmt$(cents / 100);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function useHomePipe(): HomePipe {
  const today = useMemo(localToday, []);

  const jobsQ = api.v1.jobs.viewCounts.useQuery({ today }, { refetchOnWindowFocus: true });
  const moneyQ = api.v1.invoicing.totals.useQuery(undefined, { refetchOnWindowFocus: true });
  // "New" means a customer nobody has papered — no quote, no visit. That is exactly the Pipeline's
  // intake column, decided in SQL, so it is the same question asked once rather than twice.
  const newQ = api.v1.customers.viewCounts.useQuery(undefined, { refetchOnWindowFocus: true });
  const rail = useRailColumns();

  const stages = useMemo<PipeStage[]>(() => {
    const counts = jobsQ.data?.counts;
    const cold = rail.out.filter((r) => r.quietDays >= QUOTE_COLD_DAYS).length;
    const newCount = newQ.data?.intake ?? 0;
    const slotCount = counts?.needsSlot ?? 0;
    const todayCount = counts?.today ?? 0;
    const billCount = counts?.needsInvoice ?? 0;
    const openCount = moneyQ.data?.openCount ?? 0;
    const overdueCents = moneyQ.data?.overdueCents ?? 0;

    return [
      {
        key: "new",
        label: "New",
        value: String(newCount),
        sub: newCount ? `${newCount} ${plural(newCount, "customer", "customers")} to reach` : "none waiting",
        red: null,
        leak: newCount > 0,
        href: "/customers",
      },
      {
        key: "quoted",
        label: "Quoted",
        value: cents$(rail.outSum * 100),
        sub: `${rail.out.length} out${cold > 0 ? ` · ${cold} going cold` : ""}`,
        red: null,
        leak: cold > 0,
        href: "/pipeline",
      },
      {
        key: "needsSlot",
        label: "Needs a slot",
        value: cents$(jobsQ.data?.needsSlotCents ?? 0),
        sub: `${slotCount} won ${plural(slotCount, "job", "jobs")} unscheduled`,
        red: null,
        leak: slotCount > 0,
        href: "/jobs?tab=schedule",
      },
      {
        key: "trucks",
        label: "Out today",
        value: cents$(jobsQ.data?.todayCents ?? 0),
        sub: `${todayCount} today`,
        red: null,
        leak: false,
        href: "/jobs",
      },
      {
        key: "toBill",
        label: "To bill",
        value: cents$(jobsQ.data?.needsInvoiceCents ?? 0),
        sub: `${billCount} done, no invoice`,
        red: null,
        leak: billCount > 0,
        href: "/money",
      },
      {
        key: "owed",
        label: "Owed",
        value: cents$(moneyQ.data?.openCents ?? 0),
        sub: `${openCount} open`,
        red: overdueCents > 0 ? `${cents$(overdueCents)} overdue` : null,
        leak: false,
        href: "/money",
      },
    ];
  }, [jobsQ.data, moneyQ.data, newQ.data, rail.out, rail.outSum]);

  return {
    stages,
    // Every tile is money or a count stated as fact, so none of them renders until its own read
    // has landed — the alternative is printing "$0 to bill" for a beat, which Owen saw happen.
    isLoading: !jobsQ.isFetched || !moneyQ.isFetched || !newQ.isFetched || !rail.isFetched,
    isError: jobsQ.isError || moneyQ.isError || newQ.isError || rail.isError,
  };
}
