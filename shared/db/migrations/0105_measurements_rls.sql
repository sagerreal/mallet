-- Tenant isolation for room captures + painting room quantities. Same model as checklists
-- (0053) and job_execution (0026-family): reuse public.current_org_id() (do NOT redefine),
-- ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both tables
-- carry their own org_id (stamped on insert / copied from the parent capture), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.room_captures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.room_captures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY room_captures_tenant_isolation ON public.room_captures
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.painting_room_quantities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.painting_room_quantities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY painting_room_quantities_tenant_isolation ON public.painting_room_quantities
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
