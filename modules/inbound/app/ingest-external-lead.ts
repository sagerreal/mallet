import { Phone, isOk, ok, type Result, type AppError, type Clock } from "@mallet/shared/types";
import type { EnsureCustomerUseCase } from "@mallet/customers";
import type { LeadReceiptRepository, InboundEndpointRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";
import type { NormalizedLead } from "../domain/normalized-lead";
import { logger } from "@mallet/shared/observability";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface IngestInput {
  readonly channel: Channel;
  readonly source: string;
  readonly lead: NormalizedLead;
}
export type IngestOutcome = "created" | "deduped" | "duplicate_ignored";

// Orchestrates external-lead intake: reuses EnsureCustomerUseCase for create/dedupe (never
// reimplemented here) and layers on (channel, externalId) idempotency via the receipts ledger.
export class IngestExternalLeadUseCase {
  constructor(
    private readonly ensureCustomer: EnsureCustomerUseCase,
    private readonly receipts: LeadReceiptRepository,
    private readonly endpoints: InboundEndpointRepository,
    private readonly clock: Clock,
  ) {}

  async exec(input: IngestInput): Promise<Result<{ outcome: IngestOutcome }, AppError>> {
    const { channel, source, lead } = input;
    // Lenient phone/email — drop if unreadable, never reject the whole ingest.
    const parsedPhone = lead.phone ? Phone.parse(lead.phone) : null;
    const phone = parsedPhone && isOk(parsedPhone) ? parsedPhone.value : null;
    const email = lead.email && EMAIL_RE.test(lead.email) ? lead.email : null;

    const result = await this.ensureCustomer.exec({
      name: lead.name, phone, email, source,
      companyId: null, role: null, notes: lead.notes, address: lead.address,
    });
    if (!isOk(result)) return result;

    // Idempotency: record AFTER a successful create so a mid-flight failure can be retried.
    // A repeat (channel, externalId) that was already recorded → treat as duplicate.
    if (lead.externalId) {
      const fresh = await this.receipts.recordIfNew(channel, lead.externalId, result.value.lead.props.id);
      if (!fresh) {
        logger.info({ channel }, "inbound.duplicate_ignored");
        return ok({ outcome: "duplicate_ignored" });
      }
    }
    await this.endpoints.touchLastLead(channel, this.clock.now());
    const outcome = result.value.created ? "created" : "deduped";
    logger.info({ channel, outcome }, `inbound.${outcome}`);
    return ok({ outcome });
  }
}
