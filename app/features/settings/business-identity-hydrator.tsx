"use client";

/**
 * features/settings/business-identity-hydrator.tsx
 *
 * Fills `store.business` — the shop's address, phone, email, website and licence — from
 * `v1.settings.businessIdentity`. Mounted in BOTH the office and the field layouts, because both
 * render the same customer document.
 *
 * WHY IT IS NOT PART OF BrandHydrator. Brand is how the shop LOOKS (colour, monogram, tagline) and
 * BrandHydrator reads `v1.settings.get`, which is ownerOrOffice — so it lives in the office layout
 * only. The technician's close-out sheet renders the SAME <InvoiceDocument> as the customer's own
 * `/i/<token>` page, and without an anyRole read the shop's two copies of one bill disagreed about
 * who had billed the customer. One hydrator against one anyRole endpoint serves both shells, so
 * there is never a race between two writers of this key.
 *
 * A FAILED READ WRITES NOTHING, deliberately: `business` stays null and the document omits the
 * identity block. A settings read that did not answer must never become a blank "Lic." on a bill —
 * that is the one thing <InvoiceDocument> exists to prevent.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function BusinessIdentityHydrator() {
  const setBusiness = useAppStore((s) => s.setBusiness);
  // refetchOnWindowFocus: false — same guard as the other settings hydrators: a background
  // refetch must not clobber what the Business details card just saved.
  const { data, isError, error } = api.v1.settings.businessIdentity.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:business-identity] load failed", error);
      }
      return;
    }
    if (!data) return;
    setBusiness({
      name: data.name,
      address: data.address,
      phone: data.phone,
      email: data.email,
      site: data.site,
      license: data.license,
    });
  }, [data, isError, error, setBusiness]);

  return null;
}
