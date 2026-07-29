ALTER TABLE "estimates" ADD COLUMN "signer_name" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "signature_svg" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "signer_ip" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "signer_user_agent" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "signed_snapshot" jsonb;