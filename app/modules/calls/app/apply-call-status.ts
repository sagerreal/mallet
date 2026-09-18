import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk, notFound } from "@mallet/shared/types";
import type { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";

export interface ApplyCallStatusCmd {
  readonly providerCallSid: string;
  readonly providerStatus: string;
  readonly durationSec: number | null;
}

// Applies a provider status callback to the stored call. Called from the Twilio voice-status
// webhook, which has already verified the request signature.
export class ApplyCallStatusUseCase {
  constructor(
    private readonly calls: OutboundCallRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ApplyCallStatusCmd): Promise<Result<OutboundCall, AppError>> {
    const existing = await this.calls.findByProviderSid(cmd.providerCallSid);
    if (!existing) return err(notFound("no outbound call matches that provider call sid"));

    const updated = existing.applyProviderStatus(cmd.providerStatus, cmd.durationSec, this.clock.now());
    if (!isOk(updated)) return updated;

    const saved = await this.calls.save(updated.value);
    if (!saved) return err(notFound("the outbound call disappeared before the status could be applied"));
    return ok(saved);
  }
}
