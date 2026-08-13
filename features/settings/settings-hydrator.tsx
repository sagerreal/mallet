"use client";

/**
 * features/settings/settings-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.settings.get and writes the org's
 * configuration into the Zustand store so the Settings page renders real DB data.
 *
 * Unlike list hydrators, settings.get returns a single snapshot object, so this maps the DTO
 * directly and calls setSettings. refetchOnWindowFocus:false so a focus-triggered refetch never
 * clobbers an in-flight optimistic write from a settings-slice action.
 *
 * Unit conversions on the read path: cents → dollars (labor rate), bps → percent (markup). These
 * mirror the write-path conversions in settings-slice so a value round-trips unchanged.
 *
 * The pricebook catalog itself is NOT read here — v1.settings.get still returns a `pricebook`
 * field (server DTO unchanged, see modules/settings), but the client now sources services from
 * v1.pricebook.service.list via PricebookHydrator (pricebook-slice), not this snapshot.
 */

import { useEffect } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { measurementGateFrom } from "@/lib/measurement-gate";

type SettingsDTO = RouterOutputs["v1"]["settings"]["get"];

export function SettingsHydrator() {
  const setSettings = useAppStore((s) => s.setSettings);
  const { data, isError, error } = api.v1.settings.get.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:settings] load failed", error);
      }
      // Nothing is written, on purpose, and that is now SAFE rather than destructive:
      // toggles.measurementEstimating stays at its `"unknown"` placeholder (a failed read is not
      // an answer), and the measurement surfaces fail OPEN on unknown — see
      // lib/measurement-gate.ts. A refetch that fails after a good load keeps the good value,
      // which is the same rule the list surfaces use (stale data beats an error screen).
      return;
    }
    if (!data) return;
    const dto: SettingsDTO = data;
    setSettings({
      laborRates: dto.laborRates.map((r) => ({
        id: r.id,
        name: r.label,
        rate: Math.round(r.rateCentsPerHour / 100),
        kind: r.kind ?? "hourly",
      })),
      terms: dto.terms.map((t) => ({
        id: t.id,
        t: t.title,
        body: t.body,
      })),
      sources: dto.sources.map((s) => ({
        id: s.id,
        label: s.label,
      })),
      booking: {
        services: dto.config.booking.services,
        notServices: dto.config.booking.notServices,
        serviceFee: dto.config.booking.serviceFee,
        feeCredited: dto.config.booking.feeCredited,
        deferKeywords: dto.config.booking.deferKeywords,
        emergencyTransferNumber: dto.config.booking.emergencyTransferNumber,
        hours: {
          wdOpen: dto.config.hoursWdOpen,
          wdClose: dto.config.hoursWdClose,
          monOpen: dto.config.hoursMonOpen,
          monClose: dto.config.hoursMonClose,
          tueOpen: dto.config.hoursTueOpen,
          tueClose: dto.config.hoursTueClose,
          wedOpen: dto.config.hoursWedOpen,
          wedClose: dto.config.hoursWedClose,
          thuOpen: dto.config.hoursThuOpen,
          thuClose: dto.config.hoursThuClose,
          friOpen: dto.config.hoursFriOpen,
          friClose: dto.config.hoursFriClose,
          satOpen: dto.config.hoursSatOpen,
          satClose: dto.config.hoursSatClose,
          sunOpen: dto.config.hoursSunOpen,
          sunClose: dto.config.hoursSunClose,
        },
        area: {
          cities: dto.config.areaCities,
          radiusMi: dto.config.areaRadiusMi,
          originAddress: dto.config.serviceOriginAddress ?? "",
        },
      },
      markup: Math.round(dto.config.markupBps / 100),
      // bps → percent (875 = 8.75%). Not rounded like markup: a quarter-point is a real US rate.
      taxRate: dto.config.taxBps / 100,
      trade: dto.config.trade,
      toggles: {
        techSeesPrice: dto.config.techSeesPrice,
        timesheetClock: dto.config.timesheetClock,
        techEditsTimes: dto.config.techEditsTimes,
        frontDesk: dto.config.frontDesk,
        autoRemind: dto.config.autoRemind,
        measurementEstimating: measurementGateFrom(dto.config.measurementEstimating),
      },
    });
  }, [data, isError, error, setSettings]);

  return null;
}
