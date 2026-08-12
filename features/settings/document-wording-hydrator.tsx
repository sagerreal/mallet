"use client";

/**
 * features/settings/document-wording-hydrator.tsx
 *
 * Fills `store.docWording` — the org's invoice-footer and change-order-agreement overrides —
 * from `v1.settings.documentWording`. Mounted in BOTH the office and the field layouts,
 * because both render the same customer sentences: the close-out document and the office
 * preview print the invoice footer, and the change-order sign screen shows the agreement line.
 *
 * WHY ITS OWN HYDRATOR, same shape as BusinessIdentityHydrator: `v1.settings.get` is
 * ownerOrOffice, so the field layout cannot use it — and one hydrator against one anyRole
 * endpoint serves both shells, so there is never a race between two writers of this key.
 *
 * A FAILED READ WRITES NOTHING, deliberately: `docWording` stays null and every surface
 * renders its STANDARD sentence through the settings domain's effective* resolvers — the
 * degradation is exactly what an untouched shop shows, never a blank line on a document.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function DocumentWordingHydrator() {
  const setDocWording = useAppStore((s) => s.setDocWording);
  // refetchOnWindowFocus: false — same guard as the other settings hydrators: a background
  // refetch must not clobber what the Documents card just saved.
  const { data, isError, error } = api.v1.settings.documentWording.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:document-wording] load failed", error);
      }
      return;
    }
    if (!data) return;
    setDocWording({
      invoiceFooter: data.invoiceFooter,
      changeOrderAgreement: data.changeOrderAgreement,
    });
  }, [data, isError, error, setDocWording]);

  return null;
}
