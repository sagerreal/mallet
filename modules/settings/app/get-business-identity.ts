import type { Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

/**
 * WHO billed the customer — the identity block printed at the top of an invoice document.
 *
 * ONE definition, read by every surface that renders <InvoiceDocument>: the customer's own
 * `/i/<token>` page, the office "Preview as customer" sheet, and the technician's close-out. They
 * used to disagree because only the public page had any of it (and even there, only the org name);
 * a bill the customer keeps and the copy the shop looks at must state the same facts.
 *
 * `name` is orgs.name — the same value `brand.name` carries. It is repeated here because the FIELD
 * surface never mounts BrandHydrator (that lives in the office layout), so a technician's store
 * holds the "My Business" placeholder; a document that printed that placeholder to a customer
 * standing at the door would be worse than printing nothing.
 *
 * Everything else is nullable and a null field prints NOTHING — never an empty label. See
 * components/shared/invoice-document.tsx for why that invariant is load-bearing.
 */
export interface BusinessIdentity {
  /** The shop's display name (orgs.name). Always present — every org has one. */
  readonly name: string;
  /** Street address of the BUSINESS. Not the service address, not the routing origin. */
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  /** The shop's website, as it writes it (org_settings.brand_site). */
  readonly site: string | null;
  /** Contractor/trade licence, unparsed — the shop's own string. */
  readonly license: string | null;
}

/**
 * The identity facts a customer document states, and nothing else.
 *
 * WHY THIS EXISTS SEPARATELY FROM GetSettingsUseCase, and why its procedure is `anyRole`:
 * `v1.settings.get` is ownerOrOffice and returns the whole configuration — booking rules, hours,
 * service area, labor rates, Connect status. A technician has no business holding any of that. But
 * the close-out document a technician turns around at the door IS the customer's copy of the bill,
 * and a bill with no address, no phone and no licence number leaves the customer no way to query it.
 *
 * Every field below is already printed on the invoice that customer receives, so exposing them to
 * the technician standing in front of them discloses nothing new. No prices, no customer data, no
 * credentials, no office configuration — the same bar `GetFieldTogglesUseCase` documents.
 */
export class GetBusinessIdentityUseCase {
  constructor(private readonly repo: SettingsRepository) {}

  async exec(orgId: string): Promise<Result<BusinessIdentity, AppError>> {
    const p = (await this.repo.getConfig(orgId, defaultBooking)).props;
    return ok({
      name: p.brandName,
      address: p.bizAddress,
      phone: p.bizPhone,
      email: p.bizEmail,
      site: p.brandSite,
      license: p.licenseNumber,
    });
  }
}
