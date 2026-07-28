// Public surface for the staff SMS agent — the only sanctioned import seam (architecture rule).
export { handleStaffSms } from "./app/handle-staff-sms";
export type {
  HandleStaffSmsDeps,
  HandleStaffSmsCommand,
  HandleStaffSmsResult,
  RunTurnInput,
  TurnResult,
  PendingAction,
} from "./app/handle-staff-sms";
export { classifyReply } from "./domain/reply-intent";
export type { ReplyIntent } from "./domain/reply-intent";
export type {
  StaffIdentity,
  StaffByPhoneReader,
  SmsSession,
  SmsSessionStore,
  StaffReplySender,
} from "./domain/ports";
export { DrizzleStaffByPhoneReader, DrizzleSmsSessionStore } from "./infra/drizzle-sms-agent-readers";
export { makeAgentTurnRunner } from "./infra/agent-turn-runner";
export type { AgentTurnRunnerDeps } from "./infra/agent-turn-runner";
export { TwilioStaffReplySender } from "./infra/twilio-staff-reply-sender";
export type { StaffReplySenderConfig } from "./infra/twilio-staff-reply-sender";
