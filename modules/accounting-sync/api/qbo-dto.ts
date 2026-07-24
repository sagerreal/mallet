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
