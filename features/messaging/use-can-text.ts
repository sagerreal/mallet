"use client";

/**
 * features/messaging/use-can-text.ts
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
 * FAILS CLOSED. Loading, error and "not registered" all answer `false`. The caller's contract is
 * "do not render a dead control": a Text button that is certain to be refused by the carrier is
 * worse than no Text button, and a brief flash of one while the query settles is worse still.
 */

import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function useCanText(): boolean {
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data?.canText === true;
}
