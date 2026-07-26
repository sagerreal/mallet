import { z } from "zod";

// Wire shapes for the QuickBooks connection. Deliberately secret-free: no token field, sealed or
// otherwise, appears here — so there is no route by which a credential could reach the client.

export const qboStatusDTO = z.object({
  /** False when the server has no client credentials — the card says "not configured". */
  configured: z.boolean(),
  state: z.enum(["not_connected", "connected", "needs_reauth", "disconnected"]),
  /** Intuit's company id. Not a secret — it appears in QuickBooks' own URLs. */
  realmId: z.string().nullable(),
  connectedByUserId: z.string().nullable(),
  lastSyncAt: z.date().nullable(),
  expired: z.boolean(),
});

export type QboStatusDTO = z.infer<typeof qboStatusDTO>;

export const qboBeginConnectDTO = z.object({
  /** Intuit consent URL. Carries the signed state; the client navigates the browser to it. */
  url: z.string(),
});

/** One row of the crew-matching screen: a Mallet person and who they map to in QuickBooks. */
export const qboCrewRowDTO = z.object({
  userId: z.string(),
  name: z.string(),
  qboId: z.string().nullable(),
  qboName: z.string().nullable(),
  qboKind: z.enum(["Employee", "Vendor"]).nullable(),
});

export const qboPersonDTO = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.enum(["Employee", "Vendor"]),
  /** False when QuickBooks will not carry this person's time into payroll. */
  usesTimeForPaychecks: z.boolean().nullable(),
});

export const qboSetupDTO = z.object({
  /** QuickBooks-side facts we must check before pushing anything. */
  timeTrackingEnabled: z.boolean(),
  companyName: z.string().nullable(),
  /** Existing TimeActivity in the trailing window — a warning sign of double entry. */
  existingTimeEntries: z.number(),
  people: z.array(qboPersonDTO),
  items: z.array(z.object({ id: z.string(), name: z.string() })),
  crew: z.array(qboCrewRowDTO),
  /** The item hours are filed under — either the shop's saved choice, or QBO's own default. */
  defaultItemQboId: z.string().nullable(),
  defaultItemName: z.string().nullable(),
  /**
   * False when the id above is only QuickBooks' suggestion and has NOT been persisted here. The
   * UI must commit it before enabling the push, or the shop sees a choice on screen that the
   * server doesn't have.
   */
  defaultItemSaved: z.boolean(),
  sendApprovedHours: z.boolean(),
  /** The invoice-line item and its own switch — separate from the hours pair above. */
  defaultInvoiceItemQboId: z.string().nullable(),
  defaultInvoiceItemName: z.string().nullable(),
  sendInvoices: z.boolean(),
});

/**
 * One logged push attempt, as the Settings card renders it.
 *
 * Carries no ids the shop cannot act on beyond `malletId` (kept so support can be handed something
 * exact) and no token material — this crosses to the client bundle.
 */
export const qboSyncActivityRowDTO = z.object({
  entityType: z.string(),
  malletId: z.string(),
  /** "Owen Duggan · Jul 25" — what the shop recognises. */
  label: z.string(),
  status: z.enum(["succeeded", "failed", "skipped"]),
  qboId: z.string().nullable(),
  problem: z
    .object({
      code: z.string(),
      says: z.string(),
      fix: z.string().nullable(),
      retryable: z.boolean(),
    })
    .nullable(),
  /** QuickBooks' own words, when it gave any. Shown under the explanation, never instead of it. */
  detail: z.string().nullable(),
  attemptedAt: z.date(),
});

export const qboSyncActivityDTO = z.object({
  rows: z.array(qboSyncActivityRowDTO),
  retryableCount: z.number().int().min(0),
});

export type QboSyncActivityDTO = z.infer<typeof qboSyncActivityDTO>;
