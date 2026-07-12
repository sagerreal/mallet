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

    // Record-first idempotency LOCK: for a channel that carries a stable external id (marketplaces),
    // reserve it before creating. A duplicate reservation means we already ingested this lead — skip
    // the create entirely (crucial for phoneless leads, which dedupe-by-phone can't catch on retry).
    if (lead.externalId) {
      const reserved = await this.receipts.reserve(channel, lead.externalId);
      if (!reserved) {
        logger.info({ channel }, "inbound.duplicate_ignored");
        return ok({ outcome: "duplicate_ignored" });
      }
    }

    const phone = this.parsePhone(lead.phone);
    const email = lead.email && EMAIL_RE.test(lead.email) ? lead.email : null;
    const result = await this.ensureCustomer.exec({
      name: lead.name, phone, email, source,
      companyId: null, role: null, notes: lead.notes, address: lead.address,
    });
    if (!isOk(result)) {
      // Roll back the reservation so a genuine retry isn't wrongly treated as a duplicate.
      if (lead.externalId) await this.receipts.release(channel, lead.externalId);
      logger.info({ channel }, "inbound.ensure_failed");
      return result;
    }

    await this.endpoints.touchLastLead(channel, this.clock.now());
    const outcome = result.value.created ? "created" : "deduped";
    logger.info({ channel, outcome }, `inbound.${outcome}`);
    return ok({ outcome });
  }

  private parsePhone(raw: string | null) {
    if (!raw) return null;
    const parsed = Phone.parse(raw);
    return isOk(parsed) ? parsed.value : null;
  }
}
