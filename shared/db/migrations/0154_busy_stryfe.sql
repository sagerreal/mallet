CREATE TABLE "team_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"attachment_path" text,
	"attachment_type" text,
	"attachment_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_messages_org_attachment_uq" UNIQUE("org_id","attachment_path"),
	CONSTRAINT "team_messages_attachment_shape_check" CHECK (("team_messages"."attachment_path" is null) = ("team_messages"."attachment_type" is null)
          and ("team_messages"."attachment_path" is null) = ("team_messages"."attachment_bytes" is null)),
	CONSTRAINT "team_messages_attachment_type_check" CHECK ("team_messages"."attachment_type" is null
          or "team_messages"."attachment_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "team_messages_attachment_bytes_check" CHECK ("team_messages"."attachment_bytes" is null or "team_messages"."attachment_bytes" > 0),
	CONSTRAINT "team_messages_content_check" CHECK (length(btrim("team_messages"."body")) > 0 or "team_messages"."attachment_path" is not null)
);
--> statement-breakpoint
CREATE TABLE "team_thread_members" (
	"org_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_thread_members_org_id_thread_id_user_id_pk" PRIMARY KEY("org_id","thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"dm_key" text,
	"job_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_threads_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "team_threads_kind_check" CHECK ("team_threads"."kind" in ('dm', 'group')),
	CONSTRAINT "team_threads_shape_check" CHECK (("team_threads"."kind" = 'dm' and "team_threads"."dm_key" is not null and "team_threads"."title" is null)
          or ("team_threads"."kind" = 'group' and "team_threads"."dm_key" is null and "team_threads"."title" is not null))
);
--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_thread_fk" FOREIGN KEY ("org_id","thread_id") REFERENCES "public"."team_threads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_author_fk" FOREIGN KEY ("org_id","author_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_thread_members" ADD CONSTRAINT "team_thread_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_thread_members" ADD CONSTRAINT "team_thread_members_thread_fk" FOREIGN KEY ("org_id","thread_id") REFERENCES "public"."team_threads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_thread_members" ADD CONSTRAINT "team_thread_members_user_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_threads" ADD CONSTRAINT "team_threads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_threads" ADD CONSTRAINT "team_threads_creator_fk" FOREIGN KEY ("org_id","created_by_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_threads" ADD CONSTRAINT "team_threads_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_messages_org_thread_idx" ON "team_messages" USING btree ("org_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "team_thread_members_org_user_idx" ON "team_thread_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "team_threads_org_job_idx" ON "team_threads" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_threads_org_dmkey_uidx" ON "team_threads" USING btree ("org_id","dm_key") WHERE "team_threads"."dm_key" is not null;--> statement-breakpoint
CREATE INDEX "team_threads_org_recent_idx" ON "team_threads" USING btree ("org_id","last_message_at" DESC NULLS LAST);