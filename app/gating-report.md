# Measurement estimating — org-level gate

## Summary

Added `measurementEstimating` (column `measurement_estimating`, `boolean NOT NULL DEFAULT false`)
to `org_settings`, wired end-to-end schema → domain → DTO → router → store → Settings UI, and
gated the job modal's Measurements section behind it. Default OFF, so every existing org
(including Owen's plumbing orgs) is unaffected until an owner opts in from
Settings → Workspace → "Job features".

## Touchpoints (mirrors the `scopeOn`/`techSeesPrice` pattern exactly)

- `shared/db/schema/org-settings.ts` — new column.
- `modules/settings/domain/org-settings.ts` — `OrgSettingsProps.measurementEstimating`, threaded
  through `patch()`.
- `modules/settings/domain/org-settings.fixtures.ts` — fixture default `false`.
- `modules/settings/infra/settings-mapper.ts` — row → domain.
- `modules/settings/infra/drizzle-settings-repository.ts` — `saveConfig` write.
- `modules/settings/api/settings-dto.ts` — `orgSettingsDTO` + `toOrgSettingsDTO`.
- `modules/settings/api/settings-router.ts` — `updateConfigInput`.
- `lib/store/slices/settings-slice.ts` — `SettingsToggles.measurementEstimating`,
  `EMPTY_TOGGLES`, `setToggle`'s `toggleToField` map.
- `features/settings/settings-hydrator.tsx` — hydrates the toggle from `v1.settings.get`.
- `app/(office)/settings/job-features-card.tsx` (new) — Settings → Workspace card, "Job
  features," with the "Measurement estimating" toggle row (DisclosureRow/switch pattern
  copied from the existing "Techs can see job prices" row). Copy: label "Measurement
  estimating", description "Scan or enter room measurements on jobs, and price from them.
  For painting and other measured trades." Wired into `SecWorkspace()` in
  `app/(office)/settings/page.tsx`.

## Consumer gating

- `components/modals/job-modal.tsx` — the "Measurements" `SheetRow` (and its `JobMeasureBlock`)
  now only renders when `useAppStore((s) => s.toggles.measurementEstimating)` is true. When
  false, the row does not exist in the DOM at all (matches pre-#259 behavior) — not a collapsed
  or empty row.
- Grepped for `JobMeasureBlock` / `MODAL.ROOM_CARD` usages across the repo: the job-modal
  `SheetRow` is the **only** entry point. `room-card-modal.tsx` is reached from inside
  `JobMeasureBlock`, not independently. `lib/native/room-scan.ts` and `modal-host.tsx` register
  the modal but don't render an independent trigger.
- Confirmed the tech job modal (`components/modals/tech-job-modal/`) has **no** measurements
  surface — verified via grep, not assumed.

## Tests added/updated

- `lib/store/slices/settings-slice.test.ts` — new `setToggle`/default test for
  `measurementEstimating`; fixed a `setSettings` literal that needed the new field.
- `modules/settings/infra/settings-mapper.test.ts`, `org-settings.test.ts`,
  `org-settings.stripe.test.ts`, `app/get-settings.test.ts`, `app/connect-onboarding.test.ts` —
  added the field to hand-built row/props fixtures so `tsc` stays green.
- `app/(office)/settings/job-features-card.tsx` + `.test.tsx` (new) — renders unchecked by
  default, functional copy, `setToggle` called correctly, reflects an "on" org.
- `components/modals/job-modal.measurements-gate.test.tsx` (new) — `JobModalContent` renders
  no "Measurements" row / no `JobMeasureBlock` when the toggle is off; renders it when on.
- `modules/settings/api/settings-router.int.test.ts` — added an int test for the
  `updateConfig`/`get` round-trip. **Cannot pass until the migration below is applied** (no
  `measurement_estimating` column on the live DB yet) — left in place per the task's
  instruction to write it and document the gap.

## Migration — DEFERRED

**Migration generation deferred — run `npm run db:generate` && hand-check numbering &&
`npm run db:migrate` && `npm run db:verify` after PR #263 merges.** PR #263 holds migration
slot 0107; per the single-writer migration constraint I did not run `db:generate` or
`db:migrate`. The schema file change (`shared/db/schema/org-settings.ts`) is included in this
commit; no generated migration file is.

## Gates run

- `npx tsc --noEmit` — clean.
- `npm run lint` (eslint) — 0 errors (237 pre-existing warnings, unrelated to this change).
- `npm run lint:css` (stylelint) — 0 errors (183 pre-existing warnings; no CSS touched).
- `npx vitest run` — 398 test files / 4448 tests, all passing.

## Concerns / follow-ups

- The int test added above will fail against the live DB until the deferred migration lands —
  expected, documented, not a regression.
- No other Measurements entry point exists today, so gating the single `SheetRow` is a complete
  fix for the reported defect.
