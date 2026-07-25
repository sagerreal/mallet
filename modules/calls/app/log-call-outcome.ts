import type { OutboundCallId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk, notFound } from "@mallet/shared/types";
import type { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";

export interface LogCallOutcomeCmd {
  readonly callId: OutboundCallId;
  readonly outcome: string;
  readonly notes: string;
}

// Writes the disposition the office picked after hanging up. This is the step that turns the
// row into a persisted call log — before it, a refresh lost the record entirely.
export class LogCallOutcomeUseCase {
  constructor(
    private readonly calls: OutboundCallRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: LogCallOutcomeCmd): Promise<Result<OutboundCall, AppError>> {
    const existing = await this.calls.findById(cmd.callId);
    if (!existing) return err(notFound("call not found"));

    const logged = existing.logOutcome(cmd.outcome, cmd.notes, this.clock.now());
    if (!isOk(logged)) return logged;

    const saved = await this.calls.save(logged.value);
    if (!saved) return err(notFound("call not found"));
    return ok(saved);
  }
}
