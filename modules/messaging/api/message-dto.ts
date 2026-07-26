import { z } from "zod";
import type { Message } from "../domain/message";
import { explainSmsFailure } from "../domain/delivery-status";

// The wire-safe DTO returned by every messaging endpoint. Clients key on `direction` to
// decide rendering side (left vs right in the thread view).
export const messageDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  status: z.enum(["queued", "sent", "delivered", "failed", "received"]),
  /**
   * Present only when the carrier refused it. The raw code is useless to a shop, so the
   * explanation travels instead — already in plain words, with the next step where there is one.
   */
  failure: z
    .object({ code: z.string(), says: z.string(), fix: z.string().nullable() })
    .nullable(),
  createdAt: z.date(),
});

export type MessageDTO = z.infer<typeof messageDTO>;

export const toMessageDTO = (m: Message): MessageDTO => ({
  id: m.props.id,
  leadId: m.props.leadId,
  direction: m.props.direction,
  body: m.props.body,
  status: m.props.status,
  // Explained at the boundary rather than in the browser: the mapping is a domain fact about what
  // carriers do, and every surface that renders a message deserves the same sentence.
  failure: m.props.status === "failed" ? explainSmsFailure(m.props.errorCode) : null,
  createdAt: m.props.createdAt,
});
