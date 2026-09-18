# Field Copilot — PR2: Photo Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per task, adversarial review per task, full gate before the PR.

**Goal:** Claude sees the water heater. A tech's photo travels: camera capture → client canvas
downscale → the existing signed-upload gateway (new FIELD-gated mints) → `job_photos` row → the
copilot run passes `photoIds` → the server revalidates + downloads + base64s → **Anthropic image
blocks**. Image bytes NEVER ride the client transcript (photoIds only; the stored transcript gets
a text marker).

**Verified anchors (scoping + PR1):**
- Gateway port `PhotoStorageGateway.createUploadUrl` (modules/jobs/domain/photo-storage-gateway.ts)
  — org/job-prefixed path `<org>/<job>/<objectId>.<ext>`, SAFE_SEGMENT, private bucket
  `job-photos`, timeout pattern + narrow StorageClient iface (supabase-photo-storage-gateway.ts).
  NO read/download exists anywhere in the repo.
- Office-only `photoUploadUrl` + `addPhoto` (modules/jobs/api/job-router.ts:410,431); addPhoto's
  storagePath org/job prefix check lives in the use-case (job-execution-use-cases.ts:321).
- Field auth: the field-router's assertOnJobIfTech + terminal-status gate patterns; the copilot
  router (modules/ai/api/field-copilot-router.ts) with its short-auth-tx + closure-tools shape.
- LLM port is text-only: `AgentMessage` user union = text | tool_results
  (modules/ai/domain/llm-client.ts); `toMessageParam` maps user text as a bare string
  (anthropic-llm-client.ts:83-97); Anthropic SDK ^0.109 supports image blocks natively.
- 3-step client upload util `lib/store/upload-job-photo.ts` (zero callers today) — repoint/extend,
  don't duplicate.
- `uploadJobPhoto`'s only UI consumer will be PR3; this PR ships the pipeline + endpoints + a
  copilot-run photo path, all testable without UI.

## Global Constraints

- Tenant safety: mints assignment-gated (a tech can only mint into THEIR job's folder); the server
  NEVER fetches a client- or model-supplied raw storagePath — photoIds are resolved to
  `job_photos` rows and revalidated (org + THE VERIFIED jobId + the org/job path prefix) before
  any download.
- Image bytes: server-side only, per run, capped (reject > 5MB post-download; cap 3 photos/run);
  never in the round-tripped transcript (the transcript stores `[photo attached]` markers).
- The LLM port change is ADDITIVE (a new union member) — existing transcripts/office agent
  unaffected; the anthropic client's default-drop behavior for unknown blocks stays.
- Design principles binding; no `any`; fns <50 lines; TDD; full gate before the PR.

---

### Task C1: LLM port + client image support (additive)

**Files:** `modules/ai/domain/llm-client.ts` · `modules/ai/infra/anthropic-llm-client.ts` (+ its
test) · `modules/ai/app/run-agent-turn.ts` (+ test).

1. `llm-client.ts`: additive union member —
   `{ readonly role: "user"; readonly kind: "user_blocks"; readonly blocks: readonly UserContentBlock[] }`
   with `export type UserContentBlock = { readonly type: "text"; readonly text: string } |
   { readonly type: "image"; readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
   readonly dataBase64: string }`.
2. `anthropic-llm-client.ts` `toMessageParam`: a `user_blocks` branch emitting Anthropic
   `{type:"text"}` / `{type:"image", source:{type:"base64", media_type, data}}` blocks. Unit test:
   the mapped param shape for a mixed text+image message (assert media_type + data passthrough;
   no other branches disturbed).
3. `run-agent-turn.ts`: `RunAgentParams` gains OPTIONAL `userBlocks?: readonly UserContentBlock[]`
   — when present, the initial user turn is `{kind:"user_blocks", blocks:[...userBlocks,
   {type:"text", text: userMessage}]}` instead of plain text. Existing callers unchanged
   (param optional). Unit test: with userBlocks the transcript's first user entry is user_blocks;
   without → text (existing tests green).
- [ ] Gate: tsc · lint · `npm test -- llm-client anthropic run-agent-turn`. Commit
  `feat(ai): additive multimodal user blocks in the LLM port + Anthropic client`.

### Task C2: Gateway download + field photo endpoints

**Files:** `modules/jobs/domain/photo-storage-gateway.ts` + `supabase-photo-storage-gateway.ts`
(+ test) · `modules/jobs/api/field-router.ts` (+ int test) · trpc/di or wherever the gateway
binds (check how photoStorageGateway reaches ctx.deps).

1. Gateway port gains
   `download(storagePath: string): Promise<Result<{ dataBase64: string; mediaType: string; bytes: number }, ExternalServiceError>>`.
   Impl: extend the narrow StorageClient iface with the bucket `.download(path)` method (returns a
   Blob in supabase-js — check the actual signature in node_modules); same timeout pattern; infer
   mediaType from the extension (jpg/jpeg→image/jpeg, png, webp; anything else → error);
   reject > 5MB (constant `MAX_PHOTO_BYTES = 5 * 1024 * 1024`). SAFE path validation stays the
   caller's job (the path comes from a DB row, but validate the org prefix defensively here too —
   accept an expected `{orgId, jobId}` pair and verify the path starts with `${orgId}/${jobId}/`).
2. Field endpoints in field-router (clone the office pair + the field gates):
   - `photoUploadUrl`: `anyRole`, input `{jobId: uuid, objectId: uuid, ext: enum(jpg|jpeg|png|webp)}`
     → assertOnJobIfTech + non-terminal gate → PRECONDITION_FAILED when the gateway is unbound →
     `createUploadUrl`. (The office version checks job existence — keep that.)
   - `addPhoto`: `anyRole`, input mirrors the office addPhoto (jobId, id, storagePath, caption?,
     verifyPass?) → assertOnJobIfTech + non-terminal → the SAME AddJobPhotoUseCase (its use-case
     prefix check already guards storagePath) → return the redacted jobDTO for techs (the B1
     redaction pattern — seesPrice lookup + redactMoneyForTech).
3. Int tests (field-router.int.test): tech mints an upload URL for THEIR job (shape asserted);
   tech NOT on the job → FORBIDDEN; terminal job → BAD_REQUEST; addPhoto persists the row for the
   assigned tech + response is redacted (total null when !seesPrice); a storagePath outside the
   job's prefix → rejected (use-case guard proven from the field path). Gateway download: unit
   test with a fake StorageClient (happy path base64 + size cap rejection + timeout).
- [ ] Gate incl. `npm run test:int -- field-router`. Commit
  `feat(field): photo upload mints + gateway download (org/job-revalidated)`.

### Task C3: Copilot run accepts photos

**Files:** `modules/ai/api/field-copilot-router.ts` (+ unit/int tests).

1. Input gains `photoIds: z.array(z.string().uuid()).max(3).optional()`.
2. In the short auth tx (after assertOnJobIfTech): resolve each photoId via the jobs repo's
   execution loader (or a direct `job_photos` read — find the cleanest existing reader:
   `listExecution(jobId).photos`) — the photo must belong to THE VERIFIED jobId (else NOT_FOUND;
   never fetch by raw path). Collect their storagePaths.
3. After the tx (NoTx discipline — downloads are slow external calls): for each path,
   `gateway.download(path, {orgId, jobId})`; failures → PRECONDITION_FAILED with a clear message
   (a broken photo must not silently produce advice that ignored it). Build
   `userBlocks: [{type:"image", ...}...]` and pass to runAgentTurn.
4. The transcript RETURNED to the client: replace the user_blocks entry with
   `{kind:"text", text: "[photo attached] " + message}` so image bytes never round-trip (build
   the returned transcript from the runAgentTurn result with that substitution; the model already
   consumed the real blocks this turn; follow-up turns reference the conversation text — v1
   accepts that follow-ups don't re-see the pixels, document it).
5. Tests: unit (fake LLM + fake gateway): a run with photoIds produces an LLM request whose first
   user message contains an image block with the fake's base64; the returned transcript contains
   NO dataBase64 anywhere (stringify + assert absence); a photoId from ANOTHER job → NOT_FOUND
   (fake repo). Int: happy-path shape with a seeded job_photos row + fake LLM at the deps seam;
   cross-job photoId rejected.
- [ ] Gate incl. the copilot int file. Commit
  `feat(ai): field copilot photo input — revalidated download → image blocks`.

**→ Full gate, then PR2: "Field copilot PR2 — the photo pipeline".**

## Self-review (done)

- Spec coverage: camera/downscale UI is PR3 (uploadJobPhoto util gets its caller there); this PR
  = port/client/loop image support (C1), storage read + field mints (C2), the run's photo path
  with revalidation + no-bytes-in-transcript (C3). ✓
- Security: model never supplies paths; photoIds → rows → verified-job check → prefix-validated
  download; bytes server-side only; caps (3 photos, 5MB); no bytes in logs or transcripts. ✓
- Additive port change keeps office agent + existing transcripts untouched. ✓
