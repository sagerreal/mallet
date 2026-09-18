# AI Voice Front Desk — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbound calls to the org's Twilio number are answered by a playbook-grounded Vapi
voice agent that books real jobs/estimate visits, takes messages, captures quote requests, and
persists every call — without ever generating a price.

**Architecture:** New hexagonal `modules/frontdesk` + one public webhook
(`app/api/frontdesk/vapi`) mirroring the Twilio webhook pattern: secret-verify → org by
To-number (privileged reader) → `withTenant` → use-cases. Assistant config is transient,
built per-call from `org_settings`. Tools are idempotent by Vapi `toolCallId` via a ledger
table. Spec: `docs/superpowers/specs/2026-07-14-ai-voice-frontdesk-design.md` (read it first).

**Tech stack:** Next.js 16 route handler · Drizzle/Supabase RLS · Vapi server-messages API ·
zod boundary validation · Vitest unit + integration.

## Global Constraints

- Org id NEVER from request payload content — only from the To-number lookup
  (`DrizzleOrgByNumberReader`); all tenant work inside `withTenant(orgId, tx => …)`.
- New tenant tables get hand-written RLS (`ENABLE` + `FORCE` + `FOR ALL USING/WITH CHECK
  (org_id = public.current_org_id())`) in a separate numbered migration + composite FKs
  `(org_id, lead_id) → leads(org_id, id)`. drizzle-kit does not emit RLS.
- **The agent may only speak configured prices**: `booking.serviceFee` and flat-lane
  `service.price`. No other dollar amount may appear in prompt or tool results. Post-call
  price audit flags violations.
- Money stays integer-cents in domain/DTO; the playbook's `serviceFee`/`price` are DOLLARS
  (existing prototype-parity exception) — format for speech only, never arithmetic.
- DI everywhere: use-cases take ports in constructors; route handler composes. No use-case
  imports drizzle directly. DTOs ≠ domain. Validate every Vapi payload with zod at the route
  boundary; unknown message types are logged and 200-acked (Vapi sends types we don't handle).
- No silent failures: tool handlers that fail return a spoken fallback AND create a message
  task; webhook processing errors 5xx (never swallowed).
- Constants over magic values: everything tunable lives in
  `modules/frontdesk/infra/vapi-defaults.ts` or `domain/constants.ts`.
- Functions small; files ≤ ~400 lines; barrel `modules/frontdesk/index.ts` exports api only.
- Tests: unit for every pure function + use-case (fake ports), integration for the route
  against the live db (RLS + cross-org isolation), coverage gate 80/75 must hold.
- Full gate before each PR: `npx tsc --noEmit` · `npm run lint` · `npm test` ·
  `npm run test:int` · `npm run coverage` · `npm run build`.
- Migration numbering: check `gh pr list` for open migration PRs first; current head is 0069.
  After `npm run db:migrate`, VERIFY the table exists (ledger-collision gotcha).
- UI copy functional, not chatty; no floating UI; screenshot-verify office surfaces.

---

## Phase A — the number answers (PR A)

### Task A1: Schema + migrations

**Files:**
- Create: `shared/db/schema/frontdesk.ts`
- Modify: `shared/db/schema/index.ts` (export), `shared/db/schema/jobs.ts` (kind column)
- Migrations: generated `0070_*` + hand-written `0071_frontdesk_rls.sql`

**Schema (complete):**

```typescript
// shared/db/schema/frontdesk.ts
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, foreignKey, primaryKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// One row per answered call. Transcript/messages come from Vapi's end-of-call-report;
// disposition is derived from the call's tool invocations at record time.
export const frontdeskCalls = pgTable(
  "frontdesk_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    leadId: uuid("lead_id"),
    vapiCallId: text("vapi_call_id").notNull(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    transcript: text("transcript"),
    messages: jsonb("messages"),          // [{role, message}] from artifact.messages
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    disposition: text("disposition").notNull().default("no_action"),
    priceAudit: jsonb("price_audit"),     // { flagged: string[] } — non-empty = violation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("frontdesk_calls_vapi_call_uidx").on(t.orgId, t.vapiCallId),
    index("frontdesk_calls_lead_idx").on(t.orgId, t.leadId),
    foreignKey({ columns: [t.orgId, t.leadId], foreignColumns: [leads.orgId, leads.id] }),
  ],
);

// Idempotency ledger: Vapi retries tool webhooks; a replayed toolCallId returns the
// stored result and never re-executes (double-booking guard).
export const frontdeskToolInvocations = pgTable(
  "frontdesk_tool_invocations",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    vapiCallId: text("vapi_call_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    tool: text("tool").notNull(),
    result: jsonb("result").notNull(),    // the exact ToolResult returned to Vapi
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.toolCallId] })],
);
```

`jobs.kind`: add to `shared/db/schema/jobs.ts`:
```typescript
// 'work' (sold/repair work) | 'estimate' (pre-quote scope visit booked as a job so it
// rides the board/My-Day unchanged). Default keeps every existing row a work job.
kind: text("kind").notNull().default("work"),
```
Mirror the field through the jobs domain (`JobProps.kind`), mapper, and DTO as a passthrough
(no behavior change in this task; `Job.create` accepts it, default `"work"`).

**Steps:**
- [ ] Write schema; `npm run db:generate`; inspect the generated `0070_*` file.
- [ ] Hand-write `0071_frontdesk_rls.sql` copying the 0069 pattern for BOTH tables
      (ENABLE + FORCE + tenant policy) + journal entry.
- [ ] Unit-test the jobs domain passthrough (`kind` defaults to `"work"`, preserved on update).
- [ ] `npm run db:migrate`, then VERIFY: `select 1 from frontdesk_calls limit 0` via the int-test
      db helper (migration-ledger gotcha).
- [ ] Commit `feat(frontdesk): call + tool-invocation tables, jobs.kind`.

### Task A2: Config + Vapi payload schemas + defaults

**Files:**
- Modify: `shared/config/index.ts` — add `VAPI_WEBHOOK_SECRET: z.string().min(16).optional()`,
  `VAPI_API_KEY: z.string().min(1).optional()`.
- Create: `modules/frontdesk/infra/vapi-schemas.ts` — zod schemas for the server-message
  envelope: `assistant-request`, `tool-calls` (`toolCallList[]: {id, name, arguments}`),
  `end-of-call-report` (`endedReason`, `artifact.transcript`, `artifact.messages`,
  `artifact.recording`, `call.{id, customer.number, phoneNumber.number}`), `status-update`.
  Use `z.looseObject` semantics (`passthrough`) — Vapi adds fields; validate only what we read.
  Export discriminated `parseServerMessage(body: unknown)`.
- Create: `modules/frontdesk/infra/vapi-defaults.ts` — named constants:
  `VOICE_MODEL = { provider: "openai", model: "gpt-4o", temperature: 0.4 }` (fast/proven on
  Vapi; revisit Anthropic once model availability verified), `VOICE = { provider: "vapi", voiceId: "Elliot" }`,
  `MAX_CALL_MINUTES = 15`, `SLOT_LOOKAHEAD_DAYS = 5`, `TOOL_TIMEOUT_S = 10`.

**Steps:**
- [ ] TDD `vapi-schemas.test.ts`: valid fixtures for each message type parse; junk rejects;
      unknown type yields `{ type: "unknown" }` (not an error).
- [ ] Commit `feat(frontdesk): vapi payload schemas + config`.

### Task A3: Domain ports + repositories

**Files:**
- Create: `modules/frontdesk/domain/call-record.ts` — `CallDisposition` union
  (`"booked_job" | "booked_estimate" | "quote_request" | "message" | "emergency" | "screened" | "no_action"`),
  `RecordCallInput`, `FrontdeskCallRepository` port (`recordEndOfCall(input): Promise<void>`,
  `listByLead`, `listRecent` — the list methods land in PR C but declare now),
  `ToolInvocationLedger` port (`find(toolCallId)`, `save(invocation)`).
- Create: `modules/frontdesk/infra/drizzle-call-repository.ts`,
  `modules/frontdesk/infra/drizzle-tool-ledger.ts` — tenant-tx constructed, explicit
  `eq(orgId)` defense-in-depth, soft-delete filters (copy `DrizzleMessageRepository` style).

**Steps:**
- [ ] TDD use-case-level tests with fake ports (repos themselves get integration coverage in A6).
- [ ] Commit `feat(frontdesk): domain ports + drizzle repositories`.

### Task A4: BuildAssistantUseCase — the playbook-grounded prompt

**Files:**
- Create: `modules/frontdesk/app/build-assistant.ts` (use-case + pure helpers)
- Create: `modules/frontdesk/app/prompt.ts` (pure: `buildSystemPrompt`, `buildFirstMessage`)
- Test: `modules/frontdesk/app/prompt.test.ts`, `build-assistant.test.ts`

**Interfaces:**
```typescript
export interface CallerContext {          // resolved before the call starts
  readonly known: boolean;
  readonly name: string | null;
  readonly openWork: string | null;       // e.g. "job #142 scheduled Jul 16 (drain clear)"
}
export interface BuildAssistantDeps {
  readonly settings: SettingsReader;      // port over modules/settings get-by-org
  readonly leadByPhone: LeadByPhoneReader;      // reuse messaging port
  readonly leadSummary: LeadSummaryReader;      // name + open jobs for a leadId (new small port)
}
export class BuildAssistantUseCase {
  async exec(cmd: { orgId: OrgId; fromNumber: string }): Promise<Result<VapiAssistantDTO, AppError>>
}
```

`buildSystemPrompt(settings, brand, caller)` sections (exact content in the file; key rules):
1. **Identity + compliance:** you are {brand}'s AI assistant; state it in the greeting; if
   asked whether you're human, say yes-you're-an-AI truthfully; the call is recorded.
2. **Business facts:** hours (from `hoursWd/Sat/Sun`), service area (`areaCities`,
   `areaRadiusMi`), what we don't do (`notServices` → politely decline + suggest calling a
   specialist), service fee: `$X{, credited toward the repair if you go ahead}`.
3. **Services table:** one line per playbook service — `name · lane · triggers[ · $price]`.
   Lane scripts:
   - `repair`: never state a job price; fee-credit framing verbatim; two-slot close.
   - `estimate`: free estimate visit, 1–2 hours, book it.
   - `flat`: you may state exactly `$price` for this service, then book.
4. **Case rules:** gas leak/smell → 911 + gas utility, do NOT book; flooding/sewage/no-water
   → emergency: book the soonest slot and note EMERGENCY; existing customer
   reschedule/cancel/where-is-my-tech/billing → take_message (office handles; never discuss
   billing amounts); vendor/spam/wrong number → end politely; tenant in a rental → landlord
   authorization required before booking non-emergency work; caller only wants a written
   quote → request_quote and promise a text from the office.
5. **Iron guardrails:** never say a dollar amount that is not in this prompt or a tool
   result; keep replies under ~25 words; confirm the phone number digit-by-digit and read the
   address back before booking; never promise an exact arrival time, only the window.
6. **Caller context** (when known): greet by name, reference open work.

`firstMessage`: `"Thanks for calling {brand}. You're speaking with {brand}'s AI assistant —
this call is recorded. How can I help?"`

The returned `VapiAssistantDTO` (shape per Vapi assistant-request docs): `firstMessage`,
`model: {provider, model, temperature, messages:[{role:"system",content}], tools:[…]}`,
`voice`, `maxDurationSeconds`, `artifactPlan: { recordingEnabled: true }`,
`endCallFunctionEnabled: true`. Tools array in this task: `take_message` only (A5); B adds
the rest — builder takes the tool list as data (open/closed).
`frontDesk === false` → return the decline assistant (single firstMessage: "You've reached
{brand}. We can't take your call right now — please try again during business hours.", ends).

**Steps:**
- [ ] TDD prompt.test.ts: fee line present + credited phrasing toggles; flat service price
      appears, repair services have NO price; notServices declined; caller context section
      only when known; NO dollar signs other than configured ones (regex assert).
- [ ] TDD build-assistant: decline path on frontDesk=false; caller recognition wires
      leadByPhone → leadSummary; 7.5s budget = single settings read (no N+1: leadSummary is
      one query).
- [ ] Commit `feat(frontdesk): transient assistant builder — playbook-grounded prompt`.

### Task A5: take_message tool + tool runner

**Files:**
- Create: `modules/frontdesk/app/tools/tool-result.ts` — `VoiceToolResult = { speak: string;
  data?: Record<string, unknown> }` (serialized into Vapi `results[].result`), and
  `VoiceTool` interface `{ name; description; parameters (JSON schema); input (zod);
  handle(input, ctx): Promise<VoiceToolResult> }` — deliberately parallel to
  `modules/ai/domain/tool.ts` `AgentTool` but voice-shaped (no approval gate on a live call;
  the gate is the tool whitelist itself + idempotency).
- Create: `modules/frontdesk/app/tools/take-message.ts` — input `{ caller_name, phone?,
  topic: enum(billing|reschedule|callback|commercial|other), details }` → EnsureCustomer
  (Phone.parse when present; source `"AI Front Desk"`) + `CreateTaskUseCase`
  (`text: "Call from {name} — {topic}: {details}"`, leadId linked) → speak:
  "Got it — I've passed that to the office and they'll get back to you."
- Create: `modules/frontdesk/app/run-tool-calls.ts` — `RunToolCallsUseCase`: for each
  toolCall: ledger hit → return stored result; else zod-validate args (invalid →
  spoken-fallback result, logged), execute, save to ledger, return. Failures → spoken
  fallback + auto take_message task ("caller needs follow-up"); never throws to the route.

**Steps:**
- [ ] TDD: ledger replay returns stored result and does NOT re-execute (spy); invalid args
      produce fallback speak + no crash; take-message creates lead + task (fake ports).
- [ ] Commit `feat(frontdesk): voice tool runner + take_message`.

### Task A6: RecordCallUseCase + price audit + webhook route

**Files:**
- Create: `modules/frontdesk/app/price-audit.ts` — pure:
  `auditPrices(assistantLines: string[], allowed: number[]): string[]` — extract
  `\$\s?\d[\d,]*(\.\d{1,2})?` from assistant-role lines, normalize, return amounts not in
  allowed set (allowed = serviceFee + flat prices).
- Create: `modules/frontdesk/app/record-call.ts` — derive disposition from the call's ledger
  rows (booked_estimate > booked_job > quote_request > message > no_action; emergency flag
  from any tool result data), run price audit, persist via repository, `markUnread` on the
  linked lead (reuse `DrizzleLeadUnreadMarker`), price-audit violation → CreateTask
  ("Review AI call — unapproved price mentioned").
- Create: `app/api/frontdesk/vapi/route.ts` — POST only, `nodejs` runtime, force-dynamic:
  1. `config.VAPI_WEBHOOK_SECRET` unset → 503 (`logger.warn`, feature dark).
  2. Verify `x-vapi-secret` header with timing-safe compare → 401 (before ANY db work).
  3. Parse + zod-validate body; extract To/From from `message.call`.
  4. Org by To-number (`DrizzleOrgByNumberReader`) → unknown → 200 decline/ack (log).
  5. Dispatch by type inside `withTenant`: assistant-request → BuildAssistant (also
     upsert a skeleton `frontdesk_calls` row: callId/from/to/startedAt); tool-calls →
     RunToolCalls (synthetic office principal); end-of-call-report → RecordCall;
     status-update/unknown → 200 log.
  6. Structured logs `{ vapiCallId, orgId, type }` on every branch; 5xx on processing errors.
- Modify: `modules/frontdesk/index.ts` — export the API surface.

**Steps:**
- [ ] TDD price-audit (configured amounts pass incl. "$1,250.00" formatting; others flagged).
- [ ] TDD record-call disposition matrix (table-driven).
- [ ] Integration `route.int.test.ts` (live db): 401 bad secret; assistant-request returns
      prompt containing a seeded playbook service + fee; tool-calls take_message creates
      lead+task under RLS; replayed toolCallId doesn't duplicate; end-of-call persists
      transcript + disposition; org-B number never sees org-A data.
- [ ] Full gate. Commit `feat(frontdesk): vapi webhook — answer, log, take messages`.

### Task A7: Runbook + PR A

**Files:** Create `docs/runbooks/vapi-frontdesk.md` — Owen's manual steps (see PR message):
Vapi account → Phone Numbers → Import (Twilio SID + auth token + +16693413343) → set the
number's server URL to `https://mallet-app-snowy.vercel.app/api/frontdesk/vapi` with secret
header → Vercel env `VAPI_WEBHOOK_SECRET` (+ redeploy note) → test-call script + what to
check in the db. Also: SMS webhook must remain pointed at `/api/webhooks/twilio` (verify
after import).

- [ ] Gate green → push → open PR A with the runbook linked. **STOP for Owen: Vapi account +
      number import + env var, then a live test call.**

---

## Phase B — it books (PR B)

### Task B1: Availability — pure slot math + reader

**Files:**
- Create: `modules/frontdesk/app/slots.ts` — pure:
  ```typescript
  export interface SlotWindow { date: string; window: "morning" | "afternoon";
    startHHMM: string; speakable: string /* "tomorrow morning, 8 to 12" */ }
  export function computeSlots(input: {
    now: Date; hours: OrgHours; visits: BookedVisit[]; crewCount: number;
    lookaheadDays: number; emergency: boolean;
  }): SlotWindow[]  // max 2 (two-slot close); emergency → today first even if tight
  ```
  Windows: open→13:00 / 13:00→close per weekday/sat/sun hours (closed days skipped);
  a window is free while overlapping visit count < crewCount.
- Create: `modules/frontdesk/infra/drizzle-availability-reader.ts` — one query: visits with
  `scheduled_date between …` (+ assignee, start, duration) + field-crew count
  (`is_field_crew`) — no N+1.
- Create: `modules/frontdesk/app/tools/check-availability.ts` — input
  `{ lane, urgency, preferred_day? }` → speak: "I've got {slot1} or {slot2} — which works?"
  (one slot → offer it + "or the office can call you with more times"; zero → take_message
  fallback framing).

- [ ] TDD slots exhaustively (closed Sunday, full morning, emergency-today, DST-safe date
      math via date strings). Commit.

### Task B2: book_visit

**Files:** Create `modules/frontdesk/app/tools/book-visit.ts`

Input (zod): `{ caller_name, phone, address, service_name, lane: repair|estimate|flat,
problem, slot_date, slot_window, urgency: normal|emergency }`.

Handler (DI: EnsureCustomer, CreateManualJob, CreateVisit, CreateTask, settings):
1. `Phone.parse` → invalid → speak re-confirm digits.
2. EnsureCustomer (name/phone/address, source "AI Front Desk", notes = problem).
3. CreateManualJob (leadId, svc = service_name, notes = problem,
   `kind: lane === "estimate" ? "estimate" : "work"`).
4. CreateVisit (jobId, scheduledDate = slot_date, scheduledStart = window start,
   durationHours from `visitScopeMinutes`/`visitRepairMinutes`, assignee null) — per the
   CreateManualJob comment, the server-side caller seeds the visit HERE.
5. urgency=emergency → CreateTask "EMERGENCY — {service} at {address}, booked {slot}" +
   result data `{ emergency: true }`.
6. Speak (the tool result is the price's provenance):
   repair → "You're booked {slot}. The visit is ${serviceFee}{, credited toward the repair}."
   estimate → "You're booked {slot} for a free estimate visit."
   flat → "You're booked {slot}. {service} is ${price} flat."
7. Ledger idempotency comes from the runner (A5); booking is additionally guarded by the
   ledger PK — no extra keys needed.

- [ ] TDD each lane (fake ports): correct kind, duration, price line; emergency task; invalid
      phone path. Integration: book_visit end-to-end creates lead+job+visit visible under RLS;
      replay doesn't double-book. Commit.

### Task B3: request_quote + confirmation SMS

**Files:**
- Create `modules/frontdesk/app/tools/request-quote.ts` — input `{ caller_name, phone,
  address?, scope_details }` → EnsureCustomer + CreateTask
  (`"Quote request — {scope_details}" `, leadId) → speak: "The office will text you a written
  quote shortly." (The task IS the office queue; estimator drafts from the lead.)
- Modify `record-call.ts` / book path: after a booked disposition, send a confirmation SMS via
  the existing notification path (one-time transactional text = TCPA-safe): reuse
  `NotificationSender` port; while A2P-blocked the logging stub degrades gracefully
  (background-path semantics — no PRECONDITION_FAILED here, but the notification row records
  `stub:logged` so it's observable).
- Register all tools in the builder's tool list with their JSON-schema parameters.

- [ ] TDD + integration; full gate; PR B. **Result: call → booked job on the real board.**

---

## Phase C — the office sees it (PR C)

### Task C1: `v1.frontdesk` router + hydrating surfaces

- `modules/frontdesk/api/frontdesk-router.ts`: `listRecent({limit ≤ 50, cursor?})`,
  `listByLead({leadId})` → `FrontdeskCallDTO` (id, when, duration, disposition, summary,
  transcript, recordingUrl, priceFlagged: boolean). Wire into `trpc/root` as `v1.frontdesk`.
- Lead timeline: an "AI answered · {disposition}" act row on the customer view reading
  `listByLead`; tapping expands transcript in-flow (no floating UI); recording plays via
  `<audio>` from recordingUrl.
- Needs Attention: emergency / quote_request / price-audit calls surface (they already create
  tasks — verify task text renders well; add disposition chip on the call rows).
- Settings → AI Front Desk card: `frontDesk` toggle (exists in settings router) + read-only
  greeting preview built from brand name (the exact firstMessage string).

- [ ] Unit + int tests for router (RLS, pagination); screenshot-verify the timeline + settings
      card (Playwright, E2E creds, dedicated port). Full gate; PR C.

---

## Phase D — hardening to the competitive bar (PR D)

### Task D1: warm transfer + after-hours + screening

- Warm transfer: add Vapi native `transferCall` tool to the builder during business hours
  only, destination = owner's verified mobile (team membership lookup); prompt rule: offer
  transfer when the caller asks for a human or the case is out of scope.
- After-hours: builder detects out-of-hours from org hours → prompt variant (stricter triage:
  true emergencies book "first thing tomorrow 7–9" or emergency-today; everything else →
  message + "the office opens at {open}").
- Spam/solicitor: prompt rule + `end_call`; disposition `screened`.

### Task D2: live test checklist + QA runbook

- `docs/runbooks/vapi-frontdesk.md` gains the 20-call test matrix (one per case-matrix row:
  gas, burst pipe, price shopper, flat-rate ask, big job, reschedule, billing, vendor, tenant,
  after-hours…), expected disposition per call, and the weekly transcript-review loop
  (listen to 5 calls, tighten one prompt rule — versioned in code, never in the dashboard).
- [ ] Execute the matrix against the live number with Owen; record results in the PR.
- [ ] Full gate; PR D.

---

## Owen's setup (blocking, ~15 minutes, before PR A can be live-tested)

1. Create a Vapi account (vapi.ai) — free tier is fine for the pilot.
2. Dashboard → Phone Numbers → Import → Twilio: number `+16693413343`, Twilio Account SID +
   Auth Token (Twilio console). Verify afterward the number's **SMS** webhook still points at
   `https://mallet-app-snowy.vercel.app/api/webhooks/twilio`.
3. On the imported number: Server URL → `https://mallet-app-snowy.vercel.app/api/frontdesk/vapi`,
   secret header value = the same random string you set as `VAPI_WEBHOOK_SECRET` in Vercel
   (Production env) — then redeploy.
4. Call the number.

## Execution notes

- Branch `feat/voice-frontdesk` (this worktree), stacked PRs merged top-down per house lesson.
- Phase A tasks A1–A3 are parallel-safe in principle but execute sequentially (single
  implementer at a time per subagent-driven-development).
- Migration numbers 0070/0071 assumed — re-check `gh pr list` at A1 execution time.
