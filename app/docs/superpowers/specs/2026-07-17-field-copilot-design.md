# AI Foreman Phase 3 — The Field Copilot (design)

**Thesis:** the tech standing in front of a rusted water heater snaps a photo, holds the mic, and
asks *"what should I do here?"* — and the answer comes from THIS job (scope, checklist, what the
office sold, the org's services), not generic internet advice. The AI Foreman's standard reaches
the jobsite: pillar 3 of jobs (checklists = the standard, callbacks = the teacher, the copilot =
the standard in the tech's ear).

## The frame (approved defaults, validated against the code by the 2026-07-17 scoping workflow)

- **Advise-only agent.** The copilot's agent loop has ZERO mutating tools — no approval/resume
  machinery exists because nothing needs approving. Its 3 read-only tools are closed over the
  assignment-verified job id (the model can never supply a jobId).
- **The one action is a human tap, not an agent tool.** When advice suggests found work, the card
  shows **Add to found work** → a NEW deterministic `v1.field.addAddon` (assignment-gated,
  `status:"proposed"` → the existing office awaiting-OK pill flow; `rateCents` forced 0 when the
  tech doesn't see prices). The agent stays toolless on writes; the office still gates the money.
- **Photo:** camera input → client canvas downscale (~1568px long edge, JPEG — also normalizes
  HEIC) → the existing signed-upload gateway via new field-gated mints → the server re-fetches
  bytes per run (by photoId, org+job revalidated) → Anthropic image blocks. Image bytes NEVER ride
  the client transcript.
- **Voice v1:** push-to-talk via browser `webkitSpeechRecognition` (capability-detected; typing is
  the always-there input, not a fallback mode). No new vendor; an isolated ~80-line hook so a v2
  server-STT swap is contained. Verified: zero speech/camera code exists today.
- **Money rules:** context is built through `redactMoneyForTech` BEFORE prompt assembly; `total`
  excluded for redacted techs; cost never present; the system prompt forbids stating prices when
  redacted. (LLM-side redaction is the only redaction that matters — the model reads the DTO.)

## Live findings fixed in this phase (from scoping — both verified to the line)

1. **`jobSummaryDTO.total` money leak:** non-nullable at job-dto.ts:155, mapped unconditionally,
   and `redactMoneyForTech` only remaps lines/addons — full job price reaches every tech device
   with techSeesPrice=false. Fix: schema nullable + nulled in redaction; also fixes the secondary
   PricingSec "Price it on site" artifact on already-priced jobs.
2. **Dead Ask-Mallet bar for techs:** app/(field)/layout.tsx:36 mounts CommandBar unconditionally;
   v1.ai.run is ownerOrOfficeNoTx → techs get an error artifact. Fix: for techs the bar routes to
   the copilot when a job context exists, else hides (no dead controls).

## Decisions (Owen's standing rules applied)

- Techs proposing found work via the copilot card is consistent with the existing
  proposed→office-OK flow; the office gate is preserved. (The current tech-read-only FoundWorkSec
  reads as an implementation constraint, not a product decision — the new endpoint keeps the OK
  flow either way.)
- No per-user rate limit in v1 (2-org pilot); `agent.turn.completed` token logging covers cost
  visibility. Revisit at >5 orgs.
- Vision QA / cross-shop learning stay Phase 4. Photo intake by email (front desk) stays deferred.

## Build: 4 PRs

PR1 backend core (anyRoleNoTx, field tool registry + prompt, run endpoint, total-leak fix) ·
PR2 photo pipeline (field mints, gateway.download, LLM image blocks, downscale, camera input) ·
PR3 UI (copilot fsec in tech-job-modal + advice card + v1.field.addAddon + CommandBar fix) ·
PR4 voice (push-to-talk hook). PR4 is cuttable without harming the demo spine.
