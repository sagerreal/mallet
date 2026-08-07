# Work Board (Office Today Pipeline Kanban) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Office Today pane's flow-strip tiles + OK-queue feed with a four-column work Kanban (New requests → Estimates & quotes → Jobs → Billing) where prepared reminder texts live directly on the cards with one-click send, keeping the big greeting hero and adding a ghost-card first-run state.

**Approved design:** `~/Downloads/prospecting/pipeline-kanban-prototype.html` (interactive mockup, both states — use its "See a brand-new shop" toggle for the first-run reference). Design decisions already locked: no filter bar, no route legend, no column descriptions, no overdue banner, no fake dollars in the empty state, big hero card stays.

**Architecture:** The board is a **client composition over existing per-module tRPC worklist procedures** — no cross-module server aggregator (this repo's boundary rule; see the header comment in `features/home/use-home-pipe.ts` which argues explicitly against a four-module endpoint). New pure derivation in `features/board/` maps existing query results into `BoardItem`s; the existing OK-queue drafting/sending primitives (`draftFor`, `dispatchOkSend`, `commitOkSend`) are reused unchanged for on-card texts. Backend work is limited to hardening the send path (idempotency + per-org rate limit) and two missing indexes.

**Tech Stack:** Next 16 App Router (client components), tRPC v11 (`v1.*`), Drizzle/Postgres (RLS, org-scoped), Zustand store (dollars) + React Query (DTO cents), Vitest 4 (unit + `*.int.test.ts`), Playwright (`e2e/`), one CSS system (`app/prototype.css` tokens — no Tailwind).

## Global Constraints

- **Module boundaries:** hexagonal `modules/<domain>/{domain,app,infra,api}`; routers thin, use-cases DI'd classes returning `Result`, repositories org-scoped (`new DrizzleXRepository(ctx.tx, ctx.principal.orgId)`). Never put one module's logic in another.
- **DTO ≠ domain** (binding house rule): every procedure has a zod `.output(...)`; DTO mappers live in `api/`.
- **Money:** integer cents in DB/domain/DTO (`{cents, currency:"USD"}`); the Zustand store is DOLLARS; cents→dollars conversion lives ONLY in `lib/store/dto-mapper.ts` and the existing per-feature mappers that follow it (e.g. `toStoreLead`).
- **Tenant isolation:** org id NEVER from client input; `orgTx` middleware + RLS + explicit `eq(orgId)` in repos. Don't touch that stack.
- **Pagination/caps:** worklists are capped and report the cap (`truncated`) — the `followUps` / rail-columns precedent. Never OFFSET.
- **No N+1:** batched name resolution per page (one `findByIds` per list), correlated subqueries only where already established.
- **Migrations are single-writer:** before `npm run db:generate`, check `gh pr list --search "path:shared/db/migrations"` for in-flight migration PRs; RLS is hand-written as a separate numbered file; finish with `npm run db:verify`.
- **Honest sends:** outbound SMS is gated by A2P (`isSmsA2pActive`); the UI must never show "sent" implying delivery it doesn't have. `messages` rows are delivery-corrected by the Twilio status webhook; keep using that ledger.
- **Twilio calls:** 10s timeout, circuit breaker, NEVER retried (no per-message idempotency at Twilio). Idempotency must be OUR ledger claim, before the send.
- **Frontend system:** tokens from `app/prototype.css` `:root` scales (`--space-*`, `--type-*`, `--radius-*`) — no magic numbers; primitives from `components/ui/` (`Button`, `Badge`, `Card`); variants via props, never per-surface style hacks; `.rowopen` a11y pattern for clickable cards (container `onClick`, focusable child button, `stopPropagation`) per `docs/design-system.md` §3.
- **Hydration-flash law:** no store/query-derived number renders before its query settles — gate with `lib/first-run.ts` predicates + the same-query-key dedupe convention (`lib/store/hydrator-config.ts`).
- **Empty/loading/error are first-class:** `ListLoading`, `LoadFailed`, `FirstRunEmptyState` — every new surface wires all three.
- **Tests:** unit tests beside the file (in-memory fakes, `FixedClock`); integration as `*.int.test.ts` (skip without DB env); coverage gate 80/75. Never import a module barrel in a unit test (pulls the config validator).
- **Every action → visible feedback ≤100ms:** optimistic commit + exact undo (the `commitOkSend` pattern), `WriteErrorToast` on failure.
- **Copy register:** functional, not chatty; facts or actions only, never explanations (locked during mockup review).

## Resolved decisions (Owen, Aug 7)

1. **`/pipeline` is REMOVED in this build** (Task 8): route becomes a redirect stub to `/dashboard`, its nav entries go, `features/pipeline/` is deleted after its reusable hooks move into `features/board/`.
2. **No feature flag.** Task 7 hard-swaps the Today pane: `HomePipe` + `OkQueue` are deleted in the same PR, not kept behind a flag.

Deferred by choice (YAGNI, documented here so nobody "helpfully" adds them): drag-and-drop (`docs/prototype-interaction-map.md:883` — columns move when reality moves), board filters/search (Artie is the search surface), a cached `estimates.total_cents` column (quote totals keep the existing correlated-subquery path used by `quoting.list`/`followUps`; revisit only if board latency says so — `modules/quoting/infra/estimate-sorts.ts` documents the tradeoff), server-side metrics (repo has none; log lines only).

## File Structure

```
NEW
features/board/types.ts              — BoardItem/BoardColumn/WorkBoardData + column ids (pure types)
features/board/derive.ts             — pure mappers: query rows → BoardItems, ranking, sums
features/board/derive.test.ts        — unit tests for every mapper + ranking rule
features/board/use-work-board.ts     — composition hook (existing queries → WorkBoardData)
features/board/use-work-board.test.tsx — hook test with mocked tRPC
features/board/work-board.tsx        — the 4-column board (groups, skeleton, first-run ghosts)
features/board/work-board.test.tsx   — render tests: pinning, ghosts, a11y contract
features/board/board-card.tsx        — one card incl. inline draft + Send/Change
features/board/board-card.test.tsx   — send gating (A2P), open-modal wiring
features/board/ghosts.ts             — GHOST_CARDS fixture (EXAMPLE cards, no dollars)
features/home/send-block.tsx         — SendBlock extracted from pipeline board-cards (shared)
shared/db/migrations/00xx_*.sql      — two indexes; messages.idempotency_key + partial unique

MOVED (Task 8)
features/pipeline/use-rail-columns.ts → features/board/use-rail-columns.ts
features/pipeline/working.ts          → features/board/working.ts

DELETED
features/home/home-pipe.tsx, features/home/use-home-pipe.ts, features/home/ok-queue.tsx (Task 7)
features/pipeline/ (rest of it), /pipeline nav links; route becomes a redirect stub (Task 8)

MODIFIED
shared/db/schema/estimates.ts        — + estimates_org_status_idx
shared/db/schema/leads.ts            — + leads_org_stage_idx
shared/db/schema/messages.ts         — + idempotency_key column + partial unique index
modules/messaging/domain/message-repository.ts     — claimOutbound/markSent/markFailed
modules/messaging/infra/drizzle-message-repository.ts — implement the above
modules/messaging/app/send-message.ts — claim-first idempotent flow (queued→sent/failed)
modules/messaging/app/send-message.test.ts — new cases
modules/messaging/api/messaging-router.ts — idempotencyKey input + per-org rate limit
modules/messaging/api/messaging-router.int.test.ts — duplicate-claim + limiter cases
features/home/send.ts                — dispatchOkSend gains idempotencyKey param
features/pipeline/board-cards.tsx    — import SendBlock from features/home/send-block
app/(office)/dashboard/page.tsx      — TodayPane: hard swap to the board, first-run wiring
features/home/handoff-note.tsx       — hero copy: "N items · M texts ready to send."
app/prototype.css                    — .kgrp group label, .kmsg on-card draft (tokens only)
e2e/golden.spec.ts                   — board flow assertions
```

---

### Task 1: Missing indexes (estimates status, leads stage)

The board leans on `quoting.list({status})` and lead views; `estimates` has NO index on `(org_id, status)` and `leads` none on `(org_id, stage)` (verified against `shared/db/schema/estimates.ts` / `leads.ts` — jobs and invoices are already covered by `jobs_org_status_idx` and `invoices_org_status_due_idx`).

**Files:**
- Modify: `shared/db/schema/estimates.ts` (index block), `shared/db/schema/leads.ts` (index block)
- Create: generated `shared/db/migrations/00xx_<name>.sql`

**Interfaces:** none (pure DDL). Later tasks assume these exist but never reference them by name.

- [ ] **Step 1: Check the migration ledger is clear**

Run: `gh pr list --state open --search "migrations" --repo sagerreal/mallet-app` — if any open PR touches `shared/db/migrations/`, STOP and coordinate (single-writer rule; see `docs/runbooks/` migration notes).

- [ ] **Step 2: Add index definitions to the two schema files**

In `shared/db/schema/estimates.ts`, inside the existing table `(t) => [...]` index array, following the exact style of `estimates_org_sent_idx`:

```ts
index("estimates_org_status_idx").on(t.orgId, t.status),
```

In `shared/db/schema/leads.ts`, same pattern:

```ts
index("leads_org_stage_idx").on(t.orgId, t.stage),
```

- [ ] **Step 3: Generate + verify**

Run: `npm run db:generate` → one new numbered SQL file with two `CREATE INDEX` statements and a journal entry. Then `npm run db:verify`. Expected: clean.

- [ ] **Step 4: Prove the migration applies**

Run: `npm run test:int -- modules/customers/api/lead-views.int.test.ts` (skips without DB env; if you have `.env.local`, it exercises the lead views against the migrated schema). Expected: PASS or SKIP, no failures.

- [ ] **Step 5: Commit**

```bash
git add shared/db/schema/estimates.ts shared/db/schema/leads.ts shared/db/migrations/
git commit -m "perf: index estimates(org,status) and leads(org,stage) for board worklists"
```

---

### Task 2: Idempotent `messaging.send` (claim-first ledger)

`SendMessageUseCase` currently generates `msg-${randomUUID()}` per call — a double-click sends the customer two texts. Copy the claim-first pattern from `modules/notifications/app/send-notification.ts` (claims `notifications(org_id, idempotency_key)` with `ON CONFLICT DO NOTHING` BEFORE sending). `messages.status` already has the needed lifecycle values (`queued/sent/failed`).

**Files:**
- Modify: `shared/db/schema/messages.ts`, `modules/messaging/domain/message-repository.ts`, `modules/messaging/infra/drizzle-message-repository.ts`, `modules/messaging/app/send-message.ts`, `modules/messaging/app/send-message.test.ts`, `modules/messaging/api/messaging-router.ts`
- Create: migration via `db:generate`; `modules/messaging/api/messaging-router.int.test.ts` cases

**Interfaces:**
- Consumes: `TwilioSmsSender.send(cmd): Promise<Result<NotificationReceipt, ExternalServiceError>>` (unchanged); `isSmsA2pActive(tx, orgId)` (unchanged).
- Produces: `v1.messaging.send` input gains `idempotencyKey?: string` (8–64 chars). Repository gains:

```ts
// modules/messaging/domain/message-repository.ts
claimOutbound(cmd: ClaimOutboundCmd): Promise<{ message: Message; created: boolean }>;
markSent(id: string, providerSid: string | null): Promise<void>;
markFailed(id: string, errorCode: string | null): Promise<void>;
// ClaimOutboundCmd = { leadId: string; to: string; body: string; idempotencyKey: string }
```

Task 6 will pass `idempotencyKey` from the client; its format is `"<okItemKey>-fu<stage>"` (e.g. `"okq-est_123-fu1"`).

- [ ] **Step 1: Schema — idempotency column + partial unique**

In `shared/db/schema/messages.ts` add to the table:

```ts
idempotencyKey: text("idempotency_key"),
```

and to the index array (partial unique — NULL keys stay unconstrained, matching `payments_org_idem_uidx` style):

```ts
uniqueIndex("messages_org_idem_uidx")
  .on(t.orgId, t.idempotencyKey)
  .where(sql`idempotency_key IS NOT NULL`),
```

Run `npm run db:generate` (ledger check first, as Task 1 Step 1) then `npm run db:verify`.

- [ ] **Step 2: Write the failing unit test**

In `modules/messaging/app/send-message.test.ts`, alongside the existing cases (reuse its in-memory fake repo + fixed clock — extend the fake with a `Map<string, Message>` keyed by idempotency key for `claimOutbound`):

```ts
it("sends once for the same idempotency key", async () => {
  const { useCase, sender } = makeUseCase(); // existing helper in this file
  const cmd = { leadId: LEAD_ID, body: "hi", idempotencyKey: "okq-e1-fu1" };
  const first = await useCase.exec(cmd);
  const second = await useCase.exec(cmd);
  expect(sender.calls).toHaveLength(1);
  expect(second.ok && second.value.id).toBe(first.ok && first.value.id);
});

it("marks the claim failed when Twilio rejects, and does not resend on retry", async () => {
  const { useCase, sender } = makeUseCase({ senderFails: true });
  const cmd = { leadId: LEAD_ID, body: "hi", idempotencyKey: "okq-e1-fu1" };
  const first = await useCase.exec(cmd);
  expect(first.ok).toBe(false);
  const second = await useCase.exec(cmd);   // same key: returns the failed row, no second Twilio call
  expect(sender.calls).toHaveLength(1);
  expect(second.ok).toBe(false);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- modules/messaging/app/send-message.test.ts` — Expected: FAIL (`claimOutbound is not a function` or equivalent).

- [ ] **Step 4: Implement**

`send-message.ts` new flow (keep the class + DI shape; keep all existing precondition checks — twilio number, A2P active, destination phone, creds — BEFORE the claim so precondition failures never burn a key):

```ts
const key = cmd.idempotencyKey ?? `msg-${this.ids.next()}`;   // no key → today's behavior
const { message, created } = await this.repo.claimOutbound({
  leadId: cmd.leadId, to, body: cmd.body, idempotencyKey: key,
});
if (!created) return ok(message);            // duplicate: return the prior row, sent or failed
const sent = await this.sender.send(...);
if (!sent.ok) {
  await this.repo.markFailed(message.id, codeOf(sent.error));
  return err(sent.error);
}
await this.repo.markSent(message.id, sent.value.externalId ?? null);
return ok({ ...message, status: "sent" });
```

Drizzle impl: `claimOutbound` = `INSERT ... ON CONFLICT (org_id, idempotency_key) DO NOTHING RETURNING *`; on empty return, `SELECT` the existing row by `(orgId, idempotencyKey)`. `created` = whether the insert returned a row. Status starts `"queued"`.

Router: add to the `send` input schema `idempotencyKey: z.string().min(8).max(64).optional()`, pass through to the command. Output schema unchanged (`messageDTO`).

- [ ] **Step 5: Run tests**

Run: `npm test -- modules/messaging` — Expected: all PASS (old cases too: keyless path must still work).

- [ ] **Step 6: Integration test — parallel duplicate claim**

Add to `modules/messaging/api/messaging-router.int.test.ts` (create the file following the harness in `modules/notifications/api/notification-router.int.test.ts`: own `postgres()` admin connection, two seeded orgs, `appRouter.createCaller`, `hasDb ? describe : describe.skip`):

```ts
it("two concurrent sends with one key produce one message row", async () => {
  const key = "okq-int-fu1";
  const [a, b] = await Promise.allSettled([
    caller.v1.messaging.send({ leadId, body: "hi", idempotencyKey: key }),
    caller.v1.messaging.send({ leadId, body: "hi", idempotencyKey: key }),
  ]);
  const rows = await admin`select id from messages where org_id = ${orgA} and idempotency_key = ${key}`;
  expect(rows).toHaveLength(1);
});
```

(In the int environment Twilio creds are absent, so both calls fail on `PRECONDITION_FAILED` before claiming OR the send fails and one row exists as `failed` — assert on row count ≤ 1 and equal error codes; the row-count uniqueness is the contract.)

Run: `npm run test:int -- modules/messaging` — Expected: PASS or SKIP.

- [ ] **Step 7: Commit**

```bash
git add shared/db/schema/messages.ts shared/db/migrations/ modules/messaging features/
git commit -m "feat: idempotent messaging.send via claim-first message ledger"
```

---

### Task 3: Per-org rate limit on `messaging.send`

One-click sends from board cards need a server-side ceiling (there is none today — verified). Use the existing `FixedWindowLimiter` from `platform/resilience` (already used by the public quote/invoice routes — read `app/api/public/quote/[token]/route.ts` for the exact call shape before writing code).

**Files:**
- Modify: `modules/messaging/api/messaging-router.ts`
- Test: extend `modules/messaging/api/messaging-router.int.test.ts` + a unit test beside the router if the limiter is factored into a helper

**Interfaces:**
- Consumes: `FixedWindowLimiter` from `platform/resilience/index.ts`.
- Produces: `v1.messaging.send` throws `TRPCError({ code: "TOO_MANY_REQUESTS" })` above 30 sends/org/minute. Constant: `SEND_LIMIT_PER_MIN = 30` at the top of the router file (no magic numbers).

- [ ] **Step 1: Write the failing test**

```ts
it("rate limits the 31st send in a minute per org", async () => {
  for (let i = 0; i < 30; i++) {
    await caller.v1.messaging.send({ leadId, body: "hi", idempotencyKey: `rl-${i}-xxxx` }).catch(() => {});
  }
  await expect(
    caller.v1.messaging.send({ leadId, body: "hi", idempotencyKey: "rl-30-xxxx" })
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:int -- modules/messaging` → FAIL (no error thrown).

- [ ] **Step 3: Implement**

Module-level `const sendLimiter = new FixedWindowLimiter(SEND_LIMIT_PER_MIN, 60_000)` keyed by `ctx.principal.orgId` at the top of the `send` resolver, before any work. Per-warm-instance is acceptable (documented limitation, same as the public routes). Log a structured warning on limit: `logger.warn({ orgId }, "messaging.send rate limited")` — the logger already redacts.

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: per-org rate limit on messaging.send"`

---

### Task 4: Board types + pure derivation

All bucketing/ranking logic is pure and unit-tested — no React, no store, no queries. This is the file a reviewer reads to know exactly what appears in which column and why.

**Files:**
- Create: `features/board/types.ts`, `features/board/derive.ts`
- Test: `features/board/derive.test.ts`

**Interfaces:**
- Consumes: `Lead`, `Estimate`, `Invoice`, `Job` store types from `lib/store/types.ts` (dollars); `GettingRow`, `RailRow` from `features/quotes/derive.ts` and `features/pipeline/working.ts` (READ THOSE FILES FIRST — reuse their fields, do not re-derive quote staleness/cooling); `OkItem` from `features/home/derive.ts`.
- Produces (exact contract for Tasks 5–8):

```ts
// features/board/types.ts
export type BoardColumnId = "requests" | "quoting" | "jobs" | "billing";
export type BoardItemKind = "lead" | "estimate" | "job" | "invoice";
export type BoardTone = "attention" | "waiting" | "active" | "overdue";

export interface BoardItem {
  key: string;              // stable: `bl-<leadId>` | `be-<estId>` | `bj-<jobId>` | `bi-<invId>`
  kind: BoardItemKind;
  column: BoardColumnId;
  refId: string;            // modal target id for `kind`
  leadId?: string;
  name: string;             // customer name
  service: string;          // job/estimate/invoice title
  valueDollars: number;     // 0 = unpriced (render as blank, never "$0")
  stateLabel: string;       // "Reminder due" | "Scheduled" | ...
  tone: BoardTone;
  needsAction: boolean;
  ageLabel: string;         // "Sent 4d ago · viewed"
  ok?: OkItem;              // present ⇒ prepared text renders on the card
}

export interface BoardColumn {
  id: BoardColumnId;
  title: string;            // "New requests" | "Estimates & quotes" | "Jobs" | "Billing"
  items: BoardItem[];       // needsAction pinned first (rank rule below)
  count: number;            // server count when available, else items.length
  valueDollars: number;
  truncated: boolean;
}

export interface WorkBoardData {
  columns: [BoardColumn, BoardColumn, BoardColumn, BoardColumn];
  needsYou: { count: number; valueDollars: number; textsReady: number };
  isFetched: boolean;
  isError: boolean;
}
```

```ts
// features/board/derive.ts — all exported, all pure
export function requestItem(lead: Lead): BoardItem;
export function quotingItems(getting: GettingRow[], out: RailRow[], oksByEstId: Map<string, OkItem>): BoardItem[];
export function jobItem(job: Job): BoardItem;                       // work-kind jobs only; caller filters
export function billingItems(needsInvoiceJobs: Job[], invoices: Invoice[], oksByInvId: Map<string, OkItem>): BoardItem[];
export function rankItems(items: BoardItem[]): BoardItem[];         // needsAction desc → valueDollars desc → name asc
export function columnOf(id: BoardColumnId, title: string, items: BoardItem[], opts?: { serverCount?: number; serverDollars?: number; truncated?: boolean }): BoardColumn;
export function needsYouOf(columns: BoardColumn[]): WorkBoardData["needsYou"];
```

Bucketing rules (the spec, verbatim from the approved mockup):
- **requests**: intake leads (no estimate, no visit — the server's `view:"intake"` predicate is the source of truth). All `needsAction: true`, tone `attention`, stateLabel `"Needs response"`.
- **quoting**: `GettingRow`s (walkthrough booked / scope returned / draft in progress — tone from row state, needsAction when the office owes the next move) + `RailRow`s (sent quotes; `needsAction` ⇔ an `OkItem` exists for the estimate, stateLabel `"Reminder due"`, else `"Awaiting customer"`, tone `waiting`).
- **jobs**: work-kind jobs, `status` `scheduled`/`in_progress`; `needsAction` ⇔ no visit scheduled (the `needsSlot` server view), stateLabel `"Needs scheduling"`; scheduled → `"Scheduled"` + visit label via the existing `visitLabel` helper (`features/home/derive.ts`); in-field → tone `active`, `"On site"`.
- **billing**: needs-invoice jobs (`needsAction`, `"Ready to bill"`) + draft invoices (`needsAction`, `"Draft invoice"`) + sent/partial (passive, `"Awaiting payment"`) + overdue (`needsAction`, tone `overdue`, `"Overdue"`, `ok` attached).
- `needsYou.textsReady` = count of items with `ok` present and `needsAction`.

- [ ] **Step 1: Write the failing tests** (`features/board/derive.test.ts`, plain Vitest, fixture literals — no store, no barrels):

```ts
import { describe, expect, it } from "vitest";
import { rankItems, columnOf, needsYouOf, billingItems } from "./derive";

const item = (over: Partial<BoardItem>): BoardItem => ({
  key: "bj-1", kind: "job", column: "jobs", refId: "1", name: "A", service: "s",
  valueDollars: 0, stateLabel: "Scheduled", tone: "waiting", needsAction: false,
  ageLabel: "", ...over,
});

it("pins needs-action first, then value desc, then name", () => {
  const ranked = rankItems([
    item({ key: "a", needsAction: false, valueDollars: 900 }),
    item({ key: "b", needsAction: true, valueDollars: 100 }),
    item({ key: "c", needsAction: true, valueDollars: 500 }),
  ]);
  expect(ranked.map(i => i.key)).toEqual(["c", "b", "a"]);
});

it("column dollars ignore unpriced items and prefer server figures", () => {
  const col = columnOf("jobs", "Jobs", [item({ valueDollars: 0 }), item({ key: "x", valueDollars: 250 })]);
  expect(col.valueDollars).toBe(250);
  const withServer = columnOf("jobs", "Jobs", [], { serverDollars: 6014, serverCount: 4 });
  expect(withServer.valueDollars).toBe(6014);
  expect(withServer.count).toBe(4);
});

it("overdue invoices carry their OkItem and count as texts ready", () => {
  const ok = { key: "oki-i1", kind: "invoice-overdue", value: 1325 } as OkItem;
  const items = billingItems([], [overdueInvoiceFixture], new Map([["i1", ok]]));
  expect(items[0]).toMatchObject({ tone: "overdue", needsAction: true, ok });
  expect(needsYouOf([columnOf("billing", "Billing", items)]).textsReady).toBe(1);
});
```

Plus one test per mapper: `requestItem` (attention/Needs response), `quotingItems` (RailRow without OkItem → passive "Awaiting customer"), `jobItem` (needsSlot vs scheduled vs in-field tones).

- [ ] **Step 2: Run to verify failure** — `npm test -- features/board` → FAIL (module not found).

- [ ] **Step 3: Implement `types.ts` + `derive.ts`** to the contract above. Read `features/quotes/derive.ts` (`RailRow`, `coolOf`), `features/pipeline/working.ts` (`IntakeRow`, `byStalledThenAge`), `features/home/derive.ts` (`OkItem`, `visitLabel`, `firstName`) first and reuse their helpers rather than duplicating date math. Keep every function under ~20 lines; extract label helpers.

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: board types and pure column derivation"`

---

### Task 5: `useWorkBoard()` composition hook

**Files:**
- Create: `features/board/use-work-board.ts`
- Test: `features/board/use-work-board.test.tsx`

**Interfaces:**
- Consumes: `useRailColumns()` (`features/pipeline/use-rail-columns.ts` — gives `getting`, `out`, `outSum`, `outTruncated`, `isFetched`, `isError`), `useOkQueue()` (`features/home/use-ok-queue.ts` — gives `items: OkItem[]`, dismissed already filtered), `api.v1.customers.list({ view: "intake", limit: 100, sort: "created" })`, `api.v1.jobs.list({ activeOnly: true, limit: 100 })`, `api.v1.jobs.list({ view: "needsInvoice", limit: 50 })`, `api.v1.invoicing.list({ view: "draft" | "sent" | "partial" | "over", limit: 50 })`, `api.v1.jobs.viewCounts({ today })` (has `todayCents`, `needsSlotCents`, `needsInvoiceCents`), `api.v1.invoicing.totals()`; `toStoreLead` (`features/customers/leads-hydrator.tsx:32`) for lead DTO→store mapping (dollars conversion stays in existing mappers).
- Produces: `export function useWorkBoard(): WorkBoardData` — the ONLY data source Tasks 6–8 use.

Notes for the implementer:
- `today` input uses the client's local `YYYY-MM-DD` (repo convention — no org timezone; see `modules/jobs/infra/job-views.ts` header).
- React Query dedupes the rail/ok-queue queries against `/pipeline` and the legacy pane — reuse their exact query keys/options; do NOT invent new option combos for the same procedure (hydrator-config convention).
- `isFetched` = every source fetched; `isError` = any source errored with nothing cached. Column `truncated` from each source's cap (`items.length === limit` or the source's own `truncated` flag).
- Estimate-kind jobs must NOT appear in the jobs column (`job.kind === "work"` filter); they surface through `GettingRow`s.
- Build `oksByEstId` / `oksByInvId` maps once from `useOkQueue().items` (`kind === "quote-viewed"` → `item.estimate.id`; `kind === "invoice-overdue"` → `item.invoice.id`).

- [ ] **Step 1: Write the failing hook test** — mock the tRPC hooks module the way `features/home` tests do (see `features/home/ok-queue-drafts.test.ts` for the mocking idiom used in this repo; if none mocks query hooks, test through a thin seam: extract `assembleBoard(inputs): WorkBoardData` as a pure function in `use-work-board.ts` and unit-test THAT — the React wrapper then contains zero logic):

```ts
it("assembles four columns in fixed order with needs-you sums", () => {
  const board = assembleBoard(fixtureInputs); // 2 intake, 1 getting, 1 out+ok, 2 jobs, 1 overdue+ok
  expect(board.columns.map(c => c.id)).toEqual(["requests", "quoting", "jobs", "billing"]);
  expect(board.needsYou).toEqual({ count: 5, valueDollars: 21881, textsReady: 2 });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** — `assembleBoard` pure + `useWorkBoard` wrapper (queries + `useMemo`). Wrapper under 60 lines; all logic in `assembleBoard`/Task-4 functions.
- [ ] **Step 4: Run tests** — `npm test -- features/board` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: useWorkBoard composition over existing worklist queries"`

---

### Task 6: Board UI — `WorkBoard`, `BoardCard`, shared `SendBlock`

The kanban CSS already exists (`app/prototype.css:753-800`: `.board`, `.col`, `.col-head`, `.kcard`, `.cardghost`, `.cardacts`, `.cardsent`, enter/leave animations at :922) and `features/pipeline/board-cards.tsx` already implements one-click send from a card (its internal `SendBlock` + `dispatchOkSend` + `commitOkSend`). This task extracts and reuses — it does not reinvent.

**Files:**
- Create: `features/home/send-block.tsx` (extraction), `features/board/work-board.tsx`, `features/board/board-card.tsx`
- Modify: `features/pipeline/board-cards.tsx` (import the extracted `SendBlock`), `features/home/send.ts` (`dispatchOkSend` gains the idempotency key), `app/prototype.css` (two small classes)
- Test: `features/board/work-board.test.tsx`, `features/board/board-card.test.tsx`

**Interfaces:**
- Consumes: `WorkBoardData` (Task 5), `draftFor(item, ctx)` / `softDraftFor` (`features/home/drafts.ts`), `commitOkSend(item, text): () => void` + `dispatchOkSend` (`features/home/send.ts`), `useOpenModal()` + `MODAL` (`lib/store/app-store.ts`, `lib/store/modal-ids.ts`), `Badge`/`Button` (`components/ui/`), A2P readiness from the store (the slice `A2pHydrator` fills — read `features/**/a2p*` and `lib/store/slices/` to get the exact selector; gate is `a2p.status === "active"`).
- Produces:

```ts
// features/board/work-board.tsx
export function WorkBoard(props: {
  data: WorkBoardData;
  firstRun: boolean;                       // Task 8 renders ghosts when true
  onOpen(item: BoardItem): void;           // dashboard wires modal opening
}): JSX.Element;
export function WorkBoardSkeleton(): JSX.Element;

// features/board/board-card.tsx
export function BoardCard(props: {
  item: BoardItem;
  smsReady: boolean;                       // false ⇒ Send disabled with reason
  onOpen(item: BoardItem): void;
}): JSX.Element;

// features/home/send.ts (signature change — update ALL call sites)
export async function dispatchOkSend(leadId: string, body: string, idempotencyKey?: string): Promise<void>;
```

- [ ] **Step 1: Extract `SendBlock`**

Move the internal `SendBlock` from `features/pipeline/board-cards.tsx` into `features/home/send-block.tsx` **unchanged** (props exactly as they are today), export it, update the pipeline import. Run `npm test -- features/pipeline` — the existing `board-cards.test.tsx` must still PASS before anything else happens. Commit: `refactor: extract SendBlock for reuse across boards`.

- [ ] **Step 2: Thread the idempotency key**

`dispatchOkSend(leadId, body, idempotencyKey?)` → passes `idempotencyKey` to `trpcVanilla.v1.messaging.send.mutate`. Key format at call sites: `` `${item.key}-fu${(item.estimate?.followUpStage ?? item.invoice?.followUpStage ?? 0) + 1}` `` — resend after a real state change gets a new key; a double-click does not. Update the two existing callers (`ok-queue.tsx`, `board-cards.tsx` via SendBlock) and keep the no-key fallback. Run `npm test -- features/home` → PASS. Commit.

- [ ] **Step 3: Write failing component tests**

```tsx
// features/board/work-board.test.tsx
it("renders four columns with needs-action groups pinned first", () => {
  render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);
  expect(screen.getAllByRole("region", { name: /column/i })).toHaveLength(4);
  const labels = screen.getAllByText(/needs action/i);
  expect(labels.length).toBeGreaterThan(0); // group label present where attention items exist
});

// features/board/board-card.test.tsx
it("shows the prepared text on the card and sends once on click", async () => {
  render(<BoardCard item={reminderItem} smsReady onOpen={vi.fn()} />);
  expect(screen.getByText(/ready to send/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /send/i }));
  expect(sendSpy).toHaveBeenCalledTimes(1);
});

it("disables Send when texting is not set up", () => {
  render(<BoardCard item={reminderItem} smsReady={false} onOpen={vi.fn()} />);
  expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
});

it("opens the right record modal per kind", async () => {
  const onOpen = vi.fn();
  render(<BoardCard item={jobItemFixture} smsReady onOpen={onOpen} />);
  await user.click(screen.getByRole("button", { name: jobItemFixture.name }));
  expect(onOpen).toHaveBeenCalledWith(jobItemFixture);
});
```

- [ ] **Step 4: Run to verify failure** — FAIL (components missing).

- [ ] **Step 5: Implement**

`BoardCard` — one `.kcard` per item, following the `.rowopen` a11y contract exactly as `features/pipeline/board-cards.tsx:171-180` does (container `onClick={() => onOpen(item)}`, focusable `<button className="cname rowopen">` child, `stopPropagation` on inner controls). Amount right-aligned mono; `Badge` tone mapping: `attention→"amber"`, `overdue→"red"`, `active→"blue"`, `waiting→"neutral"`. When `item.ok`: render `SendBlock` (draft from `draftFor(item.ok, ctx)`, primary label `"Send"`, secondary `"Change"` → `onOpen`); on send: `commitOkSend` for the optimistic flip + undo, `dispatchOkSend(leadId, text, key)`; failure → `WriteErrorToast` + run the undo. When `!smsReady`: `Button` disabled + `title="Texting isn't set up yet — finish A2P registration in Settings"`; the draft still renders (facts stay visible, the action is honest).

`WorkBoard` — `<div className="board">` → four `<section className="col" role="region" aria-label={...}>`; `.col-head` = title + `count · $sum` (mono, `--type-xs`); group label `.kgrp` ("Needs action" amber with dot / passive label per column: "Waiting for customer" / "Scheduled / waiting" / "Scheduled / in field" / "Awaiting payment"); truncated column ⇒ quiet foot line `"Showing first N"` (fact, not apology). `WorkBoardSkeleton` mirrors `BoardSkeleton` in `app/(office)/pipeline/page.tsx` (one skeleton, one reveal).

CSS (append near `.kcard` block, tokens only):

```css
.kgrp { display:flex; align-items:center; gap:var(--space-2xs); padding:var(--space-xs) 2px var(--space-2xs);
        font:700 var(--type-2xs)/1.3 var(--font-mono); letter-spacing:.075em; text-transform:uppercase; color:var(--ink-3); }
.kgrp.on { color:var(--amber); }
.kgrp .kgc { margin-left:auto; }
.kmsg { margin-top:var(--space-2xs); padding:var(--space-2xs) var(--space-xs); border:1px solid var(--manila-line);
        border-radius:var(--radius-2xs); background:var(--manila); color:var(--ink-2); font-size:var(--type-2xs); line-height:1.5; }
```

(If `.cardghost` already covers the draft box visually, use it and skip `.kmsg` — check rendered output against the mockup before adding a class. DRY beats new CSS.)

- [ ] **Step 6: Run tests** — `npm test -- features/board features/pipeline features/home` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat: work board columns and cards with on-card reminder sends"`

---### Task 7: Dashboard integration — hard swap (no flag)

**Files:**
- Modify: `app/(office)/dashboard/page.tsx` (TodayPane), `features/home/handoff-note.tsx` (one copy line)
- Delete: `features/home/home-pipe.tsx`, `features/home/use-home-pipe.ts`, `features/home/ok-queue.tsx` (grep for other importers first — `use-ok-queue.ts` STAYS, the board consumes it; `features/home/derive.ts` STAYS, the Counter uses `okItemFor`/`deriveOkQueue`)
- Test: adjust `app/(office)/dashboard/*` render test if one exists; otherwise covered by Task 10 E2E

**Interfaces:**
- Consumes: `useWorkBoard()`, `WorkBoard`/`WorkBoardSkeleton`, `useOpenModal()` + `MODAL`, `HandoffNote` (existing props: `queueCount`, `queueValue`, `loading` — unchanged), `isFirstLoad`/`shouldShowLoadFailed`/`shouldShowFirstRun` (`lib/first-run.ts`).

- [ ] **Step 1: TodayPane swap**

In `app/(office)/dashboard/page.tsx`: render `HandoffNote` + `WorkBoard` where `HomePipe` + `OkQueue` were. Then delete the three legacy files (verify no remaining importers with `grep -rn "home-pipe\|ok-queue\"" --include="*.ts*"` — the `ok-queue.tsx` COMPONENT dies, the `use-ok-queue.ts` HOOK lives). Wire:

```tsx
const board = useWorkBoard();
const openModal = useOpenModal();
const openItem = (item: BoardItem) => {
  if (item.kind === "lead") openModal(MODAL.LEAD, { leadId: item.refId });
  else if (item.kind === "estimate") openModal(MODAL.EST, { estId: item.refId });
  else if (item.kind === "job") openModal(MODAL.JOB, { jobId: item.refId });
  else openModal(MODAL.INVOICE, { invoiceId: item.refId });
};
```

Hero: `queueCount={board.needsYou.count}` `queueValue={board.needsYou.valueDollars}` `loading={!board.isFetched}`. Loading: `!board.isFetched && !board.isError` → `WorkBoardSkeleton`; error with nothing cached → `LoadFailed` with retry. The hero number keeps `useAnimatedNumber` via HandoffNote — untouched.

- [ ] **Step 3: Hero copy line**

In `features/home/handoff-note.tsx`, change the queue sentence to: `` `${queueCount} items · ${textsReady} texts ready to send.` `` — add optional prop `textsReady?: number` (defaulting so any other caller keeps the old copy — open/closed). Zero-state line ("Nothing's waiting on you. Go run the day.") stays.

- [ ] **Step 4: Verify by running**

`pnpm dev` (dedicated PORT per worktree convention) → `/dashboard`: board renders, tiles/feed gone, hero number animates in after the skeleton. Check the Front Desk tab dot and other tabs unaffected. `npm test` still green (deleting home-pipe/ok-queue must take their tests with them; `features/home/ok-queue-drafts.test.ts` tests `drafts.ts`, not the component — it stays).

- [ ] **Step 5: Commit** — `git commit -m "feat: work board replaces flow strip and OK queue on Office Today"`

---

### Task 8: Remove `/pipeline`

The sales-only kanban is superseded by the work board. Its reusable data hooks move into `features/board/`; everything else goes.

**Files:**
- Modify: `app/(office)/pipeline/page.tsx` → client redirect stub to `/dashboard` (copy the exact pattern of `app/(office)/frontdesk/page.tsx`)
- Move: `features/pipeline/use-rail-columns.ts` → `features/board/use-rail-columns.ts`; `features/pipeline/working.ts` → `features/board/working.ts` (update all importers — `useWorkBoard`, `derive.ts`, and any Counter/customers usage `grep -rn "features/pipeline" --include="*.ts*"` reveals)
- Delete: `features/pipeline/board-cards.tsx` + `features/pipeline/board-cards.test.tsx` (SendBlock already extracted in Task 6), then the empty `features/pipeline/` directory
- Modify: every nav surface that links `/pipeline` — run `grep -rn '"/pipeline"' app components features` and expect at least the sidebar (`components/shell/`), possibly `MobileTabs` and the Counter/CommandBar run builders; remove or repoint each to `/dashboard`
- Modify: `e2e/*.spec.ts` references to `/pipeline` (golden/visual/keyboard) — retarget board assertions to `/dashboard`, delete pipeline visual snapshots from `e2e/visual.spec.ts-snapshots/`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useRailColumns` and `working.ts` exports now import from `features/board/` — Tasks 5's imports must be updated in the same commit (if executing sequentially, Task 5 may already import from the new location; either way the build must be green at this commit).

- [ ] **Step 1: Grep the blast radius** — `grep -rn "features/pipeline\|\"/pipeline\"" --include="*.ts*" app components features e2e | sort`. List every hit before touching anything.
- [ ] **Step 2: Move the two hooks, update importers, delete the rest, stub the route.**
- [ ] **Step 3: Full check** — `npm test` (board-cards tests deleted with their component; everything else green), `pnpm build` (catches dead imports), `grep` from Step 1 returns only the redirect stub.
- [ ] **Step 4: Commit** — `git commit -m "feat!: retire /pipeline — the work board on Office Today supersedes it"`

---

### Task 9: First-run state — setup brief + ghost cards

**Files:**
- Create: `features/board/ghosts.ts`
- Modify: `features/board/work-board.tsx` (ghost render path), `app/(office)/dashboard/page.tsx` (first-run wiring)
- Test: extend `features/board/work-board.test.tsx`

**Interfaces:**
- Consumes: `FirstRunEmptyState({ heading, subtext, paths })` with `EmptyStatePath = { title, description, actionLabel, onAction, variant? }` (`components/shared/first-run-empty-state.tsx`); `shouldShowFirstRun` (`lib/first-run.ts`); `MODAL.IMPORT_CUSTOMERS`, `MODAL.NEW_JOB`; the tab switcher already in the page (`switchTab("frontdesk")`).
- Produces: `export const GHOST_CARDS: Record<BoardColumnId, GhostCard>` where `GhostCard = { name: string; service: string; badge: string; tone: BoardTone; state: string }`.

Rules (locked in mockup review): ghosts carry NO dollar values, are `aria-hidden`, inert (no onOpen), dashed border, tagged `EXAMPLE`.

- [ ] **Step 1: Failing tests**

```tsx
it("first-run renders one EXAMPLE ghost per column and no live cards", () => {
  render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} />);
  expect(screen.getAllByText("Example")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
});

it("ghosts never show dollars", () => {
  render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} />);
  expect(screen.queryByText(/\$/)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`ghosts.ts` fixture (from the approved mockup): Dana Ruiz / Water heater leaking / Needs response / Called 5m ago; Marcus Lee / Primary bath remodel / Quote in progress / Draft · unsent; Kim Patel / Main drain cleaning / Scheduled / Fri · 9:00 AM; Alex Moro / Kitchen faucet repair / Ready to bill / Done today. Render inside each `.col` as a `.kcard` variant with dashed border (reuse the token border style; class `.kcard.ghosted` if `.cardghost` is semantically taken by the draft box) + `.kgrp`-style `EXAMPLE` tag, `aria-hidden="true"`, column stats `0`.

Dashboard: `firstRun = shouldShowFirstRun({ isFetched: board.isFetched, isError: board.isError, count: totalOpen })` where `totalOpen = sum(columns[].count)`. When first-run: swap `HandoffNote` for:

```tsx
<FirstRunEmptyState
  heading={`Welcome, ${ownerFirst}.`}
  subtext="This board fills itself as work comes in. Start wherever you like:"
  paths={[
    { title: "Import your customers", description: "Jobber, Housecall Pro, or a spreadsheet",
      actionLabel: "Import", onAction: () => openModal(MODAL.IMPORT_CUSTOMERS), variant: "primary" },
    { title: "Add your first job", description: "Book work you already have lined up",
      actionLabel: "Add job", onAction: () => openModal(MODAL.NEW_JOB) },
    { title: "Forward calls to Front Desk", description: "Answered calls land here on their own",
      actionLabel: "Set up", onAction: () => switchTab("frontdesk") },
  ]}
/>
```

- [ ] **Step 4: Run tests** — PASS. Also manually verify against the mockup's "brand-new shop" view.

- [ ] **Step 5: Commit** — `git commit -m "feat: first-run setup brief and ghost example cards on the work board"`

---

### Task 10: E2E, visual net, and rollout checks

**Files:**
- Modify: `e2e/golden.spec.ts` (+ visual snapshots via the existing `visual.spec.ts` flow)

**Interfaces:** consumes the seeded E2E org (`npm run seed:e2e`, `scripts/seed-e2e.mjs`).

- [ ] **Step 1: Golden-path assertions**

Add to `e2e/golden.spec.ts`: `/dashboard` shows exactly 4 `role="region"` columns; a needs-action group renders before a passive group inside a column; clicking a card name opens the matching modal (`role="dialog"`); the hero figure is non-empty only after the skeleton disappears (hydration-flash check). For sends: the E2E org has no active A2P, so assert the Send button is **disabled with the reason title** — that IS the honest production behavior until A2P clears (do not mock a send).

- [ ] **Step 2: First-run E2E**

With a fresh org (seed script's empty-org fixture if present; otherwise create via the signup helper in `e2e/helpers/`): assert 4 `Example` ghosts, the three setup paths, and **no `$` character anywhere on the page**.

- [ ] **Step 3: Visual + a11y nets**

`E2E_VISUAL=1 npx playwright test visual.spec.ts a11y.spec.ts` — update snapshots for `/dashboard` only. Known repo facts: ~14 baselines already fail on clean main and the visual net is blind below the fold — screenshot the board at full height (`fullPage`) for the new baseline, and diff only the snapshots this PR touches.

- [ ] **Step 4: Full gates**

`npm test` · `npm run test:int` · `npm run coverage` (≥80/75) · `pnpm build`. All green before PR.

- [ ] **Step 5: Commit + PR**

```bash
git commit -m "test: golden, visual and first-run coverage for the work board"
```

PR body: link this plan + the mockup file; note the flag (`NEXT_PUBLIC_WORK_BOARD=0` kill switch), the two open decisions (top of this doc), and that `/pipeline` is intentionally untouched.

---

## Post-ship follow-ups

- Revisit `estimates.total_cents` only if board p95 render or `quoting.list` latency demands it.
- Watch the Counter run builders after `/pipeline` removal — `features/counter/runs.ts` builds money runs from OK items and must not have depended on the pipeline page being reachable.

## Self-review notes (done)

- Spec coverage: mockup surfaces → tasks: board (4-6), on-card texts + send (2, 3, 6), big hero kept + copy (7), tiles/feed removal (7), first-run ghosts + setup brief (8), no-filters/no-banner decisions encoded as constraints. ✓
- Types consistent: `BoardItem`/`BoardColumn`/`WorkBoardData` defined once (Task 4), consumed by name in 5–8; `dispatchOkSend` signature change propagated (Task 6 Step 2 lists both call sites). ✓
- No placeholders: every step names exact files; the two "read X first" pointers (`RailRow` fields, A2P slice selector) are deliberate read-the-source directives with exact paths, not TBDs. ✓
