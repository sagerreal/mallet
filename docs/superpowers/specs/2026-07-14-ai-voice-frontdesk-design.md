# AI Voice Front Desk — design spec

**Date:** 2026-07-14 · **Status:** approved direction from Owen ("implement all of this"), research-backed
**Research basis:** Avoca inbound teardown + industry sweep (adversarially verified, Jul 14 2026 — see memory `frontdesk-quote-research`)

## What this is

Mallet answers the org's business phone line with an AI front desk that **books visits and never
generates a price**. Inbound calls to the org's Twilio number are answered by a voice agent
(Vapi) whose entire configuration — greeting, services, lanes, fees, hours, service area — is
built per-call from the org's **booking playbook** in `org_settings`. The agent books real jobs
and estimate visits onto the real schedule, takes messages, captures quote requests for the
office, and every call lands in the app as a record (transcript + recording + disposition).

Competitive bar (Avoca parity for our segment): answer 100% of calls, recognize existing
customers before the first word, book into real capacity, warm-path emergencies, and give the
owner reviewable call records. Avoca structurally won't serve 1–3 tech shops ($1,000–3,500/mo,
$3M-revenue floor); this is the same capability at SMB cost (~$0.07–0.15/min ≈ $90–150/mo).

## The iron rules (from the research)

1. **The agent never generates a price.** The only dollar amounts it may speak are ones an
   owner typed into the playbook: the `serviceFee` (repair lane) and per-service `price`
   (flat lane). This is exactly Avoca's Fees/Rulesets model, Housecall Pro's set-price rule,
   and Goodcall's Quick Answer. Enforcement is layered: (a) only configured numbers exist in
   the prompt, (b) tool responses carry the only speakable price text, (c) a deterministic
   post-call **price audit** flags any spoken dollar amount not in the allowed set.
2. **Big jobs → the quote IS a visit.** Water heater replacement, repipe, remodel → book a
   free estimate visit. Never "someone will call you back" when a slot can be offered.
3. **Repair price-shoppers → fee-credit framing + two-slot close.** "The tech diagnoses and
   gives you an exact price on-site. The visit is $X, credited toward the repair — I've got
   today 2–4 or tomorrow 8–10."
4. **Off-script quote requests → speed-to-quote.** Capture scope, create the lead + a quote
   task; the agent says the office will text a written quote. (The learning estimator makes
   this fast — that connection is our differentiator over Avoca, which hands off to an
   estimating workflow it doesn't own.)
5. **Compliance first utterance.** "Thanks for calling {brand}. You're speaking with
   {brand}'s AI assistant, and this call is recorded." Covers the 13 all-party-consent
   jurisdictions, Utah's safe harbor, Maine LD 1727, and the CIPA §631 vendor-wiretap suit
   pattern (a risk to Mallet the company). The agent answers truthfully if asked whether it
   is human.
6. **Gas leak / gas smell → 911 + gas utility, no booking.** Emergencies (burst pipe, sewage
   in living space, no water) → book NOW + shut-off-valve coaching + owner alert.

## Decision: keep all three lanes

Owen asked whether the service routing should be just job + estimate. **Keep all three**
(`repair` / `estimate` / `flat`, labels unchanged). The three lanes are exactly the industry
taxonomy: `repair` is the book-the-visit default (~87–88% of inbound), `estimate` is the
free-scope-visit path for big jobs, and `flat` is the ONLY safe mechanism for the agent to
state a price — it is literally Avoca's Fees feature. Cutting `flat` would make the agent
unable to answer "how much is a drain clear?" for flat-rate shops (the plumbing norm) and
would delete our equivalent of the feature Avoca sells. No schema change needed.

## Decision: Vapi (behind a port)

Vapi over Retell for the pilot:
- **Transient assistants** — on every inbound call Vapi POSTs `assistant-request` to our
  server and we return the full assistant config built from the org's playbook. Config lives
  in OUR db; Vapi is stateless voice plumbing; multi-tenant works with one endpoint.
- **Twilio number import** — dashboard import with Account SID + auth token; voice routing
  moves to Vapi, our SMS webhook is untouched. Owen tests by calling +16693413343.
- **Cost** — $0.05/min platform + STT/LLM/TTS at cost (no BYO keys required). All-in
  $0.07–0.15/min for our stack ≈ $90–150/mo at pilot volume.
- Retell (sub-800ms P99 SLA) is the runner-up; the integration is isolated in
  `modules/frontdesk/infra` behind small ports so switching is contained.

Both are the top-of-line platforms production teams use; Vapi has the larger build ecosystem
and the exact per-call config pattern we need.

## Architecture

New hexagonal module `modules/frontdesk/{domain,app,infra,api}` (the empty stub becomes real),
following `modules/companies` layering. One public webhook endpoint; no tRPC for the voice
path (external caller), mirroring `app/api/webhooks/twilio/route.ts`.

```
Caller → Twilio number → Vapi
  Vapi → POST /api/frontdesk/vapi  (server messages, secret-verified)
    ├─ assistant-request  → BuildAssistantUseCase
    │     org by To-number → org_settings playbook + brand + hours
    │     caller recognition: From-number → lead + open work (baked into prompt)
    │     → transient assistant JSON (prompt, firstMessage, tools, voice, model)
    ├─ tool-calls         → tool use-cases inside withTenant(orgId)
    │     check_availability → two slots from job_visits + org hours
    │     book_visit         → EnsureCustomer + CreateManualJob(+kind) + CreateVisit
    │     request_quote      → EnsureCustomer + note + CreateTask (quote queue)
    │     take_message       → EnsureCustomer + CreateTask
    ├─ end-of-call-report → RecordCallUseCase
    │     persist frontdesk_calls (transcript, recording, disposition)
    │     price audit → flag; lead act + unread
    └─ status-update      → log only
```

### Data

- **`frontdesk_calls`** (new, RLS): id, org_id, lead_id (nullable FK composite), vapi_call_id
  (unique), from/to numbers, started/ended, ended_reason, transcript text, messages jsonb,
  recording_url, summary, disposition (`booked_job | booked_estimate | quote_request |
  message | emergency | screened | no_action`), price_audit jsonb (flagged amounts),
  created_at. Soft-delete column for consistency.
- **`frontdesk_tool_invocations`** (new, RLS): org_id, vapi_call_id, tool_call_id (PK with
  org), tool name, result jsonb, created_at. Idempotency ledger — Vapi retries tool webhooks;
  a replayed tool_call_id returns the stored result and never double-books.
- **`jobs.kind`** (new column): `'work' | 'estimate'`, default `'work'`. An estimate-lane
  booking creates a job with `kind='estimate'` + one visit sized by `visitScopeMinutes`; it
  rides the existing board/My-Day/assign flows unchanged. (Also unblocks fixing the office's
  store-only `evisits` — booked estimate visits currently vanish on refresh; out of scope
  here beyond the column, noted as follow-on.)

### Tenant safety

Org id ALWAYS from the To-number lookup (`DrizzleOrgByNumberReader`, the privileged path the
Twilio webhook already uses) → everything else inside `withTenant(orgId)`. Tool handlers get a
synthetic office `Principal` (voice agent acts as office staff). New tables get hand-written
`ENABLE`+`FORCE` RLS + composite FKs, per house rules.

### The voice tool contract (guardrails live here)

Tools are defined transiently in the assistant-request response; every tool's server URL is
the same webhook. Parameters are zod-validated at the boundary; handlers are idempotent by
`tool_call_id`. `check_availability` returns AT MOST two slots (two-slot close). `book_visit`
returns a confirmation script including the ONLY speakable price line, sourced from the
playbook — the tool result is the price's provenance. Phone numbers are confirmed
digit-by-digit and addresses read back (prompt rules; entity capture is voice AI's weakest
link).

### Observability & ops (competitive with Avoca's ops tooling, scaled down)

Structured logs with `vapiCallId` + `orgId` on every handler. Every call persisted with
transcript + recording. Price-audit failures and emergencies surface as tasks/unread. The
office reviews calls from the lead timeline (PR C). Weekly transcript review is the tuning
loop for the first months (documented in the runbook).

### Config & flags

Env (global): `VAPI_WEBHOOK_SECRET` (required to enable the route), `VAPI_API_KEY` (optional,
future programmatic setup). Per-org flag: `org_settings.frontDesk` gates answering — false →
the endpoint returns a polite decline assistant (one sentence, hangs up). Voice/model/timeouts
are named constants in one file (`modules/frontdesk/infra/vapi-defaults.ts`), not magic
values.

### Error handling

Webhook returns 401 unverified, 200 with decline assistant on unconfigured org, 5xx on
processing failure (Vapi retries tools; idempotency ledger absorbs replays). Tool failures
return a spoken-fallback result ("I couldn't grab the schedule just now — I'll have the office
text you two times") and create a take_message task — the caller is NEVER dead-ended
(no-silent-failure rule, degradation mirrors the notification stub pattern). All external
calls (none in v1 — Vapi calls US) need no circuit breaker; the DB work uses existing tx
boundaries.

## Phases (each lands as a PR with the full gate + adversarial review)

- **PR A — the number answers.** Migrations (2 tables + jobs.kind + RLS), config, webhook
  route (secret verify → org resolve → dispatch), assistant builder (playbook-grounded prompt,
  caller recognition, compliance first message, emergency/gas rules), `take_message` tool,
  end-of-call persistence + price audit + lead act. Manual runbook: Vapi account, import
  number, point server URL, set secret. **Result: call the number → grounded AI answers,
  takes messages, call logged.**
- **PR B — it books.** `check_availability` (org-hours + job_visits capacity, two slots),
  `book_visit` (repair→job, estimate→kind-estimate job, flat→job + price line; idempotent),
  `request_quote` (scoped lead + quote task), booking-confirmation SMS via existing
  notification path (degrades while A2P is blocked). **Result: full phone booking.**
- **PR C — the office sees it.** Calls in the app: lead-timeline act with transcript/recording
  (in-flow expand, no floating UI), Needs-Attention entries for emergency/quote-request/
  message/price-audit, disposition chips. Front-desk settings card: enable toggle + greeting
  preview.
- **PR D — hardening.** Warm transfer to owner's verified mobile (Vapi transferCall, business
  hours only), after-hours triage variant of the prompt, spam/solicitor screen-out, 20-call
  test checklist executed against the live number, latency/QA runbook.

## Testing

Test pyramid: unit (prompt builder, lane matcher, slot computation, zod schemas, price audit,
use-cases with fake repos) · integration (webhook route against live RLS db: assistant-request
shape, book_visit creates lead+job+visit, idempotent replay, cross-org isolation) · E2E =
scripted live calls to the Twilio number (PR D checklist). Coverage gate 80/75 holds.

## Out of scope (deliberate)

Answer-mode carrier forwarding ("only when I miss a call" — needs carrier conditional-forward
setup on a real business line; the pilot number IS the business line), outbound calls,
web-chat channel, multi-language, Retell adapter, per-org Vapi keys, CSR coaching/QA scoring
dashboards, membership pitching.
