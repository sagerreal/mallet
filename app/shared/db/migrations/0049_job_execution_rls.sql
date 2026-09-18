-- Tenant isolation for job execution data. Same model as job_visits (0026) and estimate_lines
-- (0006): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy
-- keyed on org_id, fail-closed when unset. Each child table carries its own org_id (stamped on
-- insert), so it isolates independently of its parent job — the runtime role (NOBYPASSRLS) can
-- never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.job_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_addons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_addons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_verify_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_verify_answers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY job_lines_tenant_isolation ON public.job_lines
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_addons_tenant_isolation ON public.job_addons
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_verify_answers_tenant_isolation ON public.job_verify_answers
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY job_photos_tenant_isolation ON public.job_photos
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
