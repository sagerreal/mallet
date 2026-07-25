import type { OutboundCallId, Result, AppError } from "@mallet/shared/types";
import { ok, err, notFound } from "@mallet/shared/types";
import type { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";

// Reads one call back. The call bar polls this while a call is connecting, because the truth about
// whether the agent actually answered arrives at the Twilio status webhook, not in the response to
// placing the call — without this read the bar can only guess, and it used to guess "live".
//
// The repository is org-scoped, so a call belonging to another org reads as absent and the caller
// gets a refusal it can stop polling on.
export class GetOutboundCallUseCase {
  constructor(private readonly calls: OutboundCallRepository) {}

  async exec(id: OutboundCallId): Promise<Result<OutboundCall, AppError>> {
    const found = await this.calls.findById(id);
    if (!found) return err(notFound("that call is no longer available"));
    return ok(found);
  }
}
