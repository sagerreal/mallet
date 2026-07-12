"use client";

/**
 * features/pricebook/pricebook-hydrator.tsx
 * Mounts in the office layout. Subscribes to v1.pricebook.service.list +
 * v1.pricebook.category.list and writes the combined result into the Zustand
 * store so the Composer, quote/invoice modals, and the Settings pricebook card
 * all read real DB data instead of the old settings-slice PbItem plumbing.
 *
 * refetchOnWindowFocus: false — services/categories have optimistic mutations
 * (addService / updateService / archiveService / addCategory) that a
 * focus-triggered refetch could overwrite mid-flight, matching ChecklistsHydrator
 * / SettingsHydrator.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";
import { serviceDtoToStore, categoryDtoToStore } from "@/lib/store/pricebook-mapper";

export function PricebookHydrator() {
  const setPricebook = useAppStore((s) => s.setPricebook);

  const services = api.v1.pricebook.service.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const categories = api.v1.pricebook.category.list.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (services.isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:pricebook] service list load failed", services.error);
      }
      return;
    }
    if (categories.isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:pricebook] category list load failed", categories.error);
      }
      return;
    }
    if (!services.data || !categories.data) return;

    if (services.data.nextCursor !== null) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[hydrator:pricebook] service list truncated at ${HYDRATOR_PAGE_LIMIT} items — ` +
            `cursor iteration needed for full data set.`,
        );
      }
    }

    setPricebook({
      services: services.data.items.map(serviceDtoToStore),
      categories: categories.data.map(categoryDtoToStore),
    });
  }, [
    services.data,
    services.isError,
    services.error,
    categories.data,
    categories.isError,
    categories.error,
    setPricebook,
  ]);

  return null;
}
