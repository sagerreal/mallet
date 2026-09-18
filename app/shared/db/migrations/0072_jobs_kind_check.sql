-- Close the jobs.kind enum at the storage layer to match every other text-enum column in
-- the schema (jobs_status_check, job_visits_status_check, invoices_status, leads_stage, …).
-- 0070 added the column with a 'work' default but no CHECK; the domain + mapper already
-- validate, this is defense-in-depth so a raw write can never smuggle an out-of-band kind.
-- Additive, idempotent-safe: every existing row is 'work' by the 0070 default.
ALTER TABLE public.jobs ADD CONSTRAINT jobs_kind_check CHECK (kind in ('work', 'estimate'));
