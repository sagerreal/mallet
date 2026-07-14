/**
 * lib/phone.ts
 * The ONE has-a-phone check for phone-dependent controls (Call / Text buttons,
 * conversation rows). The store's "no phone" convention is an empty/blank value
 * OR the em-dash placeholder "—" (prototype-era rows) — checks scattered as
 * `phone && phone !== "—"` live here so every surface agrees.
 */

const NO_PHONE_PLACEHOLDER = "—";

/** Title for a disabled phone-dependent control — same copy on every surface. */
export const ADD_PHONE_TITLE = "Add a phone number first";

interface PhoneBearer {
  phone?: string | null;
}

/**
 * True when the lead (or any record with a `phone` field) has a real phone
 * number on file — not null/undefined, not blank, not the "—" placeholder.
 */
export function hasPhone(bearer: PhoneBearer | null | undefined): boolean {
  const p = (bearer?.phone ?? "").trim();
  return p.length > 0 && p !== NO_PHONE_PLACEHOLDER;
}
