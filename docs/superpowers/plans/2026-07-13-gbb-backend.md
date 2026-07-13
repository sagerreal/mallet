# Real Good/Better/Best (PR 2 of 2) — implementation plan

> Pre-approved. Execute inline, task by task, no approval pauses.

**Goal:** GBB quotes become real end-to-end: tiers persist on the estimate, the customer
sees a three-option picker on the public page and their chosen tier is recorded at accept,
the AI can draft all three tiers, and the composer's GBB format saves/previews/sends
faithfully. Terms return as a snapshot on the estimate.

**Context:** PR #60 rebuilt the composer: format toggle single↔GBB, three editable tier
panels in client state (`GBBDraft { rec, opts: GBBTier[3] }` in composer-state.ts), send
currently flattens to the recommended tier's lines only, with honest copy saying so. The
public page has an optional-add-on picker (QuoteLines island + `selectedLineIds` ID-subset
accept — the security model to mirror). Settings' `job_terms` table exists (Phase 2).
Money: cents in DB/domain, dollars in store. Migrations single-writer; latest is 0061.

## Architecture decisions (binding)

- **Tier model:** `estimate_lines.tier` nullable text CHECK ('good','better','best');
  `estimates.recommended_tier` nullable text (same CHECK), `estimates.accepted_tier`
  nullable text (same CHECK), `estimates.tier_names` jsonb nullable
  (`{good: string, better: string, best: string}` — display names), `estimates.terms_snapshot`
  text nullable. An estimate is GBB iff `recommended_tier IS NOT NULL`; then EVERY line
  must carry a tier tag (domain-validated). Single quotes keep all-null tiers.
- **Money semantics:** for a GBB estimate, subtotal/total/deposit derive from the
  RECOMMENDED tier's lines pre-accept, and from the ACCEPTED tier post-accept. Implement
  in the domain as `linesForTier(tier)` + existing math over that subset (non-optional
  lines only, as today). The DTO totals reflect this (so pipeline/rails/modal display the
  right figure with zero client changes beyond what Task 6 does).
- **Accept semantics (mirrors the optional-add-on model):** the public accept POST takes
  `chosenTier` ('good'|'better'|'best', required when the estimate is GBB, rejected when
  it isn't) + optional `selectedLineIds` (uuid subset validated against the CHOSEN tier's
  optional lines; stored lines only — client never authors content). Server builds the
  committed line set = chosen tier's fixed lines + selected optionals flipped non-optional,
  REPLACES the estimate's lines via the existing `withLinesForAccept`, clears tier tags on
  the committed lines (the accepted estimate is a resolved single quote), stamps
  `accepted_tier`. Office accept (v1.quoting.accept) gets the same optional `chosenTier`,
  defaulting to the recommended tier for GBB estimates.
- **AI tiers:** extend `modules/ai` with a tiered draft: same one-shot forced-tool pattern
  as draftEstimate but the tool schema returns three tiers (each 2..6 lines + a one-line
  note) + a recommended key. New procedure `v1.ai.draftEstimateTiers` (don't overload the
  existing one). System prompt: field-service estimator producing Good (fix it), Better
  (fix + prevent), Best (replace/upgrade) — whole-USD prices, same constraints as the
  existing prompt.
- **Terms:** composer's Message card gets the Terms select back, reading REAL
  `job_terms` from the settings store (SettingsHydrator already carries them — verify the
  slice field name). Selected terms' TEXT is snapshotted into `terms_snapshot` on draft
  (payload field), rendered on the public quote page under the lines, and shown read-only
  in the estimate modal. No live reference — snapshot semantics (later term edits don't
  rewrite sent quotes).
- Tenant safety unchanged: no new tables → no new RLS. All new columns ride existing
  estimates/estimate_lines policies. Public route stays ID-subset only.
- **Back-compat:** existing single-quote flows byte-identical when tier fields are null.
  Old sent GBB-style quotes don't exist server-side (GBB was client-only) — no data
  migration needed.

## Tasks

### Task 1 — schema + migration + domain
- Schema: the 5 columns above (estimates ×4, estimate_lines ×1) with CHECKs.
  `npm run db:generate` (expect 0062; verify only migration+journal+snapshot changed),
  then `npm run db:migrate` (authorized), verify exit 0.
- Domain (modules/quoting/domain/estimate.ts + estimate-line): tier on EstimateLineProps
  (validated enum|null); recommendedTier/acceptedTier/tierNames/termsSnapshot on
  EstimateProps; invariants in Estimate.create: GBB ⇒ every line tiered + all three tiers
  non-empty is NOT required (a tier may be empty while drafting) but recommended tier must
  have ≥1 line at SEND (extend canSend/send validation); single ⇒ no line tiered.
  `linesForTier`, money math derives from recommended/accepted tier per the decision above.
  `accept(now, chosenTier?)`: GBB requires chosenTier, stamps acceptedTier; non-GBB rejects
  a chosenTier. TDD throughout.
- Repository/mapper: persist + read the new columns (remember BOTH the insert values and
  the onConflictDoUpdate set list — the change-request columns were missed there once).
- Commit: `feat(quoting): tiered estimates — schema (0062) + domain tier model`

### Task 2 — API/DTO + public accept
- draft input (v1.quoting.draft): optional `recommendedTier`, `tierNames`, `termsSnapshot`,
  per-line optional `tier`. Zod CHECK-mirroring enums; reject inconsistent payloads
  (tiered lines without recommendedTier etc.) at the boundary.
- DTOs (full + summary): carry recommendedTier/acceptedTier/tierNames/termsSnapshot; line
  DTO carries tier. Totals per the money decision (domain already does it).
- Office accept: optional chosenTier as decided. Public route POST accept: `chosenTier`
  + `selectedLineIds` scoped to that tier; validation errors → 400 with functional copy;
  the not_ready/idempotent classification from the last review stays intact.
- Public GET (getPublicQuote view + route GET payload): tier structure for the picker —
  per tier: display name, note?, fixed lines (desc/qty/rate), optional lines, total cents.
  NO costs (existing redaction pattern).
- Int tests: GBB draft→send→public accept with chosenTier + an optional → committed lines
  = chosen tier's, acceptedTier recorded, totals right; single-quote accept with
  chosenTier → 400; GBB accept without chosenTier → 400.
- Commit: `feat(quoting): tiered draft/accept API — customer's tier choice recorded`

### Task 3 — public page tier picker
- app/(public)/q/[token]: when the quote is GBB, render a three-option picker ABOVE the
  line detail: three in-flow cards (name, note, total; recommended highlighted + labeled
  "Recommended"), tap to select. The selected tier's lines render below (fixed + optional
  toggles — reuse QuoteLines mechanics, totals recompute per tier + optionals). Approve
  button shows the selected tier's total and POSTs chosenTier + selectedLineIds. Default
  selection = recommended tier. Single quotes render exactly as today.
- Terms: render `termsSnapshot` text (when present) under the lines for BOTH formats,
  plain functional block ("Terms").
- Mobile-first check (the picker is a phone surface): cards stack, tap targets ≥44px.
- Screenshot-verify: GBB picker (3 cards), tier switch recomputes totals, terms block,
  single-quote unchanged. Playwright + dev server per CLAUDE.md (E2E creds, /tmp/tqshot).
- Commit: `feat(quoting): customers pick Good/Better/Best on the public quote page`

### Task 4 — AI tiered draft
- modules/ai: `draftEstimateTiers` use-case + procedure per the architecture decision
  (one-shot forced tool call, 3 tiers × 2-6 lines + note + recommended key, schema caps,
  text-fallback parser like draftEstimate, same error mapping incl. PRECONDITION_FAILED
  when unconfigured).
- Unit tests with a fake LLM client (existing pattern in draft-estimate.test.ts).
- Commit: `feat(ai): tiered Good/Better/Best draft`

### Task 5 — composer wiring
- GBB format: buildDraftPayload emits tiered lines + recommendedTier + tierNames (+
  termsSnapshot both formats). Save draft / Preview / Send all carry the FULL three-tier
  structure now (kill the "flattens to recommended" behavior + the "customer receives the
  recommended option only" honesty line — replace with "Customers pick one of the three
  options on their quote page."). Send button copy: `Send quote — 3 options`.
- Draft with AI in GBB format calls draftEstimateTiers and fills ALL THREE panels +
  star per the AI's recommended key (single format keeps the existing endpoint). The
  suggest-from-Good heuristic button stays as the offline path.
- Message card: Terms select returns, listing real job_terms from the settings store;
  selection snapshots the text into the payload. "None" = no snapshot.
- Estimate modal + rails: GBB estimates show a small tier line ("3 options · recommended
  Better" pre-accept / "Accepted: Best" post-accept). Totals come from the DTO (already
  right). Store Estimate type + dto-mapper carry the new fields (dollars conversion for
  any tier totals surfaced).
- Editing/reopening a GBB draft from the pipeline: the composer must be able to LOAD a
  persisted GBB draft back into the tier panels (?estId= or however drafts reopen today —
  verify; if drafts don't reopen into the composer today, note it and skip).
- Screenshot-verify composer GBB save→send + modal display.
- Commit: `feat(composer): GBB quotes persist and send all three options`

### Task 6 — full gate + polish
- Unit + int + coverage(80/75) + lint + tsc + build. Update any tests pinned to the old
  "recommended only" copy. Extend the estimate-router int capstone: GBB full lifecycle.
- Commit: `test(quoting): GBB end-to-end coverage`

## Post-conditions
- A GBB quote round-trips: compose 3 tiers → save/reopen → send → customer picks a tier +
  optionals → accept records tier → job auto-created from the accepted (resolved) lines →
  invoice math unchanged.
- Single quotes: zero behavior change.
- No fake-AI copy anywhere; the composer's honesty line is replaced by the real promise.
