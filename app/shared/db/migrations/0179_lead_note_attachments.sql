-- One attachment per customer note — a document or a photo — mirroring the team_messages
-- columns rather than adding a child table: a note carrying two files is two notes, which is
-- what the activity trail renders anyway.
--
-- The bytes are NOT here. They live in the EXISTING private "job-photos" bucket under
-- <org_id>/leads/<lead_id>/<uuid>.<ext>; these columns hold only the key, and a view link is
-- always minted from the stored path, never from one a client hands in.
--
-- lead_notes already has RLS (ENABLE + FORCE, org_id = current_org_id()), so this is columns
-- and constraints only — no RLS migration follows.
--
-- Additive: every column is nullable and every existing row satisfies the shape check with all
-- three null. NOT re-emitting org_settings."agent_autonomy" — drizzle offered it because 0176
-- is hand-written and carries no snapshot, but 0176 already added it.
ALTER TABLE "lead_notes" ADD COLUMN "attachment_path" text;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD COLUMN "attachment_type" text;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD COLUMN "attachment_name" text;--> statement-breakpoint
-- One object, one note: a replayed Save cannot attach the same upload twice. Nullable columns
-- compare as distinct in a UNIQUE, so the note-with-no-attachment rows do not collide.
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_org_attachment_uq" UNIQUE("org_id","attachment_path");--> statement-breakpoint
-- The three attachment columns move together — all set, or all null. A path with no name
-- renders as an unlabelled button; a name with no path opens nothing.
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_attachment_shape_check" CHECK (("lead_notes"."attachment_path" is null) = ("lead_notes"."attachment_type" is null)
          and ("lead_notes"."attachment_path" is null) = ("lead_notes"."attachment_name" is null));
