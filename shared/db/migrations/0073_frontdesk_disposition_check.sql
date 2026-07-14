-- Close the frontdesk_calls.disposition enum at the storage layer to match every other text-enum
-- column in the schema (jobs_status_check, jobs_kind_check, job_visits_status_check, invoices_status,
-- leads_stage, …). 0070 added the column with a 'no_action' default but no CHECK; the domain +
-- RecordCallUseCase already validate, this is defense-in-depth so a raw write can never smuggle an
-- out-of-band disposition. Additive, idempotent-safe: every existing row is a valid value.
ALTER TABLE public.frontdesk_calls ADD CONSTRAINT frontdesk_calls_disposition_check CHECK (disposition in ('booked_job', 'booked_estimate', 'quote_request', 'message', 'emergency', 'screened', 'no_action'));
