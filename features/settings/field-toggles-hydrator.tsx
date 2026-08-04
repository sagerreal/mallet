"use client";

/**
 * features/settings/field-toggles-hydrator.tsx
 * Mounts in the field layout FOR TECHNICIANS ONLY. Writes the one org capability flag the field
 * surface needs — `measurementEstimating` — into store.toggles from `v1.settings.fieldToggles`.
 *
 * WHY A SECOND HYDRATOR. `SettingsHydrator` reads `v1.settings.get`, which is `ownerOrOffice` and
 * returns the whole office configuration; the field layout therefore mounts it behind `!isTech`.
 * Since it is the ONLY writer of store.toggles, a technician's `measurementEstimating` stayed at
 * its placeholder for the entire session — and the tech Quote tab's "Scan a room" row, the one
 * surface the field scanner exists for, could never render for the role it was built for. A tech
 * could not soft-navigate into an office route to fix it either: the office layout's guard
 * redirects them straight back.
 *
 * So techs get their own read of ONE boolean instead of the office payload. Owner/office on the
 * field surface keep SettingsHydrator; exactly one of the two mounts, so they never race to write
 * the same key.
 *
 * A FAILED READ WRITES NOTHING, deliberately: `measurementEstimating` stays `"unknown"`, and the
 * measurement surfaces fail OPEN on unknown (lib/measurement-gate.ts). A settings read that did
 * not answer must never be the reason the scanner disappears.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { measurementGateFrom } from "@/lib/measurement-gate";

export function FieldTogglesHydrator() {
  const setMeasurementGate = useAppStore((s) => s.setMeasurementGate);
  const { data, isError, error } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:field-toggles] load failed", error);
      }
      return;
    }
    if (!data) return;
    setMeasurementGate(measurementGateFrom(data.measurementEstimating));
  }, [data, isError, error, setMeasurementGate]);

  return null;
}
