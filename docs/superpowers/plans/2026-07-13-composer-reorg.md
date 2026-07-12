# Composer reorganization (PR 1 of 2) — implementation plan

> Pre-approved. Execute inline, task by task, no approval pauses. Real GBB backend
> (tiers in schema, customer tier picker, tiered AI) is PR 2 — NOT this branch.

**Goal:** Reorganize `app/(office)/composer/page.tsx` (1906 lines) so the page reads
top-to-bottom as: Customer → The quote (format toggle + line editor + authoring tools) →
Pricing → Message → Send. Kill the false choices (GBB tile pretending to be a mode when
AI/manual are authoring TOOLS), the fake-AI copy, the dead ends, and the silent no-ops.

**Why (verified findings, file:line refs are pre-drift):**
- The 3 start tiles conflate authoring method (AI vs hand) with quote format (single vs
  GBB). Manual GBB is impossible; "Draft with AI" is real AI while GBB is regex templates
  (`jobTypeOf` page.tsx:53, seeds :84-196) with FAKE copy ("⚠ marks the lines the AI is
  least sure of" :604-610).
- "Send all 3" sends ONE estimate (recommended tier's lines only); customer never sees a
  tier picker; "★ Recommend this" doesn't reload `cs.lines` so the sent lines can diverge
  from the star.
- "Message & terms" (intro textarea, Terms select, valid days) is collect-only: intro and
  terms are NEVER included in `buildDraftPayload` (:1651) or the send bodies (:1689-1722).
  (`validDays` — verify: wire it if it's also dropped.)
- The Delivery card renders BETWEEN two bare-text disclosure headers ("Pricing options",
  "Message & terms") → reads as nested. Sections render even in the empty chooser state.
  Save/Send silently return with no lead or no real line.
- Dead: TEMPLATES seed + tmplOpen (never rendered), custMatches (written never read),
  Dictate mic no-ops, "Save to book" chip no-op (leave the known punch-list items Dictate/
  Save-to-book alone — they're tracked; DELETE the truly dead code: TEMPLATES, tmplOpen,
  custMatches).
- One-way doors: `manualStarted` sticky (can never re-reach the chooser), no back link
  from gbb-prompt, no route back into GBB after "use a single quote instead".

## Global constraints

- Owen's rules: NO floating UI (in-flow reveals only); functional copy; no dead buttons
  (wire it or delete it); prototype-faithful styling (reuse existing .card/.reveal/.chip/
  .btn classes and the page's existing CSS in app/prototype.css — this is a REORGANIZATION,
  not a restyle); money in dollars in the store, cents at the API boundary (existing
  helpers); org from principal (no backend auth changes here).
- File organization: composer/page.tsx is way over the 800-line cap. Extract the new
  sections as sibling components under `app/(office)/composer/` (e.g. `quote-card.tsx`,
  `gbb-tiers.tsx`, `pricing-card.tsx`, `message-card.tsx`, `send-card.tsx`,
  `composer-state.ts` for shared types/reducer helpers). Keep ComposerState in one place;
  pass state + updater props explicitly (no context unless the file count demands it).
- NO schema/migration changes in this PR. No changes to modules/quoting backend except
  none expected (send bodies are built client-side; verify intro can ride the existing
  messaging/notifications payloads — they take free-text bodies today).
- The existing single-quote send path (draft→send→deliver→adoptEstimate→stage bump→
  /pipeline) must keep working byte-for-byte at the API level: same endpoints, same
  payload shapes (+ the intro/validDays wiring below).
- Preview flow (persist real draft → mint token → open /q/<token>, dedupe per payload,
  archive on real send) is load-bearing — keep it working for both formats (GBB preview =
  recommended tier, labeled so).

## Target layout (top to bottom)

1. **Customer** — unchanged (CustomerSelector).
2. **The quote** — ONE `.card`:
   - Header row: title "The quote" + format toggle (two chips like the Text/Email toggle):
     `Single quote` | `Good, Better & Best`.
   - AUTHORING TOOLS row (always visible inside the card): `✦ Draft with AI` button
     (opens the existing in-flow describe panel) and `+ Add line` (single format) /
     per-tier add (GBB format). The three start tiles are DELETED. The empty state is the
     card with the tools row + one empty line row — no separate chooser gate, no
     `manualStarted` flag.
   - SINGLE format body: the existing line table + totals block + pricebook chips,
     unchanged behavior ("AI draft — edit freely" pill, Redraft with AI, optional/photo
     chips, Show your cost).
   - GBB format body: THREE tier panels stacked in-flow (Good/Better/Best), each with:
     tier name/title (editable), the SAME line-editor table (extract the table into a
     reusable component so single + tiers share it), a `★ Recommended` radio (exactly one
     tier), and per-tier totals. Manual GBB = type into the panels. "Suggest Better & Best
     from Good" button applies the existing gbbFor heuristics to the Good tier's lines —
     copy: "Starts Better & Best from Good — edit freely" (NOT labeled AI). `Draft with
     AI` in GBB format drafts into the GOOD tier (existing endpoint), copy says so.
   - Format switching (both directions, always available): single→GBB seeds Good with the
     current lines; GBB→single keeps the recommended tier's lines. In-flow one-line note
     when switching, no confirm dialogs. gbb-prompt and gbb-review MODES are DELETED
     (the ComposerMode union collapses; the deltabanner/review screen goes away — the
     tier panels ARE the review).
   - HONESTY: kill the "⚠ AI least sure" copy. Keep low-confidence ⚠ flags only if
     relabeled "double-check this line" where the heuristics set them. The GBB body
     carries one functional line: "For now the customer receives the recommended option
     only — tier picking for customers is coming." Send button in GBB format says
     `Send quote — <TierName> option`.
   - FIX: sending/previewing a GBB quote ALWAYS uses the recommended tier's lines at
     send time (derive from gbb state, not stale cs.lines).
3. **Pricing** — the discount/deposit/tax fields as a proper `.card` with a header
   ("Pricing — discount, deposit, tax"), not a bare reveal. Collapsible is fine if it
   uses a boxed card shell so nothing reads as sandwiched.
4. **Message** — `.card`: intro textarea + Price valid days. WIRE THEM: intro (or the
   auto-intro fallback) becomes the lead text of the SMS body / email body on send;
   validDays goes into buildDraftPayload if it isn't already. The Terms select: DELETE
   from this page (collect-only dead end; returns in PR 2 with a terms snapshot on the
   estimate). 
5. **Send** — `.card` at the bottom (the last act): Text/Email toggle + per-channel copy +
   editable destination (KEEP the persist-contact-edit behavior and the channel default
   by available contact info — this is Owen's explicit requirement: the email-or-phone
   choice stays), the Automatic follow-ups toggle moves INSIDE this card, then the action
   row: Preview · Save draft · Send quote.
   - Save/Send DISABLED with an inline reason ("Pick a customer first." / "Add at least
     one line.") instead of silent no-op. Preview same gating.
6. Delete dead code: TEMPLATES, tmplOpen, custMatches. Keep Dictate + Save to book
   untouched (tracked punch-list items).

## Tasks (sequential)

### Task 1 — extract shared pieces, no behavior change
Create `composer-state.ts` (types + INITIAL_STATE + pure helpers that move), extract the
line-editor table into `line-table.tsx` (props: lines, onChange, showCost, pricebook
chips slot), extract `pricing-card.tsx`, `message-card.tsx`, `send-card.tsx`,
`quote-card.tsx` shells. page.tsx orchestrates. VERIFY: tsc, unit suite, visual parity
(screenshot before/after if the dev loop is available — see CLAUDE.md worktree notes;
else note it). Commit: `refactor(composer): extract section components (no behavior change)`

### Task 2 — new layout + gating + wiring
Reorder sections per the target layout; move follow-ups into send-card; boxed Pricing/
Message cards; disable-with-reason on Preview/Save/Send; wire intro → send bodies and
validDays → payload (verify current state first); delete Terms select + TEMPLATES/
tmplOpen/custMatches. Commit: `refactor(composer): customer→quote→pricing→message→send flow, honest gating, wired message`

### Task 3 — format toggle + GBB rework
Delete gbb-prompt/gbb-review modes; build the GBB tier panels on the shared line table;
format switching with line carry-over; ★ Recommended radio; "Suggest Better & Best from
Good"; AI-drafts-Good in GBB; honest copy; send/preview derive lines from the recommended
tier at call time. Commit: `refactor(composer): format toggle — single ↔ Good/Better/Best with shared line editor`

### Task 4 — tests + gate
Unit tests: pure helpers (format-switch carry-over, recommended-tier line derivation,
disable-reason derivation, suggest-from-Good heuristics — extract as pure fns). Existing
composer-related tests updated. Full gate: tsc · lint · unit · test:int (quoting) ·
coverage 80/75 · build. Screenshot-verify the five sections + both formats if feasible.
Commit: `test(composer): cover format switching, tier derivation, send gating`

## Post-conditions
- Every control on the page either works or is a tracked punch-list item (Dictate,
  Save to book).
- No copy claims AI where none runs; no promise of customer tier picking.
- Send still supports Text and Email with editable destination.
- PR body flags PR 2 scope: backend tiers, customer tier picker, tiered AI draft,
  terms on the estimate.
