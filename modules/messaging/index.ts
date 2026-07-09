// Public surface for the messaging module — the only sanctioned import seam.
export { createMessagingRouter } from "./api/messaging-router";
export type { MessageDTO } from "./api/message-dto";
export type { Message, MessageProps, MessageDirection, MessageStatus } from "./domain/message";
export type { MessageRepository, OrgByNumberReader, LeadByPhoneReader, LeadUnreadMarker } from "./domain/message-repository";
export { SendMessageUseCase } from "./app/send-message";
export { RecordInboundMessageUseCase } from "./app/record-inbound-message";
export { ListThreadUseCase } from "./app/list-thread";
export { DrizzleMessageRepository, DrizzleOrgByNumberReader, DrizzleLeadByPhoneReader, DrizzleLeadUnreadMarker } from "./infra/drizzle-message-repository";
