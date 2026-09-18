/**
 * features/invoices/document-business.ts
 *
 * The store's BusinessIdentity → the shared <InvoiceDocument>'s `business` prop.
 *
 * TWO FUNCTIONS, NOT ONE WITH A FLAG. Whether the shop's NAME belongs in the block is a property of
 * the SURFACE, not of the data: the office preview sits under a branded `CustHead` that already
 * prints it, the technician's close-out has no branded chrome of its own. A boolean argument makes
 * that a question every caller answers wrongly at least once — and `documentContact` cannot express
 * a name at all, so the wrong answer stops being expressible. Same reasoning as the `name?` field
 * on InvoiceDocumentBusiness itself.
 *
 * Both return `undefined` for an unhydrated identity, so the document omits the block entirely
 * rather than rendering an empty one. No React, no store access — pure and unit-testable.
 */

import type { BusinessIdentity } from "@/lib/store/types";
import type { InvoiceDocumentBusiness } from "@/components/shared/invoice-document";

/**
 * The contact block WITHOUT the shop's name — for a surface whose own branded header prints it.
 *
 * The return type has no `name` key by construction, which is the point: a caller under a branded
 * header physically cannot print the shop's name twice.
 */
export function documentContact(
  identity: BusinessIdentity | null | undefined,
): Omit<InvoiceDocumentBusiness, "name"> | undefined {
  if (!identity) return undefined;
  return {
    address: identity.address,
    phone: identity.phone,
    email: identity.email,
    site: identity.site,
    license: identity.license,
  };
}

/**
 * The contact block WITH the shop's name — for a surface that has no branded header of its own
 * (the technician's close-out document, and any print/PDF of it).
 */
export function documentIdentity(
  identity: BusinessIdentity | null | undefined,
): InvoiceDocumentBusiness | undefined {
  const contact = documentContact(identity);
  if (!contact || !identity) return undefined;
  return { name: identity.name, ...contact };
}
