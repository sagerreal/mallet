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
 * Jobs. The customer is a NAME, not an id — the server resolves it per chunk (phone → name →
 * create), so a job CSV never has to carry Mallet ids.
 *
 * `dependsOn` is advisory: importing customers first means jobs match existing records instead of
 * creating them, but a shop re-importing only jobs later must not be blocked.
 *
 * Date/time handling: a row with a date but no time is scheduled at the org's opening hour for
 * that weekday; a row with no date at all imports as an UNSCHEDULED job rather than being skipped,
 * because a backlog of unscheduled work is a legitimate thing to migrate.
 */
export const JOB_IMPORT: ImportDescriptor = {
  entity: "jobs",
  label: "Jobs",
  chunkSize: 500,
  dependsOn: ["customers"],
  fields: [
    {
      key: "customer",
      label: "Customer",
      required: true,
      synonyms: ["customer name", "client name", "customer", "client", "contact", "name"],
      coerce: "text",
      maxLength: 255,
      onInvalid: { kind: "skip-row", message: "No customer — row skipped." },
    },
    {
      key: "phone",
      label: "Phone",
      // Not stored on the job: it is how the server matches an EXISTING customer before falling
      // back to the name, so a sheet carrying phones lands jobs on the right records.
      synonyms: ["mobile", "cell", "phone", "telephone"],
      coerce: "phone",
      onInvalid: { kind: "drop-field" },
    },
    {
      key: "svc",
      label: "Service",
      synonyms: ["service", "job type", "work type", "trade"],
      coerce: "text",
      maxLength: 60,
    },
    {
      key: "scope",
      label: "Description",
      synonyms: ["description", "details", "scope", "notes", "work performed"],
      coerce: "text",
      maxLength: 4000,
    },
    {
      key: "addr",
      label: "Address",
      synonyms: ["service address", "job address", "site address", "address"],
      coerce: "text",
      maxLength: 1000,
    },
    {
      key: "scheduledDate",
      label: "Date",
      synonyms: ["scheduled date", "job date", "start date", "date"],
      coerce: "date",
      onInvalid: { kind: "drop-field" },
    },
    {
      key: "scheduledStart",
      label: "Time",
      synonyms: ["start time", "scheduled time", "time"],
      coerce: "time",
      onInvalid: { kind: "drop-field" },
    },
    {
      key: "status",
      label: "Status",
      synonyms: ["status", "state", "job status"],
      coerce: "enum",
      whenBlank: "scheduled",
      // Spellings seen in Jobber / Housecall Pro / ServiceTitan exports.
      enumValues: {
        scheduled: "scheduled",
        open: "scheduled",
        new: "scheduled",
        upcoming: "scheduled",
        "in progress": "in_progress",
        in_progress: "in_progress",
        active: "in_progress",
        started: "in_progress",
        complete: "complete",
        completed: "complete",
        done: "complete",
        closed: "complete",
        canceled: "canceled",
        cancelled: "canceled",
      },
      onInvalid: { kind: "fallback", value: "scheduled", note: "imported as scheduled." },
    },
  ],
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
