-- Customer tags: the office's own labels for a customer, a SET rather than one value.
--
-- `leads.source` is deliberately left alone. It is machine-written provenance (front desk,
-- inbound form, importer, manual create) and on the live book 162 of its 183 populated values
-- read "Added manually" / "Import" — which is what the old single-select Lead source picker
-- actually collected. The picker moves to this column; the provenance stays where it is.
--
-- Empty array, never null, so no read needs a null branch. No new RLS: `leads` is already
-- FORCE ROW LEVEL SECURITY org-scoped, and a column inherits the table's policies.
ALTER TABLE "leads" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;
