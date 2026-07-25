import type { OutboundCallId, Phone, Result, ExternalServiceError } from "@mallet/shared/types";

export interface OriginateCallCmd {
  // OUR id, not the customer's number. The provider is told to fetch call instructions for
  // this id; the TwiML route then looks the destination up server-side.
  //
  // SECURITY: the customer number is deliberately NOT part of this command and never appears
  // in a provider-facing URL. If the destination travelled in the request, anyone who could
  // reach the TwiML endpoint could dial an arbitrary number using the org's caller ID.
  readonly callId: OutboundCallId;
  // Leg A — the agent's own mobile, which rings first.
  readonly agentNumber: Phone;
  // The caller ID shown on leg A (the org's business line).
  readonly fromNumber: Phone;
}

export interface CallOriginationReceipt {
  readonly providerCallSid: string;
}

// Outbound voice origination. One implementation (Twilio); a logging stub is NOT provided
// on purpose — a call that silently does not happen is worse than a visible failure.
export interface CallOriginator {
  originate(cmd: OriginateCallCmd): Promise<Result<CallOriginationReceipt, ExternalServiceError>>;
}
