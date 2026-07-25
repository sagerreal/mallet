ALTER TABLE "outbound_calls" ALTER COLUMN "agent_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD COLUMN "transport" text DEFAULT 'phone' NOT NULL;