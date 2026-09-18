import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { OrgSettings } from "../domain/org-settings";
import type { OrgSettingsConfigPort } from "../domain/org-settings-repository";

export interface UpdateDocumentsCommand {
  readonly invoiceFooter?: string | null;
  readonly payInstructions?: string | null;
  readonly receiptNote?: string | null;
  readonly changeOrderAgreement?: string | null;
}

/**
 * Updates the document-wording slots — the editable sentences customer documents render
 * (invoice footer, payment instructions, receipt note, change-order agreement line), all in
 * org_settings. undefined = keep current; explicit null clears a slot back to its standard
 * wording (domain/document-wording.ts owns the standard literals).
 *
 * Same shape as UpdateBusinessUseCase for the same reason: one row, one port, no cross-table
 * atomicity argument. Length caps are enforced at the API boundary (zod); the domain trims
 * and normalises blank to null and nothing else — a sentence's shape is the shop's own call.
 *
 * WHAT THIS NEVER TOUCHES: signed evidence. A signature snapshot froze its sentence verbatim
 * at signing time (modules/quoting/domain/signature.ts); editing wording here changes future
 * documents only.
 */
export class UpdateDocumentsUseCase {
  constructor(
    private readonly settings: OrgSettingsConfigPort,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateDocumentsCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.settings.getConfig(orgId, OrgSettings.defaultBooking);
    const now = this.clock.now();

    const patched = current.patchDocuments(
      {
        invoiceFooter: cmd.invoiceFooter,
        payInstructions: cmd.payInstructions,
        receiptNote: cmd.receiptNote,
        changeOrderAgreement: cmd.changeOrderAgreement,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.settings.saveConfig(patched.value);

    logger.info({ orgId }, "documents.updated");
    return ok(patched.value);
  }
}
