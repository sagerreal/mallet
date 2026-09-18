# Field Copilot — PR3: The UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Calibrated spend: D1 (the write endpoint) = full implementer + adversarial reviewer;
> D2+D3 (UI) = one implementer + ONE consolidated review; D4 (CommandBar) = controller-direct.

**Goal:** The copilot becomes demoable: a **Copilot section in the tech job modal** — camera button
(capture → canvas downscale → field mints → photoIds), text input, Ask → the advice card renders the
answer; when the reply carries the `FOUND WORK:` marker, a one-tap **Add to found work** button
lands the item as a `proposed` addon through a NEW deterministic `v1.field.addAddon`. Plus the
dead-CommandBar fix for techs.

**Verified anchors (scoping wf_06352548 + PR1/PR2):**
- UI slot: `TechJobModalContent` render order (tech-job-modal.tsx:1394-1557) — the copilot lands as
  a NEW memoized `.fsec` at ~:1536 (between PricingSec and FoundWorkSec), comparator reading ONLY
  job.id/title/svc/scope/notes/addons (NOT job.verify — checklist taps must not re-render it);
  pattern: `foundWorkPropsEqual` (:624).
- The tech add-path gap: FoundWorkSec is `readOnly={!isOffice}` (:1540) and store `addAddon` calls
  `v1.jobs.addAddon` (ownerOrOffice, job-router.ts:360) — a tech's optimistic add ROLLS BACK.
  → NEW `v1.field.addAddon` + store routing for tech callers.
- CommandBar: `app/(field)/layout.tsx:36` mounts it unconditionally; `v1.ai.run` is
  ownerOrOfficeNoTx → techs get an error artifact (dead control).
- Endpoints live (PR1/PR2): `v1.fieldCopilot.run {jobId, message, photoIds?, transcript?}` →
  `{status, text, transcript}`; `v1.field.photoUploadUrl {jobId, objectId, ext}` →
  `{signedUrl, token, storagePath}`; `v1.field.addPhoto {jobId, id, storagePath, caption?}`.
  Upload util `lib/store/upload-job-photo.ts` (3-step, zero callers — repoint to the FIELD
  endpoints for tech callers or parameterize).
- `FOUND WORK: {description}` marker contract: documented at the top of
  `modules/ai/app/field-copilot-prompt.ts` (one per reply max, ≤80 chars, standalone end line).
- Feel Kit classes available: `.fsec/.fsec-h` chrome, `.tjpaid-btn2`-style buttons, `.sk` shimmer.
- Artifacts reuse: `AiThinkingBlock`/`AiResultBlock` (features/counter/artifacts.tsx) for the
  thinking/answer rendering.

## Global Constraints

- Tenant/money safety on D1 (non-negotiable): org from principal; assignment + non-terminal gates;
  `status:"proposed"` ALWAYS (the office OK-pill flow is the approval); when the caller is a tech
  and `!techSeesPrice`, IGNORE any client rate → `rateCents: 0` (techs don't author prices).
- The modal is memoized scar tissue: the copilot section is ADDITIVE (new component + one render
  line + comparator); zero changes to existing sections.
- Photos: client downscale BEFORE upload (canvas, longest edge ~1568px, JPEG q0.8 — normalizes
  HEIC; keeps well under the 5MB gateway cap); camera input
  `<input type="file" accept="image/*" capture="environment">`.
- UI house rules: in-flow, no floating, no grey helper text, functional copy, Feel Kit press
  states on the new buttons. Screenshot-verify on a mobile viewport.
- Full gate before the PR.

---

### Task D1: `v1.field.addAddon` + store routing (FULL review treatment)

**Files:** `modules/jobs/api/field-router.ts` (+ int test) · `lib/store/slices/jobs-slice.ts`
(the addAddon action's mutation routing) · anything the office FoundWorkSec passes through.

1. Endpoint: `anyRole`, input `{ jobId: uuid, id: uuid optional, description: string 1..200,
   rateCents: int ≥0 optional }` → assertOnJobIfTech + non-terminal → resolve seesPrice; for tech
   callers with `!seesPrice`, force `rateCents: 0` (ignore client value); delegate to the SAME
   AddJobAddonUseCase the office uses with `status:"proposed"`, `isOptional` per office default —
   READ the office addAddon (job-router.ts:360 region) and mirror its command shape; response =
   redacted jobDTO for techs (B1 pattern).
2. Store: route the existing `addAddon` action to `v1.field.addAddon` when the caller is a tech
   (the store knows the role via the me/identity slice — find how other role-branched calls work;
   if none exist, the cleanest is a separate `addAddonField` action the copilot card + a
   tech-enabled FoundWorkSec use). Keep office behavior byte-identical.
3. Int tests: tech on job adds → row lands `proposed` + response redacted; `!seesPrice` tech
   sending rateCents 9999 → stored 0; office caller unchanged via the OFFICE endpoint; FORBIDDEN
   off-job; BAD_REQUEST terminal.
4. (Same task, one line) FoundWorkSec `readOnly` stays as-is for now — the copilot card is the
   tech's add-path in this PR (flipping FoundWorkSec for techs is a product call Owen can make
   separately).

### Task D2: The copilot section + camera/downscale (ONE consolidated review)

**Files:** Create `features/field-copilot/copilot-section.tsx` + `use-field-copilot.ts` +
`lib/images/downscale.ts` (+ unit test for the pure parts) · modify `components/modals/tech-job-modal.tsx`
(ONE render line + the memo comparator) · `lib/store/upload-job-photo.ts` (parameterize to the
field endpoints) · `app/prototype.css` (the section's styles, Feel-Kit consistent).

1. `use-field-copilot.ts`: local state {messages, pending, error, attachedPhotos}; `ask(message)`
   calls `trpcVanilla.v1.fieldCopilot.run` with the running transcript + attached photoIds; parses
   the trailing `FOUND WORK: …` marker off the display text (the marker line renders as the
   one-tap card, not as prose — parser tested against the documented contract incl. no-marker,
   marker-with-trailing-whitespace, >80-chars-ignored).
2. `downscale.ts`: pure-ish canvas util `downscaleImage(file, {maxEdge: 1568, quality: 0.8}) →
   Blob(jpeg)`; unit-test the geometry math (extract `fitWithin(w, h, maxEdge)` pure).
3. Camera flow: input capture → downscale → `uploadJobPhoto` (field mints) → photoId chip on the
   input row (thumbnail optional — a filename/`📷 1` chip is fine for v1) → included in the next
   ask; cap 3.
4. `copilot-section.tsx`: an `.fsec` titled **Copilot** — transcript area (tech question right,
   answer left, `AiThinkingBlock` while pending), the FOUND WORK card with
   **Add to found work** (calls the D1 store action; on success the button flips to `Added ✓` and
   the item appears in FoundWorkSec via the store), input row [📷][text][Ask]. Feel Kit press
   states; skeleton/pending states; errors inline via `userMessage`.
5. Modal wiring: one line at ~:1536 + `copilotPropsEqual` (id/title/svc/scope/notes/addons only).
6. Screenshot-verify (mobile viewport 390×844, tech@e2e): the section idle, a pending ask, an
   answer with the found-work card, the Added ✓ state.

### Task D3 (controller-direct): CommandBar for techs

**Files:** `app/(field)/layout.tsx` or `components/.../command-bar.tsx`.
Techs currently get the office Ask-Mallet bar whose endpoint FORBIDs them (dead control). V1 call:
HIDE the bar for tech roles (the copilot lives in the job modal where the jobId context exists);
office/owner users in the field layout keep it. One conditional + a comment.

### Task D4 (controller-direct): gate + screenshots + PR

Full gate · the D2 screenshots reviewed against the forms-ui bar · PR3 body with the demo flow.

## Self-review (done)

- Spec coverage: camera+downscale (D2), advice card + one-tap via NEW deterministic write (D1+D2),
  CommandBar fix (D3); voice = PR4. The marker contract has ONE canonical doc (the prompt file) and
  the parser tests against it. FoundWorkSec readOnly flip deliberately deferred (product call). ✓
- Money: the only new write forces proposed + rate 0 for redacted techs; office flow untouched. ✓
