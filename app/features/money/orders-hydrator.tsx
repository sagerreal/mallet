"use client";

/**
 * features/money/orders-hydrator.tsx
 * Mounts in the office layout. Subscribes to v1.purchasing.list and writes the
 * result into the Zustand store's purchaseOrders slice. Sibling of
 * invoices-hydrator.tsx — same job, one domain over.
 *
 * v1.purchasing.list takes NO input and returns `{ items }` with no cursor:
 * ListPurchaseOrdersUseCase reads the whole tenant table in one shot (see its
 * own doc comment) rather than paging, so there is no HYDRATOR_PAGE_LIMIT /
 * nextCursor truncation warning to wire here — this can't reuse
 * useStoreHydrator, whose `data` shape requires a `nextCursor` field this
 * query doesn't have. Mirrors the category.list leg of pricebook-hydrator.tsx,
 * the other unpaginated list in this codebase.
 *
 * The list endpoint already returns the FULL purchaseOrderDTO shape (lines
 * included) — there is no separate summary DTO the way invoices/estimates
 * have one — so dtoPurchaseOrderToStore (lib/store/dto-mapper.ts) is the ONE
 * mapper for both this hydrator and every mutation's reconcile step in
 * purchase-orders-slice.ts.
 *
 * refetchOnWindowFocus: false — purchaseOrders has optimistic mutations
 * (updatePurchaseOrder / removePurchaseOrder / appendPONote) that a
 * focus-triggered refetch could otherwise overwrite mid-flight, matching
 * every other hydrator in this app.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { dtoPurchaseOrderToStore } from "@/lib/store/dto-mapper";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function OrdersHydrator() {
  const adoptPurchaseOrders = useAppStore((s) => s.adoptPurchaseOrders);
  const { data, isError, error } = api.v1.purchasing.list.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:purchase-orders] load failed", error);
      }
      return;
    }
    if (!data) return;
    adoptPurchaseOrders(data.items.map(dtoPurchaseOrderToStore));
  }, [data, isError, error, adoptPurchaseOrders]);

  return null;
}
