import { z } from "zod";
import type { Message } from "../domain/message";

// The wire-safe DTO returned by every messaging endpoint. Clients key on `direction` to
// decide rendering side (left vs right in the thread view).
export const messageDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  status: z.enum(["queued", "sent", "delivered", "failed", "received"]),
  createdAt: z.date(),
});

export type MessageDTO = z.infer<typeof messageDTO>;

export const toMessageDTO = (m: Message): MessageDTO => ({
  id: m.props.id,
  leadId: m.props.leadId,
  direction: m.props.direction,
  body: m.props.body,
  status: m.props.status,
  createdAt: m.props.createdAt,
});
