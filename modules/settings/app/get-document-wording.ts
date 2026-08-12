import type { Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

/**
 * The org's document-wording OVERRIDES — raw, nullable, never resolved.
 *
 * Null means "the standard sentence renders"; the render seams (public invoice page, office
 * preview, tech close-out, change-order sign screen) resolve effective text through
 * domain/document-wording.ts, ONE definition shared by client and server so the two copies
 * of a document cannot disagree about the fallback.
 */
export interface DocumentWording {
  readonly invoiceFooter: string | null;
  readonly payInstructions: string | null;
  readonly receiptNote: string | null;
  readonly changeOrderAgreement: string | null;
}

/**
 * WHY THIS EXISTS SEPARATELY FROM GetSettingsUseCase, and why its procedure is `anyRole`:
 * the technician's close-out renders the invoice footer on the customer's own copy of the
 * bill, and the change-order agreement line is read out loud to a customer at a door —
 * both from the FIELD layout, which cannot mount the ownerOrOffice settings hydrator.
 *
 * Every field here is a sentence the customer is shown, so a technician learning it
 * discloses nothing — the same bar GetBusinessIdentityUseCase documents. No prices, no
 * customer data, no credentials, no office configuration.
 */
export class GetDocumentWordingUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<DocumentWording, AppError>> {
    const p = (await this.repo.getConfig(orgId, defaultBooking)).props;
    return ok({
      invoiceFooter: p.docInvoiceFooter,
      payInstructions: p.docInvoicePayInstructions,
      receiptNote: p.docInvoiceReceiptNote,
      changeOrderAgreement: p.docChangeOrderAgreement,
    });
  }
}
