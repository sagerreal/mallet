# Composer Presentation (v4 PR2) Implementation Plan

> Pre-approved by Owen (composer-v4 mock; "continue until the entire mockup has been implemented"). Execute inline, task by task, no approval pauses.

**Goal:** The PaintScout-style presentation: org-level templates of designed pages (cover, about us, reviews, thank-you) that wrap the estimate; a full-page Presentation tab in the composer; snapshot-on-draft semantics; and the customer-facing renderer on /q/[token].

**Architecture:** `presentation_templates` is a per-org soft-deleted collection exactly like `job_terms` (settings module owns CRUD). The estimate carries `presentation_snapshot` jsonb frozen at draft time — the same semantics as `termsSnapshot`, so later template edits never rewrite sent quotes. The composer holds a per-quote COPY (pick template → seed pages → per-quote on/off toggles); EDIT writes through to the org template (PaintScout's model: content is shared, activation is per-quote). The public page renders the snapshot's pages around the existing quote card; the plain quote stays the default when no presentation is attached.

**Page model (jsonb):** `{ key: 'cover'|'about'|'reviews'|'thanks'; on: boolean; title: string; body: string }[]` — ordered. Cover derives its content (org name, quote title, customer, num) and uses `title` as an optional kicker; body pages render `title` + pre-wrap `body`. Customer-side, a non-cover page with an empty body hides itself (mock: "Empty sections hide themselves"). No media/gallery in v1 (no upload infra; Gallery was OFF in the mock). No demo data: a new template's pages are on with empty bodies.

## Global Constraints
- Migrations: 0171 = table (drizzle-generated), 0172 = hand-written RLS + journal entry. Additive only; single-writer (no open PRs touch migrations — verified).
- All wire additions optional; snapshot redaction: presentation carries NO money and NO internal fields.
- Save-draft path (store slice) must carry the presentation or drafts silently lose it — the materialId drop-class bug.
- No floating UI; tokens only; 800-line caps; aria-expanded for disclosures; per-instance ids.
- The revise seed restores the snapshot as an UNLINKED per-quote copy (templateId null → EDIT chips hidden, toggles still work).

## Tasks
1. **Schema + migrations**: `shared/db/schema/presentation-templates.ts` (id, org_id→orgs cascade, name ≤80, pages jsonb, position, timestamps, soft-delete, index (org_id, deleted_at)); `estimates.presentation_snapshot` jsonb `$type<PresentationSnapshotColumn>` = `{ templateName: string; pages: { key; title; body }[] }`; 0172 RLS file per house pattern.
2. **Quoting domain**: `PRESENTATION_PAGE_KEYS`, snapshot validation (≤4 pages, key enum, title ≤120, body ≤8000) in `Estimate.create` via optional prop `presentationSnapshot?`; carried through mapper toDomain + repo save insert/conflict sets (enumeration sites).
3. **Draft plumbing**: command + zod (`presentationSnapshot` optional on draftInput), DTO field, public route JSON (pages only — safe by construction), revise seed.
4. **Settings backend**: repository port + Drizzle methods (list/create/save/archive presentationTemplates), use-cases with zod-validated pages, router nested `presentationTemplates` under settings; unit tests with fakes + int test for RLS round-trip.
5. **Composer**: `cs.presentation: { templateId: string | null; name: string; pages: PresentationPage[] } | null`; `.otabs` Estimate|Presentation with ?tab= deep-link; Presentation pane = template pills + page chips + rendered pages (cover hero, about, reviews, estimate marker, thanks) with in-flow EDIT (persists to template via settings mutation + updates local copy); payload + store slice + dto-mapper carry-through.
6. **Public renderer**: when snapshot present — cover band above the card (accent bg, display type: quote title, prepared-for, org), body pages as sections, thanks band after terms; quote card unchanged between them.
7. **Gates + verify + PR**: typecheck, lint, lint:css, unit, int (serial, nothing else on the DB), migrate+verify, browser screenshots (composer tab + customer page), PR.
