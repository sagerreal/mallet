-- kind becomes the single source of truth for "is this an estimate visit".
--
-- Two fields said it and disagreed: jobs.svc (free-text trade label) carried the magic value
-- 'estimate' that every UI and SQL predicate read, while jobs.kind — the closed enum built for
-- exactly this — was written only by the AI front desk and read by nothing. A voice-booked
-- estimate (kind='estimate', svc='Water heater repair') therefore rendered as regular work.
--
-- Data-only; the column and its CHECK constraint (0072) already exist. 13 live rows at the time
-- of writing; zero rows have ever carried kind='estimate' from the office path.
UPDATE jobs SET kind = 'estimate' WHERE svc = 'estimate' AND kind <> 'estimate';
--> statement-breakpoint
-- svc returns to being purely the trade label it was declared as.
UPDATE jobs SET svc = NULL WHERE svc = 'estimate';
