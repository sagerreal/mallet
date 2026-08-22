CREATE TABLE "agent_task_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_task_messages_role_ck" CHECK ("agent_task_messages"."role" in ('user','assistant')),
	CONSTRAINT "agent_task_messages_kind_ck" CHECK ("agent_task_messages"."kind" in ('text','tool_results','user_blocks','assistant'))
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'working' NOT NULL,
	"next_action_at" timestamp with time zone,
	"next_action_note" text,
	"origin" text DEFAULT 'chat' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_role" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_id" uuid,
	"locked_until" timestamp with time zone,
	"transcript_bytes" integer DEFAULT 0 NOT NULL,
	"steps_taken" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "agent_tasks_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "agent_tasks_status_ck" CHECK ("agent_tasks"."status" in ('working','needs_you','done','closed')),
	CONSTRAINT "agent_tasks_origin_ck" CHECK ("agent_tasks"."origin" in ('chat')),
	CONSTRAINT "agent_tasks_role_ck" CHECK ("agent_tasks"."created_by_role" in ('owner','office','tech'))
);
--> statement-breakpoint
CREATE TABLE "agent_tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"tool_use_id" text NOT NULL,
	"tool" text NOT NULL,
	"ok" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_executions_org_use_uq" UNIQUE("org_id","tool_use_id"),
	CONSTRAINT "agent_tool_executions_ok_ck" CHECK ("agent_tool_executions"."ok" in ('ok','error'))
);
--> statement-breakpoint
ALTER TABLE "agent_task_messages" ADD CONSTRAINT "agent_task_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_messages" ADD CONSTRAINT "agent_task_messages_org_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "public"."agent_tasks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_org_creator_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_org_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "public"."agent_tasks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_task_messages_task_seq_idx" ON "agent_task_messages" USING btree ("org_id","task_id","seq");--> statement-breakpoint
CREATE INDEX "agent_tasks_due_idx" ON "agent_tasks" USING btree ("next_action_at") WHERE "agent_tasks"."status" = 'working' and "agent_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "agent_tasks_org_status_idx" ON "agent_tasks" USING btree ("org_id","status","updated_at");