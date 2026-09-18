-- A shop's Square connection: the OAuth tokens that let Mallet take payments on their behalf.
--
-- SEPARATE TABLE, not columns on org_settings where Stripe's connected account lives. Square is
-- "connect the account the shop ALREADY has" — tokens, expiry and a refresh lifecycle, which is
-- the qbo_connections shape, not the stripe_connected_account_id shape. One set of columns cannot
-- carry two unrelated lifecycles.
--
-- Both token columns hold SEALED values (AES-256-GCM), never plaintext. These authorise charges
-- against a real merchant, so nothing in this table may be logged. RLS is 0167 — drizzle-kit does
-- not emit it, and a table of payment credentials without tenant isolation is the worst possible
-- one to leave open.
--
-- WRITTEN RE-RUNNABLE. This was first generated as 0165 and applied to the shared database before
-- the provider-seam branch took that number on main; renumbering changes the file hash, so drizzle
-- offers it again against a database that already has the table. Same convention as 0156/0157/0159.

CREATE TABLE IF NOT EXISTS "square_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"location_id" text,
	"access_token_sealed" text DEFAULT '' NOT NULL,
	"refresh_token_sealed" text DEFAULT '' NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by_user_id" uuid,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "square_connections_status_ck" CHECK ("square_connections"."status" in ('active','disconnected','expired'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "square_connections" ADD CONSTRAINT "square_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "square_connections_org_live_uq" ON "square_connections" USING btree ("org_id") WHERE "square_connections"."deleted_at" is null;