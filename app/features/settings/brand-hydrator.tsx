"use client";

/**
 * features/settings/brand-hydrator.tsx
 * Mounts in the office layout. Seeds the store `brand` from v1.settings.get
 * (tagline/site/color/logo/initials) + v1.identity.me (orgName → brand.name).
 *
 * Brand name source: me.orgName is authoritative over settings.get.brand.name.
 * Both derive from orgs.name on the backend, so they are always identical in
 * value — but me.orgName is the same field that drives the greeting ("Hi, Rivera
 * Plumbing!"), so using it here keeps the greeting name and brand name in sync on
 * the client without any extra mapping.
 *
 * brand is a single object (not a paginated list), so this does not use the
 * shared useStoreHydrator hook (which is {items,nextCursor}-shaped).
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Brand } from "@/lib/store/types";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function BrandHydrator() {
  const setBrand = useAppStore((s) => s.setBrand);

  // refetchOnWindowFocus: false — a background refetch must not clobber an
  // optimistic updateBrand the user just made (same guard as SettingsHydrator).
  const settings = api.v1.settings.get.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const me = api.v1.identity.me.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const settingsData = settings.data;
  const orgName = me.data?.orgName;

  useEffect(() => {
    if (settings.isError || me.isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:brand] load failed", settings.error ?? me.error);
      }
      return;
    }
    if (!settingsData || orgName === undefined) return;

    const b = settingsData.brand;
    const brand: Brand = {
      name: orgName,
      tagline: b.tagline ?? "",
      site: b.site ?? "",
      color: b.color ?? "",
      initials: b.initials ?? "",
      logoUrl: b.logoUrl ?? undefined,
    };
    setBrand(brand);
  }, [settingsData, orgName, settings.isError, me.isError, settings.error, me.error, setBrand]);

  return null;
}
