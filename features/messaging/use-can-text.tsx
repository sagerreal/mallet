"use client";

/**
 * features/messaging/use-can-text.tsx
 * "May this shop send a text right now?" — the org's A2P 10DLC campaign being active, asked from
 * a surface every role can reach.
 *
 * WHY NOT `v1.a2p.getStatus`. That is the office's source for the same fact and it is
 * `ownerOrOffice`, hydrated into `store.a2pStatus` by A2pHydrator, which mounts only in the
 * office layout. The tech job sheet lives entirely under the FIELD layout, where neither exists —
 * so a technician (and an owner-operator on /my-day) had no way to learn it, and Text was gated
 * on ROLE instead, which is a different question and the wrong one. A shop that has not finished
 * carrier registration cannot text no matter who is holding the phone.
 *
 * WHY NOT A STORE FIELD. `store.a2pStatus` is written by exactly one hydrator; a second writer
 * feeding it a narrower answer would give the same key two sources of truth. This is a read, so
 * it stays a read.
 *
 * NO EXTRA REQUEST on the field surface for a tech: FieldTogglesHydrator already fires this exact
 * query key with this exact staleTime (features/settings/field-toggles-hydrator.tsx), so the two
 * dedupe into one fetch. For owner/office it is one additional `anyRole` query returning two
 * booleans.
 *
 * SERVER-SEEDED, THEN LIVE. The query cache is empty at mount, and `data?.canText === true`
 * collapsed "still loading" into a definite "this shop cannot text" — so the tech job sheet
 * painted Call alone and Text appeared a beat later on every cold open. Fail-closed was the right
 * call for a read that FAILED and the wrong one for a read that had not happened yet; it simply
 * traded the present→absent flash for the absent→present one.
 *
 * The field layout now resolves the same `v1.settings.fieldToggles` DTO per request
 * (lib/auth/server-field-toggles.ts — it was already fetching it for the measurement gate and
 * dropping this field) and passes it through `CanTextProvider`. A context value renders
 * identically on the server and on the first client render, so the first HTML already carries the
 * right shape: no flash, no hydration mismatch. This is the same prior art as
 * `resolveMe` → `useMe(initialData)` and `resolveMeasurementGate` → `MeasurementGateProvider`.
 *
 * THE MERGE RULE mirrors `useMeasurementGate`: the LIVE query wins the moment it has answered, the
 * seed covers every paint before that.
 *
 *   query landed → the query    (a campaign approved mid-session shows up without a reload)
 *   not yet      → the seed     ("yes" / "no" from this request's own server read)
 *
 * STILL FAILS CLOSED, and now only where that is honest: a seed of `"unknown"` means the server's
 * read genuinely failed, and a Text button the carrier is certain to refuse is worse than no Text
 * button. With no provider in the tree (an office surface, a bare test render) the default is
 * `"unknown"`, so the previous fail-closed behaviour is exactly what remains.
 */

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { CanTextSeed } from "@/lib/field-toggles-seed";

const CanTextContext = createContext<CanTextSeed>("unknown");

export function CanTextProvider({ seed, children }: { seed: CanTextSeed; children: ReactNode }) {
  return <CanTextContext.Provider value={seed}>{children}</CanTextContext.Provider>;
}

export function useCanText(): boolean {
  const seeded = useContext(CanTextContext);
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data ? data.canText === true : seeded === "yes";
}
