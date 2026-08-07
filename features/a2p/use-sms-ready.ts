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
 * TWO KINDS OF "NO", and they must not be told the same way. Before the hydrator lands
 * `a2pStatus` is null, and calling that "texting isn't set up yet" accuses a fully registered shop
 * of not being registered for the length of a fetch (the hydration-flash law: no store-derived
 * claim renders before its hydrator has landed). Both disable Send — the gate FAILS CLOSED, since
 * a Send certain to be refused by the carrier is worse than one honestly disabled — but only one
 * of them sends the owner to Settings.
 *
 * NOT for the field. A2pHydrator mounts only in app/(office)/layout.tsx; a technician's surfaces
 * ask `useCanText()` (features/messaging/use-can-text.ts), which is a query, not this store read.
 */

import { useAppStore } from "@/lib/store/app-store";

/** Registration is genuinely unfinished, and the next step is the owner's. */
export const SMS_NOT_READY_REASON =
  "Texting isn't set up yet — finish A2P registration in Settings";
/** We don't know yet. States the wait, promises nothing, blames nobody. */
export const SMS_CHECKING_REASON = "Checking texting setup…";

export interface SmsGate {
  ready: boolean;
  /** Why Send is blocked, or null when it isn't. */
  reason: string | null;
}

export function useSmsGate(): SmsGate {
  const status = useAppStore((s) => s.a2pStatus);
  if (status === null) return { ready: false, reason: SMS_CHECKING_REASON };
  return status.canText
    ? { ready: true, reason: null }
    : { ready: false, reason: SMS_NOT_READY_REASON };
}

/** The gate as a bare boolean, for callers that only branch on it. */
export function useSmsReady(): boolean {
  return useSmsGate().ready;
}
