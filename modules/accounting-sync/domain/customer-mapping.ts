import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/** A Mallet customer, narrowed to what QuickBooks can hold. */
export interface SyncableCustomer {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** Free text — Mallet stores one address line, not a structured address. */
  readonly address: string | null;
}

/** What we send to create a QuickBooks Customer. */
export interface QboCustomerInput {
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** Sent as BillAddr.Line1. Deliberately unparsed — see below. */
  readonly addressLine1: string | null;
}

export const NO_NAME = "customer_has_no_name";
export const NAME_TOO_LONG = "customer_name_too_long";

/**
 * QuickBooks' own limit on DisplayName. Longer is rejected by the API, so catching it here turns a
 * remote 400 into a local refusal that names the customer.
 */
const DISPLAY_NAME_MAX = 100;

/**
 * Map a Mallet customer to a QuickBooks Customer.
 *
 * Deliberate choices:
 *
 * - **DisplayName is the whole match key.** QuickBooks requires it to be UNIQUE across the company
 *   and rejects a duplicate outright, which is why the caller searches before it creates.
 * - **The address is sent as ONE line, unparsed.** Mallet keeps `leads.address` as free text while
 *   QuickBooks wants structured Line1/City/CountrySubDivisionCode/PostalCode. Hand-rolling an
 *   address parser to fill those would invent data — a wrong `CountrySubDivisionCode` is a wrong
 *   sales-tax jurisdiction, and Automated Sales Tax falls back to the company address when it
 *   cannot read one, which is the safer failure.
 * - **Nothing is truncated to fit.** A name too long to send is reported, not silently shortened:
 *   a customer filed under a clipped name is one nobody can find again.
 */
export const toQboCustomer = (
  customer: SyncableCustomer,
): Result<QboCustomerInput, ValidationError> => {
  const displayName = customer.name.trim();
  if (displayName.length === 0) {
    return err(validation("this customer has no name to file under", NO_NAME));
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return err(
      validation(
        `this customer's name is longer than QuickBooks allows (${DISPLAY_NAME_MAX} characters)`,
        NAME_TOO_LONG,
      ),
    );
  }

  const trimmedOrNull = (v: string | null): string | null => {
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };

  return ok({
    displayName,
    email: trimmedOrNull(customer.email),
    phone: trimmedOrNull(customer.phone),
    addressLine1: trimmedOrNull(customer.address),
  });
};
