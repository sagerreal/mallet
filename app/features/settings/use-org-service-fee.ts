"use client";

/**
 * features/settings/use-org-service-fee.ts
 * Reads the org's configured visit/service fee (dollars) directly from v1.settings.get.
 *
 * SettingsHydrator (features/settings/settings-hydrator.tsx) mounts ONLY in the office
 * layout (app/(office)/layout.tsx). The field shell (app/(field)/layout.tsx) never mounts
 * it — not even for an owner/office viewer — because the tech job modal's only entry point
 * (My day) lives entirely under the field route group. `booking.serviceFee` in the store
 * therefore stays at its EMPTY_BOOKING placeholder (89) on this surface regardless of role;
 * trusting it here would silently show the wrong fee for any org that changed it.
 *
 * This hook fetches the real value once, store-independent, whenever `enabled` is true. It
 * does NOT add a second store field (task-5 brief) — callers apply their own fallback (e.g.
 * close-out's presetFee falls back to 89, the ultimate fallback, only when this stays null).
 *
 * Returns null while disabled, loading, or after a failed fetch — never a fabricated fee.
 */
import { useEffect, useState } from "react";
import { trpcVanilla } from "@/lib/trpc/vanilla";

export function useOrgServiceFee(enabled: boolean): number | null {
  const [fee, setFee] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    trpcVanilla.v1.settings.get
      .query()
      .then((dto) => {
        if (!cancelled) setFee(dto.config.booking.serviceFee);
      })
      .catch(() => {
        // A failed read just leaves `fee` null — callers fall back safely instead of a
        // dead/erroring button built on a fabricated number.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return fee;
}
