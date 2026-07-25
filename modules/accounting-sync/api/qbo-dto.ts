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
});

export const qboSyncLogRowDTO = z.object({
  malletId: z.string(),
  status: z.enum(["succeeded", "failed", "skipped"]),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attemptedAt: z.date(),
});
