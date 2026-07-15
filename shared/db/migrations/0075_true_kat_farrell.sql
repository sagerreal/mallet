CREATE TABLE "crew_schedules" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"open_hour" integer NOT NULL,
	"close_hour" integer NOT NULL,
	CONSTRAINT "crew_schedules_org_id_user_id_weekday_pk" PRIMARY KEY("org_id","user_id","weekday"),
	CONSTRAINT "crew_schedules_weekday_check" CHECK ("crew_schedules"."weekday" >= 0 and "crew_schedules"."weekday" <= 6),
	CONSTRAINT "crew_schedules_open_hour_check" CHECK ("crew_schedules"."open_hour" >= 0 and "crew_schedules"."open_hour" <= 24),
	CONSTRAINT "crew_schedules_close_hour_check" CHECK ("crew_schedules"."close_hour" >= 0 and "crew_schedules"."close_hour" <= 24)
);
--> statement-breakpoint
ALTER TABLE "crew_schedules" ADD CONSTRAINT "crew_schedules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_schedules" ADD CONSTRAINT "crew_schedules_user_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id") ON DELETE cascade ON UPDATE no action;