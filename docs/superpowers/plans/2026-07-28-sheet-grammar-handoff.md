# Sheet grammar rollout — handoff

Two prior sessions got cut off by Claude session limits mid-rollout (once around 12:50am,
once around 2am America/Los_Angeles). This doc is the exact resume point. Read it before
touching any modal.

---

## What this project is

Owen: *"Inspect all other modals on mobile and give them the same treatment you just did
for the customer one."* PR #253 (`feat/modal-sheet-redesign`, merged) redesigned the
customer/lead modal into a mobile bottom-sheet grammar — sticky header, sticky footer with
ONE filled primary action, quiet secondary/destructive actions. This project applies that
same grammar to the other 21 modals in the app.

**The exemplar to copy — read these three files first, every time, in every session:**
- `components/modals/lead-modal/lead-modal.tsx` — the reference conversion
- `components/modals/lead-modal/lead-header.tsx` — the sticky-header pattern
- `components/modals/sheet-row.tsx` — the quiet row / in-flow accordion primitive

**The CSS classes already exist in `app/prototype.css` from #253 — do NOT edit that file
for this project:**
- `.sheet-head` — sticky header, FIRST child of the modal body. An `<h2>` title +
  optional `.sheet-meta` line (pill · small facts).
- `.sheet-foot` — sticky footer, LAST child. Exactly ONE `.sheet-pri` (the filled
  primary — the single terminal/confirm action), optionally quiet secondaries
  (`.btn` / `.btn ghost`) beside it. **Skip the foot entirely** if the modal has no
  single terminal action — never invent one, never promote a destructive one into it.
- `.sheet-secrow` > `.sheet-sec` — a row of 2-4 equal-weight quiet peer actions under
  the header.
- `SheetRow` (`import { SheetRow } from "./sheet-row"` or `"../sheet-row"`) — quiet
  52px label/value rows, expandable for in-flow accordion sections.
- `.sheet-worklab` + `.sheet-workrow` — uppercase section label + record rows (see
  `QuoteRows` in the lead-modal exemplar).

**Hard rules (copy these into every agent prompt verbatim — they are what kept the first
11 conversions clean):**
1. Edit ONLY the modal file(s) you were assigned. Never `prototype.css`, never
   `modal.tsx` (the shell), never another modal's file.
2. Keep EVERY capability — every handler, field, action, state. Re-house, don't remove.
   No data-model changes.
3. `Modal` (the shell) already renders the ✕. Don't add one; delete any duplicate close
   button a modal body renders itself.
4. Exactly one `.sheet-pri` per modal, and it must be non-destructive. Delete/Void/
   Archive stay quiet (`.btn ghost`, red text) and never go in the primary slot.
5. Keep exports and component names unchanged — `modal-host.tsx` imports them by name.
6. Copy register: functional, formal trade vocabulary, no chattiness, sentence case.
   Empty states say **"Add"**, never a bare dash — a dash reads as broken data.
7. Inline styles: tokens only (`var(--…)`). `pnpm lint` fails on raw px in style props
   (a bare number like `minHeight: 44` for a hit target is fine; colors/spacing must be
   tokens).
8. Label/control associations must survive —
   `components/ui/label-association.test.ts` fails on any bare sibling `<label>`. Use
   the `Field` / `useFieldId` / `useGroupLabel` primitives in `@/components/ui/input`.
9. Don't run the full test suite or build inside a conversion agent (the orchestrator
   runs the gate) — but DO re-read your own edited file before returning, to catch
   unbalanced JSX / missing imports.

---

## Current state (as of commit `a83811a`, branch `feat/sheet-grammar-all-modals`)

```
git fetch origin
git checkout feat/sheet-grammar-all-modals   # already pushed, tracks origin
```

### Done — 11 of 21, committed, gate-clean

`call-modal.tsx` · `close-out-modal.tsx` · `company-view-modal.tsx` · `evisit-modal.tsx` ·
`invoice-modal.tsx` · `new-customer-modal.tsx` · `new-job-modal.tsx` ·
`price-builder-modal.tsx` · `tech-quote-modal.tsx` · `thread-modal.tsx` ·
`visit-modal.tsx`

Verified before commit: `tsc --noEmit` clean · `pnpm lint` 0 errors (229 warnings, all
pre-existing) · `pnpm lint:css` 0 errors (183 warnings, all pre-existing, matches #253's
count) · `npx vitest run` 4196/4196 passing.

**NOT yet done for these 11: the visual nets.** Nobody has run
`e2e/visual-modals.spec.ts` or the production-build page net
(`e2e/visual.spec.ts`) against this branch. Do that before opening a PR — see
"Gate checklist" below. Expect the modal baselines to need a deliberate
`--update-snapshots` re-run (the shape of every converted modal changed on purpose);
the page net should be close to the 76/78 baseline from #253 (2 pre-existing
`money · mobile` failures are a known live-data flake, unrelated to this work).

Two things fixed opportunistically while converting, worth knowing about:
- `close-out-modal.tsx` had a **stray null byte** already in `origin/main` (predates
  this project — `git show HEAD:...` confirmed it, so it is not something this
  rollout introduced). It made `git diff` treat the file as binary. Stripped in this
  commit.
- `new-job-modal.tsx`'s Build-the-price button lost its decorative `✦ … →` per rule 6
  (copy register). `new-job-modal.test.tsx` asserted the old string and was updated
  to match — this is the one place a conversion needed a test fix; if a future
  conversion changes visible copy, grep for that string in `*.test.tsx` before
  calling the modal done.

### Not done — 10 of 21, reverted cleanly to `origin/main` (zero diff)

These were touched by agents that hit the Claude session-limit error mid-edit across
two orchestration attempts. Some left partial/inconsistent edits (one — `job-modal.tsx`
— left a dangling reference to a deleted helper, `initialsOf`, that failed `tsc`).
**All ten were reverted with `git checkout origin/main -- <path>` and are byte-identical
to origin/main right now.** Do not assume any prior partial work survives — it doesn't.

| file | tier | notes |
|---|---|---|
| `components/modals/job-modal.tsx` | **full** | Office job record. Title = job name `<h2>` in `.sheet-head` with JOB/type meta. Call/Text become `.sheet-secrow`. Sections (type, phone, job title, address, price, schedule, checklist) become SheetRows/accordions where label+value shaped; the schedule and checklist blocks can stay as-is inside accordions if converting their internals is risky. Footer: "Done" = `.sheet-pri`; "Delete job" stays quiet red beside it. |
| `components/modals/tech-job-modal/tech-job-modal.tsx` | **full** | **The field-tech surface — gloves, sunlight, the single most important mobile modal in the app.** Title `<h2>` + JOB meta in `.sheet-head`. Call/Text = `.sheet-secrow`. The single most likely next action (Send to the office to bill / Set a bill & take payment, or the Job-done flow) goes in `.sheet-foot` as `.sheet-pri`; peer actions stay as large in-body buttons (the existing `.tjpaid-btn` treatment is fine in-body, just not in the foot unless it's the one terminal action). Found-work/add-ons, visit status, notes become quiet sections. May touch other files inside `components/modals/tech-job-modal/` only (e.g. `done-block.tsx`, `tech-header.tsx` exist there) — nothing outside that folder. |
| `components/modals/estimate-modal.tsx` | **full** | Quote record (office). Title/num/status in `.sheet-head` (status pill in `.sheet-meta`). Line items stay as-is. The advance action (send/mark), if one exists, = `.sheet-pri`; "Delete quote" stays quiet red, never primary. |
| `components/modals/import-customers-modal.tsx` | frame | Import flow. `<h2>` in `.sheet-head`; the step-terminal action (Import N / Done) = `.sheet-pri` when present, else skip the foot. |
| `components/modals/import-services-modal.tsx` | frame | Same treatment as import-customers. |
| `components/modals/sweep-modal.tsx` | frame | Clean-up-leads picker. `<h2>` in `.sheet-head`. "Archive checked" = `.sheet-pri`; "Delete checked" stays quiet red; "Mark checked Lost" quiet. |
| `components/modals/quote-sweep-modal.tsx` | frame | Clean-up-quotes picker. Same treatment as sweep-modal. |
| `components/modals/placeholder-modals.tsx` | frame | This is the `CLEAN_UP` modal (`CleanUpModalContent`). `<h2>` in `.sheet-head`; "Mark lost & archive" = `.sheet-pri`; Cancel quiet. |
| `components/modals/cust-quote-modal.tsx` | frame | **CUSTOMER-facing branded surface** (the shop's own brand colors/logo — this is what YOUR customer sees, not office chrome). Keep the brand header block exactly as it is — it IS the identity — but wrap/mark it as `.sheet-head` so it sticks. Approve = `.sheet-pri`; Decline quiet. Do not touch or re-register the customer-facing copy. |
| `components/modals/cust-invoice-modal.tsx` | frame | **CUSTOMER-facing branded surface.** Brand header = `.sheet-head`. "Pay $X" = `.sheet-pri`; Bank transfer quiet. |

"full" tier = header + secondaries + rows/accordions + foot (the whole grammar, like
lead-modal). "frame" tier = just wrap the existing title in `.sheet-head` and dock the
terminal action in `.sheet-foot`; leave the body as-is unless it directly violates a
rule (duplicate ✕, dash empty-states, a destructive action styled as primary).

---

## How to resume — recommended approach

The two failures were NOT caused by the conversion work itself — they were Claude
account-level session-limit errors that hit mid-agent-run inside a `Workflow` fan-out
(`ultracode`/ `Workflow` tool, one subagent per modal file, run in parallel). Both times,
~half the agents finished cleanly and returned trustworthy structured summaries; the
other half died mid-edit with no returned summary, and their partial file edits had to be
identified and reverted by hand (check `git status`, then `tsc --noEmit`, then eyeball any
file that typechecks clean but has a suspiciously large/small diff and no corresponding
agent summary — do NOT trust a modified file just because it typechecks).

**To avoid a third cutoff, prefer a smaller batch this time** — 4-5 modals per
`Workflow` call instead of all 10 at once, verifying + committing after each batch. The
`tech-job-modal.tsx` conversion in particular deserves its own solo pass given its
importance (see the note above) rather than being one of a crowd.

The original orchestration script (all 21 modals, correct per-modal guidance in the
prompt text) is preserved on disk from the last run:

```
/Users/owensmacbook/.claude/projects/-Users-owensmacbook-Downloads-prospecting-mallet-app-labels/697a2665-6990-4b03-9603-92dc2a92f569/workflows/scripts/sheet-grammar-conversion-wf_f3c8779d-15d.js
```

That script's `MODALS` array has a `tier` and modal-specific `note` for every file — the
table above is extracted from it for the 10 remaining. Either resume it directly
(`Workflow({ scriptPath: ..., resumeFromRunId: "wf_f3c8779d-15d" })` — completed agents
replay from cache, so the 11 already-done ones won't be re-run) or hand-slice a smaller
`MODALS` array for just the next batch and run it fresh — both are fine. If resuming, be
aware the cache only helps for modals whose (prompt, opts) are byte-identical to the
last run; anything already committed to disk should just be skipped from the array
entirely to avoid confusion.

**After every batch, before moving to the next one:**
1. `git status` — confirm only the intended files changed.
2. `npx tsc --noEmit` — must be clean. Any error means an agent died mid-edit; revert
   that specific file to `origin/main` (or to the last good commit on this branch) and
   re-queue it for a future batch rather than trying to hand-fix a stranger's partial
   edit.
3. For any file that typechecks clean but you're unsure about (agent errored without a
   summary, or the diff size looks wrong for the change described): `git diff` it by
   eye before trusting it. A file can typecheck and still be semantically broken (wrong
   action in the primary slot, a duplicated ✕, a capability silently dropped).
4. `pnpm lint` and `pnpm lint:css` — must show 0 errors (warnings are fine, this repo
   carries ~229 / ~183 pre-existing ones; don't chase them).
5. `npx vitest run` — must be 100% green. If a conversion changed visible button/label
   copy, grep the corresponding `*.test.tsx` for the old string — this bit
   `new-job-modal.tsx` once already (see above).
6. Commit the batch with a message naming exactly which files it converts, matching
   the style of `a83811a` on this branch.

## Gate checklist — once all 21 are converted (or once you're ready to PR what's done)

Follow the exact sequence #253 and #251 used earlier in this project (see prior commits
on `main` for the precise commands if needed):

1. `npx tsc --noEmit`, `pnpm lint`, `pnpm lint:css`, `npx vitest run` — all clean/green.
2. `pnpm build` (production build).
3. `E2E_VISUAL=1 npx playwright test e2e/visual-modals.spec.ts --update-snapshots` —
   deliberate re-baseline, since every converted modal's shape changed on purpose. Then
   run it again WITHOUT `--update-snapshots` to confirm it's now stable (two green runs
   back to back, not just one).
4. Serve the production build and run the full page net,
   `E2E_VISUAL=1 npx playwright test e2e/visual.spec.ts`, against it. Expect ~76/78 —
   the 2 `money · mobile` failures are a pre-existing live-data flake unrelated to
   modals (documented in #251/#253's PR descriptions).
5. Screenshot at least `tech-job-modal` (the field surface) and 2-3 others on a
   simulated iPhone (see #253's PR description for the exact device profile used) —
   Owen's original complaint was specifically about how these look on his actual
   phone, so a screenshot pass before asking for review matters more here than on a
   typical PR.
6. Open the PR against `main` (this branch, `feat/sheet-grammar-all-modals`, is already
   pushed and tracks origin). Reference #253 as the pattern this completes across the
   rest of the app.

---

## Why this doc exists

Two Claude sessions in a row got cut off mid-rollout by account session limits, each
time leaving a workflow with roughly half its agents dead mid-edit and no memory of
which files were trustworthy. Reconstructing that required: diffing every touched file
against `origin/main`, re-running `tsc` to find files an agent broke, discovering one
file (`close-out-modal.tsx`) had an unrelated pre-existing corruption that made `git
diff` lie about it being binary, and cross-referencing the workflow's own JSON summaries
against `git status` to figure out which of the touched-but-unreverted files actually had
a trustworthy completed conversion versus a dead agent's half-finished draft. That
process is captured above so it doesn't have to be redone a third time.
