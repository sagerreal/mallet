# Perf & Feel — Phase 1 (Quick Wins + the Feel Kit)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per task, adversarial review per task, full gate + before/after measurement before the PR.

**Goal (Owen's mandate):** "incredibly smooth, high grade — clicks should feel super satisfying."
Phase 1 = the nine verified quick wins from the 2026-07-16 diagnosis (5 investigators, all causes
verified in source): instant press feedback on every control, remote-auth removed from the per-nav
path, the 261KB modal chunk deferred, loading-text flashes replaced with skeletons, and the shell
re-render storms stopped. Phase 2 (structural: modal-host split, by-id selectors, bootstrap query)
is a separate later plan.

**The physics of "satisfying":** press-in is INSTANT (`:active` applies at 0ms); release springs
back over the already-declared ~100ms transform transition. Never lengthen press application, never
add delay. A nav tap must read press → crossfade → content — never press → freeze → flash.

## Global Constraints

- Design principles binding (`docs/design-principles.md`). NO behavior changes — everything here is
  presentation, caching, or scheduling. Tenant safety untouched.
- **Auth changes (P2) are on the live login path — highest care:** session refresh for expired
  tokens MUST keep working; verify empirically, not by reading docs.
- The schedule board is scar tissue: P4's rAF change touches ONLY the `move()` handler scheduling —
  zero markup/structure changes.
- NO visual redesign — the Feel Kit deepens the EXISTING design language (same tokens, same
  shapes). If a press state looks like a new theme, it's wrong.
- Full gate before the PR: `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm test` ·
  task-specific int files · `npm run coverage` (80/75) · `npm run build`.
- **Measurement is a deliverable:** before/after chunk-size table + Server-Timing durations + the
  side-by-side screen recording (P5).

---

### Task P1: The Feel Kit (CSS) — press states, tap reset, overlay fade, blur removal, skeletons

**Files:** `app/prototype.css` (+ `app/globals.css` if the global reset fits better there);
`components/modals/modal.tsx` (overlay class behavior only).

Apply the kit EXACTLY (tokens exist: `--manila-2`, `--ink`, `--card`, `--green-100`, `--line`,
`--line-2`, `--topbar`):

1. **Global touch reset** (with the press states, never alone):
```css
button,[role=button],a,.navitem,.navsub,.mtab,.md-stop,.kcard,.morerow{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
```
2. **Press states** (each deepens the control's existing hover language — press = one step further IN):
```css
.btn:active{transform:translateY(1px) scale(.98);box-shadow:none;background:var(--manila-2)}
.btn.primary:active{transform:translateY(1px) scale(.98);filter:brightness(.94)}
.navitem:active,.navsub:active{background:rgba(43,39,32,.14)}
.mtab{transition:transform 80ms,opacity 80ms}
.mtab:active{transform:scale(.92);opacity:.6}
.md-stop:active,.kcard:active{background:var(--manila-2);transform:scale(.995)}
.segctl button:active{background:var(--manila-2)}
.segctl button.on:active{filter:brightness(1.15)}
.tjclock{transition:transform .1s,box-shadow .12s,background .12s}
.tjclock:active{transform:scale(.97);background:var(--green-100)}
.tjpaid-btn,.tjpaid-btn2{transition:transform .1s,opacity .12s}
.tjpaid-btn:active{transform:scale(.97);opacity:.88}
.tjpaid-btn2:active{transform:scale(.98)}
```
   Before landing, GREP the real class names (`.seg` vs `.segctl`, `.mtab`, `.tjclock`, `.tjpaid-btn`,
   `.md-stop`, `.kcard`, `.navitem`, `.navsub`, `.morerow`) and adjust selectors to what actually
   exists — the kit was authored against these; verify each one has a rule in prototype.css today
   (drop/adapt any that don't exist; report adaptations).
3. **Overlay/modal**: `.overlay` display-toggle → fade: keep `display:flex`, add
   `opacity:0;pointer-events:none;transition:opacity .15s ease`; `.overlay.open{opacity:1;pointer-events:auto}`.
   In `modal.tsx` keep `if(!open) return null` (mount behavior unchanged) — the scrim now fades while
   the existing `.modal` `modalin` runs. Mobile: `@media(max-width:760px){.overlay{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(10,12,20,.55)}}`.
4. **Topbar blur removal** (prototype.css ~:119): drop the `backdrop-filter` — solid `var(--topbar)`
   background. Visually near-identical, GPU cost gone.
5. **Skeleton primitives** (used by P3):
```css
@keyframes skpulse{0%,100%{opacity:.55}50%{opacity:1}}
.sk{background:var(--manila-2);border-radius:8px;animation:skpulse 1.2s ease-in-out infinite}
.sk-row{display:flex;gap:14px;padding:14px 4px;border-bottom:1px solid var(--line-2)}
```
- [ ] Verify every targeted class exists; apply; `npm run build`; screenshot-verify pressed states
  (Playwright can force `:active` via CDP `Input.dispatchMouseEvent` down-without-up, or capture
  mid-tap frames); confirm the topbar looks unchanged at rest. Commit
  `feat(feel): press states, tap reset, overlay fade, topbar blur removal, skeleton primitives`.

### Task P2: Per-nav auth cost — getClaims middleware + cached principal resolve + Server-Timing

**Files:** `middleware.ts` · `lib/auth/guard.ts` · `modules/identity/infra/db-principal-resolver.ts`
(or a wrapper in guard.ts — keep the module clean).

1. `middleware.ts:16`: replace `await supabase.auth.getUser()` with `await supabase.auth.getClaims()`
   (the local-JWT path — the SAME migration this codebase already did for its token verifier, see
   CLAUDE.md's gotcha). CRITICAL: verify expired-session refresh still works — the @supabase/ssr
   middleware client refreshes via its cookie handlers; PROVE it: check what getClaims does on an
   expired token in the installed @supabase/supabase-js version (read node_modules source if needed)
   and document the finding in the report. If getClaims does NOT trigger refresh, keep getUser ONLY
   when claims are expired (fast path local, slow path remote) — a 5-line hybrid.
2. `lib/auth/guard.ts`: wrap the per-request principal resolution in React `cache()` (dedupe within
   one render pass) AND add a module-level TTL map (~60s, keyed by auth user id) in front of the
   `app_resolve_principal` SQL — serverless instances make this a best-effort warm-cache, which is
   exactly enough. Invalidation nuance: role/field-crew changes take ≤60s to propagate — acceptable;
   note it in a comment.
3. **Server-Timing**: middleware sets `Server-Timing: auth;dur=<ms>` on the response; guard adds
   `guard;dur=` + `resolve;dur=` (via headers() where writable, else log them via the structured
   logger — do what the framework permits, report what you chose).
- [ ] Tests: existing auth int/unit suites stay green; add a unit test for the TTL cache (fake
  clock: within TTL → no second resolve; after TTL → resolves again). Manual: login + an
  expired-token refresh check on the dev server (document how you verified). Commit
  `perf(auth): local-JWT middleware verify + cached principal resolve + Server-Timing`.

### Task P3: Payload + query hygiene — dynamic modals, my-day refetch, skeletons

**Files:** `components/modals/modal-host.tsx` · `app/(field)/my-day/page.tsx` (+ my-hours,
messages) · `app/(office)/loading.tsx` · `app/(office)/jobs/[id]/page.tsx`.

1. **modal-host**: convert all 22 static modal imports to `next/dynamic` (`{ ssr: false }`) —
   mechanical; the host renders by key so the dynamic components slot in unchanged. Record the
   BEFORE/AFTER route-size table (`npm run build` route output + the modal chunk's gzip size) in
   the report — the 261KB chunk must leave the shared/first-load set.
2. **my-day**: add `refetchOnWindowFocus: false` to the page's `useQuery` options (match the
   field-jobs-hydrator); same check for my-hours + messages pages.
3. **Skeletons**: replace every "Loading…" text branch in the touched pages + `app/(office)/loading.tsx`
   with P1's `.sk`/`.sk-row` primitives — my-day: 3× sk-row (44px circle + two bars 60%/40%);
   jobs/[id]: title bar + 2 card blocks; office loading.tsx: a page-shaped block. RULE: a skeleton
   has the SAME box metrics as the row it becomes — zero layout shift on data arrival.
- [ ] Gate + screenshot the my-day skeleton state (throttled reload). Commit
  `perf(client): dynamic modal chunks, my-day refetch hygiene, skeletons over loading text`.

### Task P4: Render-storm quick wins — shell selectors, memoized derives, rAF drag

**Files:** `components/shell/sidebar.tsx` + `mobile-tabs.tsx` + `section-tabs.tsx` ·
`features/jobs/jobs-home.tsx` · `features/money/money-ledger.tsx` · `features/jobs/schedule-panel.tsx`.

1. **Shell chrome selectors**: replace full-array subscriptions (`useAppStore((s) => s.jobs)` etc.)
   with primitive selectors returning the COUNT the badge actually renders (compute inside the
   selector; primitive return = referential-equality win). Sidebar/mobile-tabs/section-tabs must no
   longer re-render on unrelated store writes. Also sidebar: don't blank the whole nav on
   `me.isLoading` — render the static nav immediately and gate only the role-conditional items.
2. **Memoize derives**: `jobs-home.tsx` (deriveOnTrucks/selectBands/applyCrew) and
   `money-ledger.tsx` (deriveMoneyRows) → `useMemo` with real deps.
3. **rAF the board drag**: `schedule-panel.tsx` `move()` — schedule the store write via
   requestAnimationFrame (collapse to one `updateVisit` per frame; cancel pending on unmount/drop).
   ONLY the scheduling changes; the handler's logic and the board's markup stay identical.
- [ ] Tests: existing suites green (selectors changed = same rendered values — snapshot nothing);
  add a tiny unit test for any extracted selector helper. React-Profiler spot-check in the report:
  a store write no longer commits Sidebar/MobileTabs. Commit
  `perf(client): shell count-selectors, memoized derives, rAF board drag`.

### Task P5: Measurement + the recording (the judge-by-eye deliverable)

**Files:** none in-app (scripts + report only; screenshots/recordings under /tmp/tqshot/perf/).

- BEFORE numbers were captured in the diagnosis (modal chunk 261,417B raw / 65,257B gzip; middleware
  auth est. 100-400ms). Capture AFTER: (a) the build route/chunk table; (b) Server-Timing durations
  for 5 navs (owner@e2e, dev server, dedicated PORT); (c) Playwright p50/p95 click→content for
  office sidebar Dashboard→Jobs→Customers and field My day→My hours, 20 iterations, 4x CPU throttle
  via CDP; (d) a screen recording of: tjclock tap, mtab switch, modal open — before (main) vs after
  (branch), side by side if feasible (two dev servers on two ports).
- [ ] Write the numbers into the PR body + drop the recording path. This task gates the PR.

**→ Full gate, then ONE PR: "perf: Phase 1 — the Feel Kit + nav/payload/render quick wins".**

## Self-review (done)

- All 9 diagnosis quick-wins mapped: feel kit+blur+overlay → P1 · getClaims+cache → P2 ·
  modals+refetch+skeletons → P3 · selectors+memo+rAF → P4 · measurement → P5. ✓
- Diagnosis false-leads NOT re-included (FieldTimer tick, closed-modal subscriptions, staleTime=0). ✓
- Phase 2 structural items deliberately excluded (separate plan after Owen sees Phase 1). ✓
