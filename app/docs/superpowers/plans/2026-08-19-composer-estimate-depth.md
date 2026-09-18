# Composer Estimate Depth (v4 PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pre-approved by Owen (composer-v4 mock, 2026-08-19). Execute inline, task by task, no approval pauses.

**Goal:** Give estimate lines the depth a $2–15M shop's proposal needs — per-line scope prose, internal sub-items that roll up into the line price, and a quote-level "customer sees: every price / one total" display switch — end to end (schema → domain → API → composer → public quote page).

**Architecture:** Extend the existing `estimates` + `estimate_lines` model additively: two nullable columns on lines (`scope` text, `sub_items` jsonb) and one defaulted column on the header (`price_display`). Sub-items are jsonb, not a child table — they are never queried independently, they live and die with their line, and jsonb avoids new RLS surface. All wire additions are optional fields, so existing payloads stay byte-compatible. The customer page renders scope and honors the display mode; sub-items are redacted from every public surface exactly like `costCents`.

**Tech Stack:** Next 16, Drizzle/Postgres (Supabase, live shared DB), tRPC + zod, vitest (+ env-gated int tests), prototype.css tokens (no Tailwind).

**PR2 (separate plan, after this ships):** presentation templates + Presentation tab + public presentation renderer.

## Global Constraints

- Additive migrations only; live shared DB; single-writer ledger — run `pnpm db:migrate` from this worktree only, right before the PR opens, and verify with `pnpm db:verify`.
- Migration numbering: next is **0133** (journal idx 133). RLS files only for NEW tables — none here.
- The repo save path enumerates fields at 5 sites: mapper `toDomain`, `save()` insert values, `save()` conflict set, `upsertLines` rows, `upsertLines` excluded set. Every new column must be added to the relevant sites or it silently drops.
- Accept rewrites lines (`withLinesForAccept`); both accept paths (office accept-with-lines, public stored-data rebuild) must carry `scope`/`subItems` through or signing destroys them.
- All new wire fields optional; existing payload shapes byte-identical.
- No floating UI; everything expands in-flow with inline reasons. 800-line file cap — extract sibling components.
- `subItems` NEVER appear in the public GET DTO, the public page props, or the signed snapshot lines (internal math, like cost). `scope` DOES appear everywhere the description appears (it's customer copy) including the signed snapshot.
- Client money in dollars, wire in integer cents (`Math.round(x*100)`), whole-dollar display via `fmt$`.
- Coverage ≥80% on touched pure logic; unit tests use hand-written fakes; int tests env-gated (`hasDb ? describe : describe.skip`).
- Commit style: `feat:`/`test:`/`refactor:` prefixes, no attribution footer.

## Locked Decisions

1. **Sub-item shape** `{ description: string(1..500); quantity: number ≥0 finite; unit: string(1..20) | null; amountCents: int ≥0 }`, max **20** per line. No hours/materials split yet (YAGNI — amount is the universal unit; PaintScout's prep/paint-hours columns can layer on later).
2. **Roll-up is client-side.** When a line has ≥1 sub-item the composer derives the line rate (`r = Σ sub amounts`) and disables the rate input with an inline reason. The server stores what it's sent and does NOT enforce the sum — the line's `rateCents` stays the single pricing source of truth everywhere downstream (calcQuote, totals, snapshot).
3. **`priceDisplay: 'lines' | 'total'`** on the estimates header, default `'lines'`. "Section totals" is deferred — quotes have no section concept in the data model. In `'total'` mode the public page hides per-line extended amounts; **optional add-on prices always show** (the customer can change the total by adding one, so its price must be visible); tier-card totals always show (they are totals).
4. **Scope is plain text** (≤8000 chars), rendered `white-space: pre-wrap`. Numbered lists arrive as literal "1. …" lines. No rich-text engine.
5. Signed snapshot gains `priceDisplay` at root and `scope` per line (record fidelity for what the signer saw). `AUTHORIZATION_VERSION` unchanged — the authorization sentence's meaning is unchanged.

## File Structure

- Modify: `shared/db/schema/estimates.ts` — 3 columns + `EstimateSubItem` type
- Create: `shared/db/migrations/0133_composer_estimate_depth.sql` (via `pnpm db:generate`, then hand-add CHECKs) + journal entry
- Modify: `modules/quoting/domain/estimate.ts` — sub-item validation on `EstimateLine`, `priceDisplay` on `Estimate`, snapshot fields
- Modify: `modules/quoting/domain/estimate.test.ts`
- Modify: `modules/quoting/app/draft-estimate.ts` (+`.test.ts`) — command + line input plumbing
- Modify: `modules/quoting/app/accept-estimate.ts`, `modules/quoting/app/public-quote.ts` (+`public-quote.test.ts`) — preserve fields through accept
- Modify: `modules/quoting/infra/estimate-mapper.ts`, `modules/quoting/infra/drizzle-estimate-repository.ts` (+`.int.test.ts`)
- Modify: `modules/quoting/api/estimate-router.ts` — zod inputs + DTOs
- Modify: `app/api/public/quote/[token]/route.ts` — GET json adds `scope`, `priceDisplay` (never `subItems`)
- Modify: `app/(public)/q/[token]/page.tsx`, `QuoteLines.tsx`, `LineRow.tsx`, `tier-view.ts`
- Modify: `lib/store/types.ts`, `lib/store/dto-mapper.ts`, `lib/store/slices/estimates-slice.ts`
- Modify: `app/(office)/composer/composer-state.ts` (+ create `composer-state.test.ts` additions if file exists, else extend existing test file)
- Create: `app/(office)/composer/sub-item-rows.tsx`, `app/(office)/composer/scope-editor.tsx`
- Modify: `app/(office)/composer/line-table.tsx`, `quote-card.tsx`, `page.tsx`

---

### Task 1: Schema + migration 0133

**Files:** Modify `shared/db/schema/estimates.ts`; generated `shared/db/migrations/0133_*.sql`; `shared/db/migrations/meta/_journal.json` (drizzle-kit handles).

**Interfaces (produces):**
```ts
export interface EstimateSubItem {
  description: string
  quantity: number
  unit: string | null
  amountCents: number
}
export const PRICE_DISPLAYS = ["lines", "total"] as const
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number]
export const isPriceDisplay = (v: string): v is PriceDisplay =>
  (PRICE_DISPLAYS as readonly string[]).includes(v)
```

- [ ] **Step 1:** In `shared/db/schema/estimates.ts` add the exported types above next to the existing `TierNamesColumn` convention, then add columns:
  - `estimates` table: `priceDisplay: text("price_display").notNull().default("lines"),`
  - `estimateLines` table: `scope: text("scope"),` and `subItems: jsonb("sub_items").$type<EstimateSubItem[]>(),`
- [ ] **Step 2:** Run `pnpm db:generate`. Inspect the generated SQL: must contain only three `ALTER TABLE ... ADD COLUMN` statements. Hand-append CHECK to the same file (house style keeps CHECKs in SQL):
```sql
--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_price_display_check" CHECK ("price_display" IN ('lines','total'));
```
- [ ] **Step 3:** `pnpm typecheck` passes. Do NOT run `db:migrate` yet (Task 11).
- [ ] **Step 4:** Commit `feat: add scope, sub_items, price_display columns for estimate depth`

### Task 2: Domain — SubItem validation, line fields, header priceDisplay, snapshot

**Files:** Modify `modules/quoting/domain/estimate.ts`, `modules/quoting/domain/estimate.test.ts`.

**Interfaces (produces):** `EstimateLine.create` accepts `scope?: string | null` and `subItems?: readonly EstimateSubItem[] | null`; `Estimate.create` accepts `priceDisplay?: PriceDisplay`; `line.props.scope: string | null`, `line.props.subItems: readonly EstimateSubItem[] | null`, `estimate.props.priceDisplay: PriceDisplay`. SignedSnapshot root gains `priceDisplay: string`; SignedLine gains `scope: string | null`.

- [ ] **Step 1: failing tests** in `estimate.test.ts` (follow the file's existing builder helpers — read them first and reuse):
```ts
describe("estimate line scope & sub-items", () => {
  it("trims scope and stores null when blank", () => {
    const r = lineWith({ scope: "  " })            // reuse existing valid-line builder
    expect(r.ok && r.value.props.scope).toBeNull()
  })
  it("rejects scope over 8000 chars", () => {
    const r = lineWith({ scope: "x".repeat(8001) })
    expect(!r.ok && r.error.field).toBe("scope")
  })
  it("accepts up to 20 valid sub-items and freezes them", () => {
    const sub = { description: "Walls", quantity: 2400, unit: "sq ft", amountCents: 984000 }
    const r = lineWith({ subItems: Array.from({ length: 20 }, () => sub) })
    expect(r.ok && r.value.props.subItems?.length).toBe(20)
  })
  it("rejects 21 sub-items", () => {
    const sub = { description: "Walls", quantity: 1, unit: null, amountCents: 0 }
    expect(lineWith({ subItems: Array.from({ length: 21 }, () => sub) }).ok).toBe(false)
  })
  it("rejects a sub-item with negative amount / blank description / non-int cents", () => {
    expect(lineWith({ subItems: [{ description: "", quantity: 1, unit: null, amountCents: 1 }] }).ok).toBe(false)
    expect(lineWith({ subItems: [{ description: "x", quantity: 1, unit: null, amountCents: -1 }] }).ok).toBe(false)
    expect(lineWith({ subItems: [{ description: "x", quantity: 1, unit: null, amountCents: 1.5 }] }).ok).toBe(false)
  })
})
describe("estimate priceDisplay", () => {
  it("defaults to lines", () => { expect(estimateWith({}).props.priceDisplay).toBe("lines") })
  it("accepts total", () => { expect(estimateWith({ priceDisplay: "total" }).props.priceDisplay).toBe("total") })
})
it("signed snapshot carries priceDisplay and per-line scope", () => {
  // accept a 'total'-display estimate whose line has scope; assert snapshot.priceDisplay === "total"
  // and snapshot.lines[0].scope === that scope
})
```
- [ ] **Step 2:** Run `pnpm vitest run modules/quoting/domain/estimate.test.ts` — new tests FAIL.
- [ ] **Step 3: implement.** In `EstimateLine.create`: normalize `scope` (trim → null when empty, err `validation("scope too long", "scope")` over 8000); validate `subItems` (null when absent/empty; max 20 → `validation("too many sub-items", "subItems")`; per item: trimmed description 1..500, `Number.isFinite(quantity) && quantity >= 0`, unit trimmed ≤20 → null when empty, `Number.isInteger(amountCents) && amountCents >= 0`); store frozen copies. In `Estimate.create`: `priceDisplay = props.priceDisplay ?? "lines"`, guard with `isPriceDisplay`. Thread through every `withX` copy-constructor (immutability — copy, never mutate). In the snapshot builder add `priceDisplay: this.props.priceDisplay` and per-line `scope: l.props.scope`.
- [ ] **Step 4:** Tests pass. Run the whole domain suite to catch copy-constructor misses: `pnpm vitest run modules/quoting/domain`.
- [ ] **Step 5:** Commit `feat: domain support for line scope, sub-items, price display`

### Task 3: Draft use-case plumbing

**Files:** Modify `modules/quoting/app/draft-estimate.ts`, `modules/quoting/app/draft-estimate.test.ts`.

**Interfaces (produces):** `EstimateLineInput` gains `scope?: string | null; subItems?: readonly EstimateSubItem[] | null`; `DraftEstimateCommand` gains `priceDisplay?: PriceDisplay | null`.

- [ ] **Step 1: failing tests** — extend the existing fake-repo test file:
```ts
it("persists scope, sub-items and price display", async () => {
  const r = await useCase.exec(cmdWith({
    priceDisplay: "total",
    lines: [{ ...validLine, scope: "Includes:\n1. Walls", subItems: [{ description: "Walls", quantity: 2400, unit: "sq ft", amountCents: 984000 }] }],
  }))
  expect(r.ok).toBe(true)
  const saved = fakeRepo.lastSaved!            // reuse the fake's spy convention
  expect(saved.props.priceDisplay).toBe("total")
  expect(saved.props.lines[0].props.scope).toBe("Includes:\n1. Walls")
  expect(saved.props.lines[0].props.subItems?.[0].amountCents).toBe(984000)
})
```
- [ ] **Step 2:** Run — FAILS (fields dropped).
- [ ] **Step 3:** Pass `scope: input.scope ?? null`, `subItems: input.subItems ?? null` into `EstimateLine.create`, and `priceDisplay: cmd.priceDisplay ?? "lines"` into `Estimate.create`.
- [ ] **Step 4:** Tests pass. Commit `feat: draft estimate carries scope, sub-items, price display`

### Task 4: Accept paths preserve the new fields

**Files:** Modify `modules/quoting/app/accept-estimate.ts` (only if its line-rebuild drops fields), `modules/quoting/app/public-quote.ts`, `modules/quoting/app/public-quote.test.ts`; office accept `lineInput` handled in Task 6.

- [ ] **Step 1: failing test** in `public-quote.test.ts`: accept (single-path with an optional line selected, and tiered-path) an estimate whose stored lines carry `scope` + `subItems`; assert the accepted estimate's lines still carry both, and the signed snapshot has `scope` + `priceDisplay`.
- [ ] **Step 2:** Run — likely FAILS in `buildAcceptLinesForTier` / `buildAcceptLinesFromSelection` (they rebuild line inputs from stored lines field-by-field).
- [ ] **Step 3:** Add `scope: l.props.scope, subItems: l.props.subItems` wherever those builders enumerate stored-line fields; same for office `withLinesForAccept` input construction in the router (Task 6 wires zod; the app-layer types change here).
- [ ] **Step 4:** Tests pass. Commit `fix: accept paths preserve scope and sub-items`

### Task 5: Infra — mapper + repository (5 enumeration sites)

**Files:** Modify `modules/quoting/infra/estimate-mapper.ts`, `modules/quoting/infra/drizzle-estimate-repository.ts`, `modules/quoting/infra/drizzle-estimate-repository.int.test.ts`.

- [ ] **Step 1:** Mapper `toDomain`: pass `scope: row.scope`, `subItems: row.subItems` into `EstimateLine.create` and `priceDisplay` into `Estimate.create` — corrupt values already fail loud via domain validation (throw on `!r.ok` is the file's convention).
- [ ] **Step 2:** Repository: `save()` header insert values + `onConflictDoUpdate` set gain `priceDisplay`; `upsertLines` row mapping gains `scope`, `subItems`, and the `excluded.*` conflict set gains both. Grep the file for `needsPhoto` to find every enumeration site — mirror it.
- [ ] **Step 3: int test** (env-gated suite, runs only with DB creds): draft an estimate with scope/sub-items/`priceDisplay:'total'` → `save` → `findById` → assert round-trip equality; then `save` again with the line's scope changed → assert update lands (proves the excluded set).
- [ ] **Step 4:** `pnpm typecheck && pnpm vitest run modules/quoting` green; `pnpm test:int` if `.env.local` creds present.
- [ ] **Step 5:** Commit `feat: persist scope, sub-items, price display`

### Task 6: API — zod inputs, DTOs, public route

**Files:** Modify `modules/quoting/api/estimate-router.ts`, `app/api/public/quote/[token]/route.ts`.

**Interfaces (produces):**
```ts
const subItemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().nonnegative().finite(),
  unit: z.string().trim().min(1).max(20).optional(),
  amountCents: z.number().int().nonnegative(),
})
// lineInput additions:
scope: z.string().trim().min(1).max(8000).optional(),
subItems: z.array(subItemInput).min(1).max(20).optional(),
// draftInput addition:
priceDisplay: z.enum(["lines", "total"]).optional(),
// estimateLineDTO additions (office DTO):
scope: z.string().nullable(), subItems: z.array(subItemDTO).nullable(),
// estimateDTO addition:
priceDisplay: z.enum(["lines", "total"]),
```
- [ ] **Step 1:** Add the schemas above; thread router defaults (`scope ?? null`, `subItems ?? null`, `priceDisplay ?? null`) into `DraftEstimateCommand`; extend office `accept` `lineInput` the same way (it reuses `lineInput` — verify and keep). `toEstimateDTO` maps the new props; `estimateSummaryDTO` unchanged (lists don't need them).
- [ ] **Step 2:** Public `estimateToJson` in `route.ts`: add per-line `scope` and root `priceDisplay`. **Do NOT add `subItems`** — add the comment `// subItems are internal estimating math — redacted like cost`.
- [ ] **Step 3:** `pnpm typecheck` + quoting unit suite green.
- [ ] **Step 4:** Commit `feat: quoting API carries scope, sub-items, price display`

### Task 7: Store plumbing (don't repeat the materialId drop)

**Files:** Modify `lib/store/types.ts`, `lib/store/dto-mapper.ts`, `lib/store/slices/estimates-slice.ts`.

**Interfaces (produces):**
```ts
// lib/store/types.ts
export interface EstimateSubItemStore { d: string; q: number; unit?: string; amt: number } // amt in dollars
// EstimateLine gains: scope?: string; sub?: EstimateSubItemStore[]
// Estimate gains: priceDisplay?: "lines" | "total"   (undefined ⇒ "lines")
```
- [ ] **Step 1:** `dtoEstimateToStore`: line mapping gains `scope: l.scope ?? undefined`, `sub: l.subItems?.map(s => ({ d: s.description, q: s.quantity, unit: s.unit ?? undefined, amt: s.amountCents / 100 }))`; estimate-level `priceDisplay: dto.priceDisplay === "total" ? "total" : undefined`.
- [ ] **Step 2:** `estimates-slice` `addEstimate`/accept `backendLines` mapping gains `scope: l.scope, subItems: l.sub?.map(s => ({ description: s.d, quantity: s.q, unit: s.unit, amountCents: Math.round(s.amt * 100) }))`; draft payload gains `priceDisplay: draft.priceDisplay`.
- [ ] **Step 3:** `pnpm typecheck`; run any existing dto-mapper tests. Commit `feat: store round-trips scope, sub-items, price display`

### Task 8: composer-state (pure logic + tests first)

**Files:** Modify `app/(office)/composer/composer-state.ts`; extend its test file (create `composer-state.test.ts` beside it if none exists — it is pure and coverage-scoped).

**Interfaces (produces):**
```ts
export interface ComposerSubItem { d: string; q: number; unit?: string; amt: number } // dollars
// ComposerLine gains: scope?: string; sub?: ComposerSubItem[]
// ComposerState gains: priceDisplay: "lines" | "total"   (INITIAL_STATE: "lines")
export function subItemsTotal(line: Pick<ComposerLine, "sub">): number    // Σ amt, 2dp-safe via cents
export function withSubPatch(line: ComposerLine, sub: ComposerSubItem[]): ComposerLine // returns { ...line, sub, r: subItemsTotal } — rate derived
export function emptySubItem(): ComposerSubItem  // { d: "", q: 1, amt: 0 }
```
- [ ] **Step 1: failing tests:**
```ts
it("derives the line rate from sub-items", () => {
  const line = withSubPatch(emptyLine(), [{ d: "Walls", q: 1, amt: 9840 }, { d: "Trim", q: 1, amt: 7430 }])
  expect(line.r).toBe(17270)
})
it("sums sub-item dollars without float drift", () => {
  expect(subItemsTotal({ sub: [{ d: "a", q: 1, amt: 0.1 }, { d: "b", q: 1, amt: 0.2 }] })).toBe(0.3)
})
it("payload carries scope, sub-items in cents, and price display", () => {
  // build state with a scoped, sub-itemed line + priceDisplay 'total';
  // assert the payload-line mapper emits { scope, subItems:[{amountCents: 984000}] } and priceDisplay: 'total'
})
it("revise seed round-trips scope and sub-items", () => { /* applyReviseSeed(seedWith(...)) restores line.scope and line.sub in dollars */ })
```
- [ ] **Step 2:** Run — FAIL. Implement: `subItemsTotal` sums `Math.round(amt*100)` then `/100`; `withSubPatch` as specified; extend `toEstimateLines`, the payload line mapper used by `buildDraftPayload` (in page.tsx — move the line-mapping lambda into composer-state as `lineToPayload(l)` so it's testable and DRY with the slice), `applyReviseSeed`/`ReviseSeedLine` (+ `scope`, `subItems`, `priceDisplay` on `ReviseSeed`), `INITIAL_STATE.priceDisplay`.
- [ ] **Step 3:** Tests pass. Commit `feat: composer state models scope, sub-items, price display`

### Task 9: Composer UI

**Files:** Create `app/(office)/composer/sub-item-rows.tsx`, `app/(office)/composer/scope-editor.tsx`; modify `line-table.tsx`, `quote-card.tsx`, `page.tsx` (payload + priceDisplay wiring).

**Contracts:**
```tsx
export function SubItemRows(props: {
  sub: ComposerSubItem[]
  onChange: (sub: ComposerSubItem[]) => void   // parent applies withSubPatch
  disabled?: boolean
}) // renders ↳ rows: description input, qty+unit input, amount input ($), remove;
   // footer links "↳ add sub-item"; mono caption "SUB-ITEMS ROLL UP INTO THE LINE PRICE — NEVER SHOWN TO THE CUSTOMER"

export function ScopeEditor(props: {
  value: string
  onChange: (scope: string) => void
  onCollapse: () => void
}) // in-flow .scopebox with mono tag "¶ SCOPE — SHOWN ON THE QUOTE", autosizing textarea (8000 max), collapse link
```
- [ ] **Step 1:** LineTable row additions, all in-flow: a `¶` hint row per line (collapsed: `¶ Scope · N lines ▸` when scope set, `¶ add scope` ghost link when not) toggling ScopeEditor; a `↳ sub-items (N)` hint toggling SubItemRows; when `line.sub?.length`, the rate input renders `disabled` with `title="Priced by sub-items"` and the row shows the derived rate. Keep `line-table.tsx` under 800 lines by delegating to the two new components.
- [ ] **Step 2:** Header `$` chip (reuse `.optchip`-style pill in the `.lineedit` header band): text `$ CUSTOMER SEES: EVERY PRICE` ⇄ `ONE TOTAL`, cycling `cs.priceDisplay`; when `'total'`, add a dim class to the amount column (editor-only affordance mirroring the mock).
- [ ] **Step 3:** `page.tsx`: `buildDraftPayload` uses `lineToPayload` from composer-state and adds `priceDisplay: cs.priceDisplay`. GBB tiers get the same LineTable features for free — verify by toggling format.
- [ ] **Step 4:** Manual verification (dev server on a dedicated PORT): build the Two Day Painting example — one line, 4 sub-items, scope prose, `'total'` display; Preview opens `/q/<token>`; confirm draft → revise (`?revise=`) round-trips everything.
- [ ] **Step 5:** Commit `feat: composer edits scope, sub-items, price display`

### Task 10: Public quote page

**Files:** Modify `app/(public)/q/[token]/page.tsx`, `QuoteLines.tsx`, `LineRow.tsx`, `tier-view.ts`.

- [ ] **Step 1:** `LineRow` gains `scope?: string | null` and `showAmount: boolean` — description block renders scope beneath in `white-space: pre-wrap`, `var(--ink-2)`, `--type-sm`; amount span renders only when `showAmount`.
- [ ] **Step 2:** `page.tsx` + `QuoteLines.tsx`: thread `priceDisplay` (`showAmounts = estimate.props.priceDisplay !== "total"`) to every LineRow; **add-on rows keep their `+$` prices in both modes**; TotalsBlock unchanged (total always shows). `tier-view.ts` `QuoteLineView` gains `scope: string | null`.
- [ ] **Step 3:** Verify the settled/accepted record still renders scope (it renders stored lines — comes free) and the signed snapshot writes `priceDisplay` + scope (Task 2 domain).
- [ ] **Step 4:** Visual check at 393px and 520px+ widths (this surface is mobile-first). Commit `feat: public quote renders scope and honors price display`

### Task 11: Verify, migrate, PR

- [ ] **Step 1:** Full gates: `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm test:int` when creds present).
- [ ] **Step 2:** From THIS worktree only: `pnpm db:migrate` then `pnpm db:verify` — confirm 0133 applied (additive, old code unaffected). Watch for the silent no-op trap: verify the journal actually lists 0133.
- [ ] **Step 3:** Playwright screenshots of composer (both display modes, sub-items expanded) and `/q/<token>` for the PR body.
- [ ] **Step 4:** Push (`-u`) with the sagerreal noreply identity; never commit `next-env.d.ts`. Open PR titled `feat: composer estimate depth — scope, sub-items, price display (v4 PR1)` with test plan + screenshots. Note: the red Vercel preview check is pre-existing (no Preview env vars).
