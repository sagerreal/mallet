import { randomBytes } from "node:crypto";
import type { InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface SendInvoiceCommand {
  readonly invoiceId: InvoiceId;
}

// 32 bytes → 64 hex chars, 256 bits of entropy — same shape/strength as the estimates' token.
const generatePublicToken = (): string => randomBytes(32).toString("hex");

// draft -> sent, stamping the due date. Emits invoice.sent carrying dueAt so a future reminder job
// can schedule (no scheduler in the pilot). Also mints the public pay-link token on FIRST send —
// stable thereafter (a re-send never rotates a link the customer already holds), and a legacy
// sent invoice with no token gets one on its next send without re-emitting invoice.sent.
export class SendInvoiceUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SendInvoiceCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    const sent = invoice.send(this.clock.now());
    if (!isOk(sent)) return sent;
    const transitioned = sent.value !== invoice;

    // Mint the pay-link credential if this invoice has none. withPublicToken is write-once, and
    // the repository's COALESCE guard re-enforces that in SQL under concurrency.
    const minted = sent.value.props.publicToken === null;
    const finalized = minted ? sent.value.withPublicToken(generatePublicToken()) : sent.value;

    // Fully idempotent no-op: already sent AND already carrying a token — nothing to write.
    if (!transitioned && !minted) return ok(invoice);

    await this.repo.save(finalized);
    if (transitioned) {
      await this.bus.emit({
        name: "invoice.sent",
        orgId: finalized.props.orgId,
        payload: {
          invoiceId: finalized.props.id,
          leadId: finalized.props.leadId,
          dueAt: finalized.props.dueAt?.toISOString() ?? null,
        },
        occurredAt: this.clock.now(),
      });
    }

    if (minted) {
      // The DB keeps the FIRST token under a racing double-send (COALESCE). Re-read so the
      // returned invoice — and the link built from it — carries the token the row actually holds.
      const persisted = await this.repo.findById(cmd.invoiceId);
      if (persisted) return ok(persisted);
    }
    return ok(finalized);
  }
}
