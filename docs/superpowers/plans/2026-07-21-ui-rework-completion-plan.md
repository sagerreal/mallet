# UI Rework — Completion Plan (to a verified 10/10)

**Goal:** every one of Owen's 11 UI rules holds across the ENTIRE app, each proven by a
machine check wherever a machine can check it, and locked so it cannot drift back.
This document is written for a fresh session to execute without re-deriving anything.

**Read first:** `~/.claude/projects/.../memory/ui-rework-plan.md` (session memory),
`e2e/helpers/ui.ts` (harness), and the PR ledger below. Work in a git worktree on a
fresh branch off `origin/main` per PR. **NEVER stack PRs** (a stacked PR merged after
its base silently strands off main — happened once). Owen merges within minutes:
check `gh pr view N -q .state` before any push to an existing branch. This rework
wants **exclusive ownership of the UI layer** while running — check `gh pr list`
for other open UI branches before starting a batch.

---

## Ledger — shipped so far (PRs #144–#152, all merged)

| Phase | PR | What landed |
|---|---|---|
| P0 safety net | #144 | 76 visual baselines (26 routes × light/dark, 15 × mobile), axe scan + baseline, keyboard specs, Date-freeze harness |
| P1 defects | #145 | 69 silent write-failures now report (`lib/store/write-error.ts` + `WriteErrorToast`); `LoadFailed` on all 8 list surfaces; `--ink-3` contrast; global `:focus-visible`; modal `role="dialog"` + focus trap (22 inherit); dup `.pill.blue`; Charge confirm/cancel |
| P2a tokens | #146 | `--space-*`, `--type-*` (named `--type-*` NOT `--text-*` — Tailwind v4 owns that namespace), `--radius-*`, `--control-h-*`, `--shadow-focus`; 357 exact-match CSS tokenizations; stylelint (warn) |
| P2b snap | #147 | 495 off-scale CSS values snapped (ties round UP); surface contrast: light page/card separation 2.6%→14.8% (`--bg #EFEAE0`, `--card #FDFCF9`); stylelint CSS drift 623→0 for the allow-listed props |
| P3a primitives | #148 | `components/ui/*` rewritten onto prototype classes (Button/Card/Badge/Field/Input/Select/PageHeader/Sheet + new Row); deleted unused data-table/empty-state; `.field input` selector gained `type=password/search/url` (real bug) |
| P3b bridge | #149 | 6 simple files ported off Tailwind color utils; `globals.css @theme` 16→6 mappings (rest orphaned) |
| P4a inline tokens | #150 | 576 exact-on-scale inline values → tokens across 86 files (codemod; radius map bug caught: `--radius-sm` is 9px not 8) |
| P4b nested-interactive | #151 | all 32 row-in-button nodes fixed (`.rowopen` pattern); a11y 14→10; money-mobile font-swap flake KILLED via `settle()` scroll-prime; tasks date input masked |
| P4c a11y zero | #152 | axe **0 violations / 25 routes**; `A11Y_MAX` default **0 (enforcing)**; select labels, `<th aria-sort>` restructure, 5 contrast darkenings (`--jink3`, `--amber/--jamber #8A5A00`, eyebrow, auth foot, `.cnt`) |
| P4d/1 modal net | #154 | `e2e/visual-modals.spec.ts` — 9 dialog panels driven via dev-only `window.__appStore.openModal(id, params)`; reads seeded ids from the hydrated store (modals were NOT in the route net — the modal-heavy snap below is now verifiable) |
| P4d/2a CSS snap | #156 | `prototype.css` padding/margin snapped to `--space-*` (ties round UP); stylelint `declaration-property-value-allowed-list` extended to padding/margin (0/auto/negatives/calc/env legal); CSS drift 0 |
| P4d/2b inline snap | #157 | 1,022 raw-px inline-style values → `--space-*`/`--type-*`/`--radius-*` across 91 tsx files (single-value only; `--space-*` shorthands per-value; asymmetric radius/`50%`/`em` left intact by design); 65 visual baselines re-generated; codemod greedy-quote bug caught+fixed (mangled shorthands/percents) |
| P4d/2b hotfix | #158 | `borderRadius: 999` pill/circle sentinel wrongly snapped to `--radius-xl` (flattened 46×46 avatar circles to rounded-squares) → mapped to `--radius-pill`; 12 sites / 8 files |
| P4e/1 import chrome | #159 | extracted shared `import-shared.tsx` (ImportPill, CsvDropzone, ImportingLine, ImportDoneCard, IMPORT_SELECT_STYLE) — ~100 byte-identical lines each removed from the 2 import modals; pure no-op (net 0-diff) |
| P4e/2 compact input | #160 | 4 duplicate `COMPACT_INPUT`/`INPUT` style constants → one in `components/ui/input.tsx`; kept inline (not a class) to preserve the `.field input` override specificity; no-op |
| P4f/1 detail pages | #161 | ported `money/[id]` + `jobs/[id]` + `job-actions` off Tailwind → prototype tokens + new `.stack-*` vertical-rhythm utility; extended `visual-modals` net to baseline the 2 dynamic detail routes (were unbaselined); Tailwind still installed (P4f/2 deletes it) |
| P4f/2 delete Tailwind | (open) | ported the last 8 light files (auth ×3, error ×2, record-payment-sheet, sign-out-button, new-customer-modal) off Tailwind utilities; removed `@import "tailwindcss"` + `@theme` from globals.css, deleted `postcss.config.mjs` + both tailwind deps. **THIRD STYLING SYSTEM GONE.** Preflight removal made prototype.css self-sufficient (body `line-height:1.5` + `var(--font-*)` on font tokens); residual sub-pixel text-metric shift re-baselined the net (82/87 shots) — Owen-approved app-wide change (`text-sm` 14px→`--type-sm` 12px etc. aren't 1:1) |

**Current scores:** a11y ~9 (automated-clean, locked) · states ~8 · tokens ~7 ·
DRY ~5 · consistency ~5 · disclosure 4.

---

## The rules → what still closes each

| Rule | Status | Closed by |
|---|---|---|
| No magic numbers → tokens | **DONE** (P4d): CSS font-size/radius/gap/shadow/padding/margin all tokenized + stylelint-guarded (#146/#147/#156); inline off-scale values snapped app-wide (#150/#157). Residual: 5 template-`<style>` CSS blocks in 2 public token pages + 1 optical `gap:3px` (both listed in #157) | ✓ #157 |
| DRY / component library | Primitives exist; adoption sweep not done (12 inline pill sites, ~150 ad-hoc CSS cards, 162 bare inputs, dup constants) | **P4e** |
| Single responsibility | Charge button fixed; remaining double-duty elements live in the IA surfaces | **P6** |
| Component contracts | Primitives have props; per-surface hacks remain until adoption | **P4e** |
| YAGNI / progressive disclosure (max 2 levels) | Untouched: Office ~119 controls, 3-level folds, modal→modal, field walls | **P6** |
| Error prevention | Hours picker etc. exist; audit found no new gaps | done |
| No silent failures / visibility of status | Failures surface; **success feedback still missing** (0 store mutations show "Saved") | **P5** |
| Graceful degradation (4 states) | first-run ✓ · load-failed ✓ · **loading gate on 1/8 surfaces only** | **P5** |
| Accessibility floor | axe 0 + enforcing; keyboard specs green | **P7** keeps it locked; human SR pass = Owen-owned (see caps) |
| Usability testing (5 users) | Not automatable | **Owen-owned** (see caps) |
| Document "why" | Not written | **P7** |

---

## P4d — finish the token sweep (2 PRs, mechanical + reviewed)

**Numbers (measured 2026-07-21):** 922 raw-px inline values remain across 87 tsx
files + 417 raw padding/margin declarations in `prototype.css`. Top offenders:
tech-job-modal (36), settings/page (32), setup-modals (29), job-modal (27),
invoice-modal (26), pricebook-pane (21), booking-service-card (21),
front-desk-pane (20), import-services-modal (20).

**PR 1 — harness extension first (modals are NOT in the visual net):** add
`e2e/visual-modals.spec.ts` shooting the key modals open (light only is fine):
new-customer, new-job, invoice, tech-job, estimate/quote, lead, job, close-out,
import-customers. Open via real UI actions as the E2E owner. Baseline them.
Without this, the modal-heavy snap below is unverifiable — do not skip.

**PR 2 — the snap:**
1. `prototype.css` padding/margin: snap to `--space-*` (nearest step, **ties round
   UP** — the established P2b precedent), then extend the stylelint
   `declaration-property-value-allowed-list` to `padding`/`margin` (and
   `padding-*/margin-*`), keeping `0` and `auto` legal. Drift must read 0 after.
2. Inline tsx values: same nearest-step snap via codemod, batched by directory
   (components/modals → features → app), one commit per batch. Multi-value
   shorthands (`"12px 16px"`) snap per-component-value.
3. **Off-scale ≠ on-scale:** this MOVES pixels. Verify each batch against the
   visual net (routes) + the new modal baselines; screenshot-review the biggest
   diffs by eye. Re-baseline deliberately per batch, never blanket `--update`.
4. Do NOT extend the scale for stragglers unless a value has ≥15 uses (P2b
   precedent). One-off odd values just snap.

**Acceptance:** `grep -rhoE "(padding|margin|fontSize|gap|borderRadius):\s*\"?[0-9]+"
app features components | grep -v "var(--"` returns ~0 (a handful of justified
literals like `1px` borders may remain — must be < 20 and listed in the PR);
stylelint 0 with the extended allowlist.

## P4e — primitive adoption + custom lint (2–3 PRs)

1. **Pills:** the 12 inline `borderRadius:999` sites → `Badge` or `SoftPill`
   (match existing tone). Do NOT flatten deliberately-distinct designs (`.jst`
   jobs status pills, `stage-pill` dots are different treatments — keep them,
   they're systematized already).
2. **Inputs/fields:** wrap bare `<input>/<select>/<textarea>` (≈162 of 181) in the
   `Field` primitive or the `.field` container class so the descendant rules
   style them; delete the 4 duplicate `COMPACT_INPUT` constants and the 6
   near-identical `inputStyle` objects (audit finding).
3. **Cards:** the 31 inline border+radius+background divs → `<Card>`; collapse
   obviously-identical ad-hoc CSS card rules onto `.card` where byte-similar
   (do not chase all 157 CSS variants — collapse the true duplicates, leave
   deliberate variants).
4. **Import modals:** extract the shared shell + `Pill` duplicated verbatim
   between import-customers and import-services (~90 shared lines).
5. **Custom ESLint rules (land in WARN):** `no-raw-style` (numeric px in style
   props → error, only `var(--…)`), `no-adhoc-card` (border+borderRadius+
   background triple in one style object), `no-bare-field` (raw input outside
   Field/.field). Implement as a local flat-config plugin in `eslint-rules/`.
   These flip to error in P7.

**Acceptance:** rule warn-counts published in the PR body; visual net green;
unit suite green (update tests that assert on old markup).

## P4f — kill the third system (1 PR)

Port `app/(office)/money/[id]/page.tsx` + `app/(office)/jobs/[id]/page.tsx` off
Tailwind utilities onto prototype classes/tokens (they're the last users of the
`@theme` bridge). Then: delete the `@theme` block AND `@import "tailwindcss"`
from `globals.css` (KEEP the view-transition rules + body overrides), delete
`tailwindcss` + `@tailwindcss/postcss` from package.json + postcss config, and
port the remaining bare utility classes (`text-sm`, `space-y-*`, `flex gap-*`)
in the 8 previously-ported files to prototype equivalents (they silently stop
working the moment Tailwind is gone — grep `className="[^"]*(text-|space-y|flex|
gap-|w-full|mt-|mb-|px-|py-)` and clear every hit).
**These two pages have no visual baselines** (dynamic routes): extend
`e2e/visual-modals.spec.ts` to navigate into one seeded job + one seeded invoice
detail (create via UI in the spec if the E2E org lacks them) and baseline BEFORE
porting. Acceptance: `pnpm build` green with tailwind uninstalled; grep for
Tailwind class names in tsx returns 0.

## P5 — the state matrix (1 PR)

1. `isFirstLoad` loading gate rolled out to the 7 remaining list surfaces
   (Customers, Pipeline, Tasks, Schedule, Timesheets, Checklists, Money — Jobs
   has it). Render the quiet `Loading…` line (jobs-home pattern, `aria-busy`).
2. **Success feedback:** extract the settings "Saved ✓ + 2s timeout" pattern into
   `useSaveFlash`; wire the 3 job actions that return `{ok}` but are ignored at
   4 call sites (audit: job-checklist-block pattern for the error side).
   Store-write success stays quiet by design (optimistic UI is the feedback);
   EXPLICIT save buttons get the flash.
3. **State-matrix test per surface:** a shared test helper asserting all four
   states render (first-run / loading / load-failed / populated) driven by the
   mocked query flags — copy customers-view.test.tsx's harness.

**Acceptance:** all 8 surfaces × 4 states have a passing test; no cold-load flash
(manually verify one reload per surface via screenshot).

## P6 — IA / disclosure (6 passes, EACH NEEDS OWEN)

Protocol per surface: **mockups first** (2–3 options, rendered, his visual-first
rule), his pick, then build with the primitives. Budgets enforced by a new
`e2e/control-budget.spec.ts` (counts focusable controls per route; ceiling table
committed with Owen's sign-off per page). Order:

1. **tech-job-modal** (1,561 lines, ~30 controls): split into timer/work view vs
   close-out view; both under 800 lines.
2. **new-job-modal / new-customer-modal** (7- and 6-field walls): list-first
   accordion (the Front Desk RuleRow pattern).
3. **invoice-modal** (~25 controls): stage it by intent (see mallet-getpaid memory).
4. **Pricebook pane** 3-level nesting: materials become a column of the expanded
   service row, not a nested reveal.
5. **Office page** (~119 controls across 4 tabs): lazy-mount panes; per-tab budget.
6. **Modal→modal back-stack** in the ui-slice (8 modals destroy their parent
   today) — or route those flows to pages; Owen picks.

Also P6-owned: the intentional mobile `.pagehead display:none` (SectionTabs
replace headers on mobile) — decide keep vs unified PageHeader-with-mobile-rules,
then delete the blanket hide either way.

## P7 — lock + document (1 PR)

1. Flip stylelint `defaultSeverity` warning→error; flip the three custom ESLint
   rules + `eslint-plugin-jsx-a11y` (strict) to error. `pnpm lint` / `lint:css`
   must exit non-zero on violations.
2. CI: unit + tsc + lint + stylelint + axe (`A11Y_MAX=0` already) + keyboard on
   every PR. **Visual regression stays a local pre-merge gate** — baselines are
   `-darwin` and a Linux CI would regenerate everything; do NOT try to run
   pixel-diffs in CI without committing linux baselines (separate decision).
3. `docs/design-system.md`: tokens (with the why), the primitives + when/when-not,
   the `.rowopen` pattern, the state matrix, the harness (scroll-prime,
   data-dynamic, Date freeze), and the 11 rules mapped to their enforcement.
4. Update `CLAUDE.md`: "compose primitives, never hand-roll; run `test:visual`
   before any UI PR; screenshot-verify."

**Acceptance:** a PR introducing `fontSize: 13` or a bare `<input>` fails CI.

---

## Honest caps (state these to Owen at the end, not as fine print)

- **Accessibility = verified-9, not certified-10**, until a human runs a screen
  reader through the 6 core flows. Everything automatable is automated + locked.
- **Usability testing (rule 11)** requires watching ~5 real shop owners — cannot
  be done by a model. The instrumentation (task success paths) can be prepared.
- **The 0–10 scores are our own audit instrument** (evidence-based, reproducible
  via the audit workflow), not an external certification.

## Harness knowledge the next cycle must not re-learn

- `e2e/helpers/ui.ts`: `prepare()` freezes browser `Date` + pins theme BEFORE app
  boot; `settle()` scroll-primes full-page shots (font-swap determinism). SSR
  wall-clock values (greeting, native date inputs) can't be frozen → tag
  `data-dynamic` (masked).
- Playwright `test.fail()` goes INSIDE the test body; `maxDiffPixels:150`
  absolute (ratios scale with page height and hid a real change once).
- Colour-only text changes slip under any pixel budget → contrast is axe's job.
- E2E creds: `owner@e2e.mallet.test` / `tech@e2e.mallet.test` / `e2e-password-1`;
  dedicated `PORT=32xx pnpm dev`; delete throwaway specs + `git checkout --
  next-env.d.ts` before committing.
- Redirect-only routes never stabilize — keep them out of `e2e/helpers/routes.ts`.
- The E2E org is sparse; populated-state coverage comes from the modal/detail
  specs added in P4d/P4f.
