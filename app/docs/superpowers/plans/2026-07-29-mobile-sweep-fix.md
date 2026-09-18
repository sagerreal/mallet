# Mobile sweep fixes (Owen mandate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mobile surface renders correctly at 393px (no horizontal overflow, no overlapping/cut-off controls, sane creation modals), the new-job save bug is fixed with honest copy, a permanent overflow regression net exists, and the app's feel is re-measured (fixing only what measures bad).

**Architecture:** Pure UI + one client-validation fix — no schema, no migrations. Root defect classes found by a production-build 393px sweep of all routes+modals: (1) unwrapped flex header rows forcing document overflow (office tabs, settings-team); (2) the composer's line-item table not adapted for mobile; (3) creation-modal footers cramming 3 wrapping buttons; (4) the new-job modal's phone field failing server-side E.164 parse with connection-blame copy; (5) carousel/board surfaces with zero scroll affordance. Verified against screenshots in `scratchpad/mobile-sweep/` (controller holds them); each task brief embeds its own verified findings.

**Tech Stack:** unchanged. prototype.css + tokens only; compose primitives.

## Global Constraints

- **Verify against the screenshot before and after** — the prior mobile audit was wrong 9/13 times; every fix must be re-shot at 393px on the PRODUCTION build (port 3131 pattern) and eyeballed. `next dev` screenshots are inadmissible (dev-tools badge trap).
- **No horizontal document overflow at 393px on ANY route** — the new net (Task 1) is the law; every later task must keep it green.
- Tokens only; no floating UI; functional copy (errors name the problem + next step — never blame the connection for a validation failure).
- Sheet grammar for modals (ONE `.sheet-pri`, sticky foot); don't regress the #253/#254 conversions.
- The visual nets re-baseline deliberately per change, green ×2; the a11y net unblocks in Task 6 and must then pass.
- Perf: do NOT re-flag the killed leads (bootstrap query, react-dom chunk, tech-job decomposition, FieldTimer, closed-modal subscriptions). Feel fixes only for what the probe MEASURES as bad.
- No migrations in this plan (pure UI + client validation). Store/API contracts unchanged except error-message surfacing.

## Tasks

### Task 1: The overflow net + office pane headers + settings-team
**Files:** new `e2e/mobile-overflow.spec.ts` (E2E_VISUAL-gated like siblings: for EVERY office route/tab + field route at 393px, assert `document.documentElement.scrollWidth <= window.innerWidth` — the permanent net); `features/jobs/checklists-panel.tsx` (the verified pattern: line 85's `display:flex; justifyContent:space-between` row with h2 + [input + 2 buttons], no wrap → document overflow; fix: wrap the controls row under the heading on narrow — `flexWrap:"wrap"`, input `flex:"1 1 100%"` order or a stacked layout; match how route-jobs' search+filters row does it correctly — READ that first); the pricebook pane + frontdesk pane equivalents (locate by grepping their search/button rows — same class); the settings-team overflow (810px vs 786 — find the offending fixed-width row: role dropdown + 2 toggles; likely a minWidth or non-shrinking flex child).
**Verified findings to fix:** dashboard-checklists (heading overlaps search, "Starter checklist" button cut, page scrolls sideways), dashboard-pricebook (same class + clipped custom-service input pair), dashboard-frontdesk (same class; "Checklists 6" tab sliced on all three), settings-team (slight overflow, "More" tab label clipped).
**Steps:** write the net first (it must FAIL on the three broken tabs — that's the red); fix; net green for ALL routes; re-shoot the four surfaces; commit.

### Task 2: Composer mobile
**Files:** `app/(office)/composer/page.tsx` (+ its CSS classes in prototype.css).
**Verified findings:** DESCRIPTION/QTY header text overlap (BROKEN); line-row action buttons ("Show your work" clipped, row wider than card — BROKEN); qty stepper renders an empty bordered box; "Customer" + AI-prompt placeholders hard-clipped; bottom action row (Preview/Save draft/Send quote + helper) crams four wrapping text blocks.
**Fix shape:** a mobile layout for the line table (stack description over qty×rate=amount per row, or a two-line grid — match the invoice modal's mobile line treatment if one exists — READ it); footer becomes the sheet-style single-row with the primary full-width and secondaries above/below; placeholders shortened to fit (functional copy). Verify by re-shot.
**Steps:** red (shot) → fix → overflow net green → re-shot → commit.

### Task 3: Creation modals — the new-job bug + footers
**Files:** `components/modals/new-job-modal.tsx`, `components/modals/new-customer-modal.tsx` (+ shared phone helper).
**Verified findings:** (a) FUNCTIONAL: typing an invalid phone (e.g. 8-digit "78138501") fails the server's E.164 Phone parse → BAD_REQUEST → the modal's catch (lines 257-259, 331-333) shows "Couldn't save the customer — check your connection and try again." — wrong twice (not a connection problem; the message discards the server's named reason). Fix: client-side phone validation BEFORE submit using the same rule the server applies (find how new-customer modal or the messaging module normalizes/validates US phone — reuse, don't invent), inline error naming the field ("That phone number isn't valid — use a 10-digit US number."), AND the catch surfaces the server error's message when present instead of the connection line (connection copy only for genuine network failures — inspect the error shape). (b) LAYOUT: the footer's three buttons (Cancel / Build the price / Create job) cram and wrap at 393px (Owen's screenshot: "Build the price" wrapped to 3 lines). Fix per sheet grammar: Create job = `.sheet-pri` full-width in the sticky foot with Cancel + Build-the-price as quiet secondaries in a row above it (or the pattern #254 used for multi-action sheet foots — READ new-customer's current foot and the sheet-foot conventions first). Also action any new-customer/new-job findings from the modal triage carried in the brief.
**Steps:** unit tests for the validation + copy paths (mock the reject shapes) → fix → re-shot both modals → commit.

### Task 4: Schedule + carousels
**Files:** the schedule board component (`features/…schedule…` — locate), pipeline page.
**Verified findings:** schedule toolbar wraps ragged (Day/Week + Prev + Today one row, "Next" orphaned below); "To schedule" carousel and pipeline's lead columns clip the next card with ZERO scroll affordance; the crew×hours board shows 3 hour columns with no hint it pans.
**Fix shape:** toolbar → one grammar: Day/Week segmented left, Prev·Today·Next as one compact group right, wrapping as WHOLE groups; carousels get a peek treatment (next card visibly half-in, e.g. scroll-padding + calc widths) — no dots/arrows (not the house style), a clean 24px peek is enough; the board gets `overflow-x:auto` with a subtle edge fade or the hour header itself scrolling visibly. Keep the board's desktop behavior untouched (≤760px media queries).
**Steps:** red shots → fix → net green → re-shots → commit.

### Task 5: The BAD list
**Files:** money page (ready-to-bill card 3-way squeeze — stack the helper line under the label/value), tasks page (add-task row: input full-width, date+add on a second line), frontdesk pane (the "Answering" toggle shows ON while copy says the number isn't live — bind the toggle's disabled/off state to the provisioning status; VERIFY the actual state model first, the toggle may be genuinely on with answering pending — if so fix the COPY not the control), plus any carried modal-triage BADs.
**Steps:** per-surface red→fix→shot; overflow net green; commit.

### Task 6: A11y gate unblock + run
**Files:** `app/prototype.css` `.okghost`.
**The solved fix from the prior campaign (verified then):** `color-mix(… 62%, …)` → **66%** giving `#706B62` on `#F7F0E1` = 4.66:1 (≥4.5). Apply, then run the a11y net (`ALLOW_VIOLATIONS=0`, full — it previously aborted at route 4 blocking 22 routes; a filtered run truncates `e2e/.a11y-baseline.json`, restore if touched). Fix any NEW violations the unblocked routes reveal (triage severity — contrast/labels are in scope; deep refactors get ledgered).
**Steps:** fix → full a11y run → address/ledger → commit.

### Task 7: Feel re-measure (fix only what measures bad)
**Probe (controller may run):** Playwright, PRODUCTION build, 4x CPU throttle, ×20 iterations: (a) office bottom-tab nav click→content p50/p95; (b) job-modal open from jobs list; (c) dashboard tab switch (Today→Pricebook); (d) tech my-day tab switch. Reference: prior recorded office nav p50 55ms, field tab p50 65ms, press 0ms.
**Then:** if any flow p50 regressed >2x the recorded baseline, trace it (React Profiler commit counts; the usual suspects are NEW code since Jul 17: sheet-grammar modals, measurements hydration, dropdowns, signature snapshots) and fix the measured cause. If probes match baseline, the "glitchy" feel is on the NEW surfaces' missing press-states/skeletons — sweep the post-Jul-17 additions (measurements block, room card, dropdown, Priced-by control) for `:active` press states + skeleton coverage per the FEEL KIT conventions and add what's missing.
**Steps:** measure → report numbers in the ledger → fix measured causes only → re-measure → commit.

### Task 8: Gate + PR
Full gate (tsc/lint/lint:css/unit/int/coverage/build), visual nets re-baselined deliberately + green ×2, **the new overflow net green**, a11y net green, fresh 393px shots of every fixed surface (before/after pairs for the PR), PR titled `fix(mobile): the 393px sweep — overflow, creation modals, composer, schedule, feel`. Body: the defect ledger with before/after shots, the net that prevents recurrence, feel numbers.

## Self-review notes
- Every finding embedded above was verified against a production screenshot or code read this session; triage items that failed verification (jobs-checklists "routing bug" = deliberate redirect) were struck.
- No migrations → no single-writer coordination needed.
- The overflow net is the deliverable that outlives the fixes.
