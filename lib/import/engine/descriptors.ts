/**
 * The entity descriptors.
 *
 * These two reproduce, exactly, what `map-rows.ts` and `map-service-rows.ts` did by hand — same
 * synonyms, same clamps, same skip/warn behaviour. That equivalence is the point: if the
 * descriptor could not express what the hand-written importers already do, the abstraction would
 * be wrong, and better to find that out here than halfway through jobs.
 *
 * Adding an entity means adding a descriptor here plus a server procedure. Adding a FIELD to an
 * existing entity means one entry in `fields` — no engine change.
 */

import type { ImportDescriptor } from "./descriptor";

/**
 * Customers. Only `name` is required; an unreadable phone or email is dropped with a warning and
 * the row still imports. Clamps mirror the server's Zod bounds in lead-router.ts.
 */
export const CUSTOMER_IMPORT: ImportDescriptor = {
  entity: "customers",
  label: "Customers",
  chunkSize: 500,
  fields: [
    {
      key: "name",
      label: "Name",
      required: true,
      synonyms: ["first name", "full name", "customer name", "customer", "contact", "name", "display name"],
      coerce: "text",
      maxLength: 255,
      onInvalid: { kind: "skip-row", message: "No name — row skipped." },
      combinesWith: {
        key: "lastName",
        label: "Last name",
        synonyms: ["last name", "surname", "family name"],
      },
    },
    {
      key: "phone",
      label: "Phone",
      synonyms: ["mobile", "cell", "phone", "telephone", "primary phone"],
      coerce: "phone",
      onInvalid: { kind: "drop-field" },
    },
    {
      key: "email",
      label: "Email",
      synonyms: ["email address", "e-mail", "email"],
      coerce: "email",
      maxLength: 320,
      onInvalid: { kind: "drop-field" },
    },
    {
      key: "address",
      label: "Address",
      synonyms: ["billing address", "service address", "street", "address"],
      coerce: "text",
      maxLength: 500,
    },
    {
      key: "notes",
      label: "Notes",
      synonyms: ["notes", "note", "description", "memo"],
      coerce: "text",
      maxLength: 2000,
    },
  ],
  constant: {
    key: "source",
    label: "Tag these as",
    defaultValue: "Import",
    maxLength: 255,
  },
};

/**
 * Pricebook services. `name` is required; an unreadable price or cost warns and falls back to
 * zero rather than dropping the row — a service with a missing price is still worth importing,
 * and the shop can correct it. Clamps mirror pricebook-router.ts.
 */
export const SERVICE_IMPORT: ImportDescriptor = {
  entity: "services",
  label: "Services",
  chunkSize: 500,
  fields: [
    {
      key: "name",
      label: "Name",
      required: true,
      synonyms: ["service name", "service", "item name", "item", "task", "name"],
      coerce: "text",
      maxLength: 500,
      onInvalid: { kind: "skip-row", message: "No name — row skipped." },
    },
    {
      key: "category",
      label: "Category",
      synonyms: ["category", "service category", "type", "group"],
      coerce: "text",
      maxLength: 255,
    },
    {
      key: "code",
      label: "Code",
      synonyms: ["code", "sku", "item code"],
      coerce: "text",
      maxLength: 120,
    },
    {
      key: "unitPriceCents",
      label: "Price",
      synonyms: ["customer price", "sell price", "price", "rate", "amount"],
      coerce: "money",
      whenBlank: 0,
      onInvalid: { kind: "fallback", value: 0, note: "imported at $0." },
    },
    {
      key: "costCents",
      label: "Cost",
      synonyms: ["material cost", "our cost", "cost"],
      coerce: "money",
      whenBlank: 0,
      onInvalid: { kind: "fallback", value: 0, note: "imported at $0." },
    },
    {
      key: "description",
      label: "Description",
      synonyms: ["description", "details", "work description"],
      coerce: "text",
      maxLength: 10_000,
    },
    {
      key: "taxable",
      label: "Taxable",
      synonyms: ["taxable", "tax"],
      coerce: "boolean",
      whenBlank: false,
    },
  ],
};
