-- Tenant isolation for the AI employee's tables. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0173 created these tables WITHOUT it
-- — this file is the half that makes them tenant-safe.
--
-- agent_task_messages holds transcript content, which is the highest-value cross-tenant read in
-- the product. FORCE is not optional here.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY agent_tasks_tenant_isolation ON public.agent_tasks
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.agent_task_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_task_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY agent_task_messages_tenant_isolation ON public.agent_task_messages
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.agent_tool_executions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_tool_executions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY agent_tool_executions_tenant_isolation ON public.agent_tool_executions
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
