"use client";

/**
 * features/a2p/use-sms-ready.ts
 * "MAY THIS SHOP TEXT, AND IF NOT, WHOSE MOVE IS IT?" — asked of the store, for the office.
 *
 * The fact lives in one place already: A2pHydrator writes `v1.a2p.getStatus` into `a2pStatus`,
 * and that view answers the question itself (`canText`, true only when the 10DLC campaign is
 * `active`). This is a selector over it, not a second derivation — a surface that re-implemented
 * "active means textable" would be a second answer to the carrier's question.
 *
 * FOUR "NO"S, AND THEY MUST NOT BE TOLD THE SAME WAY. This hook used to answer every non-active
 * state with one sentence — "Texting isn't set up yet — finish A2P registration in Settings" —
 * and it was wrong in two of them:
 *
 *   checking  the hydrator hasn't landed. Calling that "isn't set up" accuses a fully registered
 *             shop of not being registered for the length of a fetch (the hydration-flash law:
 *             no store-derived CLAIM renders before its hydrator has landed).
 *   pending   the shop submitted and a carrier is reviewing. Sending that owner to Settings tells
 *             them to finish something they already finished; there is no step, so no action.
 *
 * All four still fail closed — a Send certain to be refused by the carrier is worse than one
 * honestly blocked — but only two of them hand anybody a task.
 *
 * NOT FOR THE FIELD. A2pHydrator mounts only in app/(office)/layout.tsx, and `a2p.getStatus` is
 * `ownerOrOffice` besides. A technician's surfaces ask `useCanText()`
 * (features/messaging/use-can-text.tsx), which is a query returning ONE boolean — see
 * SMS_FIELD_NOTE in ./sms-copy for why the field's sentence is deliberately state-free.
 */

import { useAppStore } from "@/lib/store/app-store";
import {
  SMS_CHECKING_NOTE,
  SMS_FAILED_FALLBACK_DETAIL,
  SMS_FAILED_NOTE,
  SMS_FIX_LABEL,
  SMS_NOT_SET_UP_DETAIL,
  SMS_NOT_SET_UP_NOTE,
  SMS_PENDING_DETAIL,
  SMS_PENDING_NOTE,
  SMS_SETTINGS_HREF,
  SMS_SETUP_LABEL,
} from "./sms-copy";

/** Which "no" this is — or `active`, which is the only yes. */
export type SmsGateState = "checking" | "not_started" | "pending" | "failed" | "active";

export interface SmsGateAction {
  readonly label: string;
  readonly href: string;
}

export interface SmsGate {
  readonly ready: boolean;
  readonly state: SmsGateState;
  /** One clause, for the line under a blocked control. Null when texting works. */
  readonly note: string | null;
  /**
   * The whole sentence, for the account banner. Null when texting works AND while checking —
   * a banner that appears mid-fetch and then vanishes is the flash this hook exists to prevent.
   */
  readonly detail: string | null;
  /** Where the fix lives — present ONLY in the states somebody can act on. */
  readonly action: SmsGateAction | null;
}

const ACTIVE: SmsGate = { ready: true, state: "active", note: null, detail: null, action: null };

export function useSmsGate(): SmsGate {
  // `?? null` folds "the key isn't there" into "the hydrator hasn't landed". They are the same
  // answer to the only question this hook asks — we do not know whether this shop may text — and
  // both fail closed. It also keeps a surface that mounts outside the office shell (or a test
  // rendering with a narrow store) from throwing instead of blocking.
  const status = useAppStore((s) => s.a2pStatus) ?? null;

  if (status === null) {
    return { ready: false, state: "checking", note: SMS_CHECKING_NOTE, detail: null, action: null };
  }
  if (status.canText) return ACTIVE;

  if (status.status === "failed") {
    return {
      ready: false,
      state: "failed",
      note: SMS_FAILED_NOTE,
      // The carrier's own words when we have them. They are the only thing that says what to fix.
      detail: status.failureReason ?? SMS_FAILED_FALLBACK_DETAIL,
      action: { label: SMS_FIX_LABEL, href: SMS_SETTINGS_HREF },
    };
  }
  if (status.status === "not_started") {
    return {
      ready: false,
      state: "not_started",
      note: SMS_NOT_SET_UP_NOTE,
      detail: SMS_NOT_SET_UP_DETAIL,
      action: { label: SMS_SETUP_LABEL, href: SMS_SETTINGS_HREF },
    };
  }

  // Everything else — collecting, profile/brand/campaign/number pending — is one idea to a shop:
  // somebody else is reviewing it. No action, because there is no step to take.
  return { ready: false, state: "pending", note: SMS_PENDING_NOTE, detail: SMS_PENDING_DETAIL, action: null };
}

/** The gate as a bare boolean, for callers that only branch on it. */
export function useSmsReady(): boolean {
  return useSmsGate().ready;
}
