"use client";

/**
 * features/a2p/use-sms-ready.ts
 * "MAY THIS SHOP TEXT?" — asked of the store, for the office surfaces.
 *
 * The fact lives in one place already: A2pHydrator writes `v1.a2p.getStatus` into `a2pStatus`,
 * and that view answers the question itself (`canText`, true only when the 10DLC campaign is
 * `active`). This is a selector over it, not a second derivation — a surface that re-implemented
 * "active means textable" would be a second answer to the carrier's question.
 *
 * FAILS CLOSED: null (not hydrated yet) reads as false. A Send button that is certain to be
 * refused by the carrier is worse than one that is honestly disabled, and the hydrator lands in
 * the same paint as the rest of the office shell.
 *
 * NOT for the field. A2pHydrator mounts only in app/(office)/layout.tsx; a technician's surfaces
 * ask `useCanText()` (features/messaging/use-can-text.ts), which is a query, not this store read.
 */

import { useAppStore } from "@/lib/store/app-store";

/** Why a blocked Send is blocked, in the owner's own next step. One sentence, one place. */
export const SMS_NOT_READY_REASON =
  "Texting isn't set up yet — finish A2P registration in Settings";

export function useSmsReady(): boolean {
  return useAppStore((s) => s.a2pStatus?.canText === true);
}
