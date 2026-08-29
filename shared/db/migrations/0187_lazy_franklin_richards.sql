-- Purchase orders: ship_to becomes an address someone types, not a 3-option picker.
--
-- ADDITIVE ONLY — the shared dev/prod DB is live. This migration adds the new nullable
-- "ship_to_address" text column and stops there. It deliberately does NOT drop the old
-- "ship_to" column (or its check/default): the app stops reading and writing it as of this
-- branch, but the column stays in place, satisfied by its existing NOT NULL default on every
-- future insert. Dropping it is a separate, later migration once nothing depends on its
-- presence.
ALTER TABLE "purchase_orders" ADD COLUMN "ship_to_address" text;
