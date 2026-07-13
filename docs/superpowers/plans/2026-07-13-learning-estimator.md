# The learning estimator — implementation plan (3 PRs)

> Pre-approved by Owen ("okay you can go ahead and build"). Execute inline, task by
> task, no approval pauses. Research grounding:
> prospecting/research/2026-07-13-estimator-memory-deep-research.md (48 sourced
> findings) + 2026-07-13-ai-estimator-presentation-research.md.

**Vision (Owen's):** quotes come from two flows — (A) inbound customer (call/text/
form/Angi) quoted from the office, (B) tech scope visit then office quotes. The
estimator combines: job info from those sources + the user's prompt, the shop's
pricebook + labor rates (NO markup for now — his call), and tribal knowledge that
LEARNS from corrections. Presented as a staged reveal of REAL steps with real
artifact counts, ending in lines materializing. Won-quote comparison is an explicit
stage ("compared against 3 quotes you've won").

**Architecture decisions (binding, from research):**
- Memory = 3 layers: (L1) pricebook WRITE-BACK for service-general scalars;
  (L2) small org-scoped `quoting_rules` table for conditionals only; (L3) episodic
  exemplars = past ACCEPTED quotes injected at draft time. NO general fact store.
- Write triggers: explicit refine loop = front door (regenerate + visible one-tap
  pricebook-update proposal); silent edit-delta mining NEVER writes from one event
  (≥2 recurrences → owner review queue). Org-scoped memory, role-weighted writes.
- Staged run: client-orchestrated real tRPC calls; CONCURRENT pacing (LLM fired at
  t=0, gather stages play during its dead time — zero added latency); every count
  real; stage holds ≥1s; fast-forward if the model returns early.
- Money: cents in domain/DTO, dollars in store. Tenant safety: org from principal.
  No markup in prompts (Owen's explicit call).

---

## PR A — feat/estimator-context (NO migration)

### A1. Job-context gathering endpoint
`v1.ai.gatherJobContext` (ownerOrOfficeNoTx + a short withTenant read, mirroring how
draftEstimate's catalog fetch works): input `{ leadId: uuid }`, output
`{ lead: {name, job, notes, source, address} | null,
   messages: {direction, body, at}[] (last 10, org+lead indexed),
   visitNotes: {jobTitle, note, at}[] (notes from the lead's jobs + their visits,
     latest 5 non-empty),
   counts: { notes: number, texts: number, visitNotes: number } }`.
Strings server-truncated (each note/body ≤ 500 chars, total context ≤ 4000 chars —
boundary caps like the existing description max(2000)). Missing lead → NOT_FOUND.
Unit + int tests (int: caller pattern from modules/ai or quoting int tests).

### A2. Pricing context deepened + shared
Extend catalog-context to carry labor_hours, cost? NO — no markup/cost in prompts
(Owen). Carry: name, unitPriceCents, category, laborHours (null ok), isAddon.
Add labor rates: `{label, rateCentsPerHour, kind}[]` from labor_rates (repo exists
in modules/settings — reuse its reader through DI like DrizzleEstimateReader is
reused; router-layer composition is the accepted pattern).
Feed the SAME context to BOTH drafters — draft-estimate.ts AND draft-estimate-tiers.ts
(fixes the "typical trade pricing" lie). System prompt blocks:
"## This shop's pricebook" (existing format + labor hours when present) and
"## This shop's labor rates".

### A3. Won-quote exemplars (L3)
New reader: latest 2-3 ACCEPTED estimates whose title/lines lexically overlap the
job description (SQL ILIKE any-word match on estimates.title + line descriptions,
org-scoped, status='accepted', ORDER BY accepted_at DESC LIMIT 3; plain SQL, no
embeddings). Injected block: "## Quotes this shop sent and WON (price like these)"
with num, title, line descriptions + prices, total. Cap block ≤ 1500 chars.
Both drafters. Count returned for the UI stage.

### A4. One orchestrator input
Extend both draft procedures' input: `{ description, leadId? }`. When leadId is
present the router gathers job context + exemplars server-side and the response
carries `stages: { jobInfo: {notes,texts,visitNotes}, pricebook: {services,rates},
wonQuotes: {count, nums: string[]} }` so the client can render REAL counts.
(Client may also call gatherJobContext separately for pre-flight display — keep
both paths cheap.)

### A5. Honest copy + tests + gate
Panel copy reflects reality in both formats. Update prompts' unit tests (fake LLM
client pattern). Full gate: tsc · lint · unit · test:int -- modules/ai
modules/quoting · coverage 80/75 · build.
Commits: one per A-task, conventional messages.

## PR B — feat/estimator-stage-reveal (NO migration)

### B1. Empty-state hero
When the quote card has no real lines: the card body leads with one large in-flow
field — placeholder "What's the job? e.g. 40-gal gas water heater swap, haul away
the old unit" — Enter (or "Build the quote" button) starts the run. `+ Add line` /
`From pricebook` remain visible as the quiet manual fallback beneath. Once lines
exist the hero collapses to the existing header AI button (which reopens it).
No sparkle/purple/mascot. Works for both formats (GBB runs the tiers drafter).

### B2. The staged run reveal
In-flow stage list replacing the table area while running (reduced-motion safe):
  ✓ Reading the job — 3 notes · 2 texts · visit findings
  ✓ Your pricebook & rates — 41 services · 2 labor rates
  ✓ Your shop's rules — (PR C; until then this stage is OMITTED — never fake)
  ✓ Compared against quotes you've won — Q-1037, Q-1052, Q-1064
  ● Building the quote…
Mechanics: fire the draft mutation at t=0 (it returns stages+lines together);
if leadId exists ALSO fire gatherJobContext at t=0 for early real counts. Stage
lines tick in sequence during the LLM wait, each holding ≥1s, using whichever
real data has arrived; on mutation resolve, remaining stages fast-forward (≥300ms
each) then rows MATERIALIZE into the line table ~120ms apart (settle animation,
CSS only, prefers-reduced-motion: instant). Errors surface inline per the existing
aiDraftError branch. No-lead runs simply omit the job-info stage.

### B3. Provenance captions
Where determinable, a tiny muted caption under the line description: "pricebook"
(exact name match to a service) or "won quote Q-1037" (exemplar match). Pure
client-side matching against the stages payload — no schema change. Blur-test
friendly (≤3 words).

### B4. Screenshot verification + gate
Playwright pass: empty hero, mid-run stages, materialized rows, GBB variant.
Full gate as PR A.

## PR C — feat/estimator-memory (migrations: quoting_rules + estimates.ai_draft)

### C1. Schema (check gh pr list for migration-lane conflicts FIRST — single-writer)
- `quoting_rules`: id, org_id, rule (text ≤300), service_id nullable FK (org-composite),
  category_id nullable, job_tag text nullable, status 'proposed'|'confirmed',
  source 'refine'|'edit_delta'|'manual', author_user_id, source_estimate_id nullable,
  times_confirmed int default 1, valid_from timestamptz default now(),
  invalidated_at timestamptz nullable, superseded_by uuid nullable, created/updated.
  RLS migration hand-written (ENABLE+FORCE, org_id = current_org_id()).
- `estimates.ai_draft` jsonb nullable — the AI draft snapshot {lines, tiers?, at}
  written when a draft originates from the AI (persisted at v1.quoting.draft time
  via a new optional input field, set by the composer only for AI-originated drafts).

### C2. Refine loop (front door)
The hero field stays visible after a draft as "Refine: tell it what's wrong…".
Submitting calls the drafter again with `{description, leadId?, refine: {previousLines,
feedback}}` — prompt carries the prior draft + the correction, regenerates.
THEN: a small extraction step (same LLM call's tool output includes optional
`proposals: [{kind: 'labor_hours', serviceName, value} | {kind: 'rule', rule}]`)
→ rendered as one-tap chips: "Update 'Water Heater Swap' labor to 5h in your
pricebook? [Update] [Just this quote]". Update → v1.pricebook.service update
(labor_hours) or v1.quoting.rules.create (status confirmed when owner/admin,
proposed otherwise — role from ctx.principal).
Ambiguity rule: proposals only fire when the feedback is service-general on its
face; job-specific phrasing gets no proposal.

### C3. Edit-delta mining (back door — NEVER silent writes)
On send of an AI-originated estimate (ai_draft present): diff snapshot vs sent
lines server-side (deterministic — hours/price per matched service name).
Material deltas append to a `quoting_rule` with status 'proposed', source
'edit_delta', or bump times_confirmed on an existing matching proposal.
Only proposals with times_confirmed ≥ 2 surface in the review queue.
No LLM needed for the diff itself (deterministic compare); optional LLM pass later.

### C4. Rules consumed + the stage becomes real
Confirmed rules scoped by service/category/job_tag match inject as
"## This shop's rules" (cap 20, ordered by times_confirmed). The B2 stage
"Your shop's rules — N rules" turns ON. Counts in the stages payload.

### C5. Review + audit surface
Settings → "Estimator" card: confirmed rules list (edit/invalidate), proposed
queue with [Confirm][Dismiss] (owner/office; only owner confirms proposals that
CONTRADICT a confirmed value). Functional copy. This is the "here's what it
knows about this shop" demo surface.

### C6. Full gate + adversarial review (memory writes = money-adjacent; review
required before PR).

---

Post-arc VC demo: type the job on a lead with texts → four real stages tick →
tiers materialize with provenance → office refines "that's 5h not 10" → one tap
updates the pricebook → next same-type quote drafts at 5h. Total honesty: every
stage shows real data; nothing writes silently.
