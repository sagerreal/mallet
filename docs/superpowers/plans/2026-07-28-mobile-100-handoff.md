# Mobile quality — handoff

**Supersedes `2026-07-27-mobile-100.md`.** That plan's category scores and several of its
findings are now known to be wrong; this document says which and why.

Read this before doing any mobile work. Most of it is things that cost hours to learn.

---

## Where it stands

Mallet runs natively on iPhone (Capacitor shell → `app.trymallet.com`, see
`mallet-ios/README.md`). Twelve PRs shipped, #232–#246. Score moved from a raw **34.1** to
roughly **80** on a 7-category weighted rubric built from Apple HIG, WCAG 2.2, Core Web
Vitals and the WebKit/Capacitor docs.

| PR | what |
|---|---|
| #232 | 16px input floor (killed iOS zoom-on-tap), 44px targets, `.btn:focus-visible`, touch-callout, overscroll |
| #233 | **credential leak** — all 5 auth forms could native-GET the password into the URL |
| #234 | `prefers-reduced-motion` left every loading skeleton pulsing |
| #235 | recovered #233/#234 after stacked-PR bases stranded them off main |
| #236 | keyboard: `inputMode` on all 42 numeric fields, `interactiveWidget`, `scroll-padding` |
| #237 | control borders were **1.07:1** — invisible in sunlight; `--line-strong` solved to ≥3:1 |
| #238 | `enterKeyHint` — the action key said "return" on 213 controls |
| #239 | **back affordance** — `router.back()` appeared zero times; 6 routes were dead ends |
| #241 | haptics on writes + launch screen hides when ready |
| #242 | form labels were never associated with their controls (`Field` primitive) |
| #245 | dark mode follows the system; dark controls got a real background |
| #246 | **re-baselined the visual net against a production build** |

---

## Read this before you trust any measurement

### The visual net must run against a PRODUCTION build

```bash
pnpm build && PORT=3131 pnpm start
E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3131 npx playwright test e2e/visual.spec.ts
```

`next dev` renders the Next dev-tools badge, which does not exist in production. Before #246,
**68 of 78 snapshots failed against production** — the net could not validate what ships. Worse,
the badge appears and disappears *during* a dev session, so dev-vs-dev runs were
nondeterministic: one change looked like it moved **48** snapshots when it moved **3**.

Post-#246 the net is deterministic — two consecutive runs, 78 passed, zero variance. Keep it
that way. **If a run is noisy, suspect the server it is pointed at before you suspect the diff.**

Any "30 baseline" figure in PRs #232–#245 was a dev-server number.

### The audit was wrong more often than it was right

**Seven of eleven findings I verified did not survive.** Do not action the old plan doc without
re-measuring. The ones that collapsed, so nobody re-chases them:

- **"0 skeletons or spinners exist"** — false. The grep was for `skeleton|shimmer|spinner`; the
  primitives are `.sk` / `.sk-row`. There is a `ListLoading` primitive in 11 surfaces plus a
  route-level `app/(office)/loading.tsx`.
- **"LCP 4892ms on /dashboard"** — n=1 noise. n=12 gives p75 **2424ms**. All routes pass 2500ms.
- **"Fonts are 897 KB, 98% of bytes"** — probe artifact. Fonts are **88.5 KiB** and the plumbing
  is already correct (19 `@font-face`, 100% WOFF2, `font-display`, subset to latin). **JS is the
  weight.**
- **"CLS 0.51 on /settings"** — one-off. It is **0** over 6 samples.
- **"54 targets under 24px"** — those are `.rowopen` keyboard proxies nested inside 292×182 card
  targets that do respond to taps. An intentional documented pattern.
- **"8 `100vh` hits"** — only one is user-facing at mobile width. `#aidrawer`, `tourCoach` and
  `setup-panel` are **dead CSS nothing renders**.
- **"43% of controls have no pressed state"** — method error: `:active` applies to the whole
  activation chain, not one node. Real figure ~20%.

Also wrong: the audit's suggested contrast token `#B9AF9C` "at 3.2:1" computes to **2.12:1**. It
would have shipped a still-failing fix. **Solve colour values; don't accept a suggested hex.**

### Never stack PRs

Owen merges within *seconds*, top-down. A PR based on another PR's branch merges into a branch
that is already dead and never reaches main. This has now happened **five times** (#137, #233,
#234). Always `--base main`. Verify a merge landed with `git log origin/main`, not the PR state —
`gh pr view` reports MERGED either way.

Better still: **verify against production**, not GitHub. `curl` the deployed asset and grep for a
distinctive string from your change. One trap: the login page references **two** CSS chunks and
the small 6 KB one has none of the app styles — search every `/_next/static/**/*.css`.

### Other traps

- A **filtered a11y run truncates `e2e/.a11y-baseline.json`**. Run it unfiltered, or restore that
  file before committing.
- `e2e/field.spec.ts` is **stale, not just broken**: it waits on `getByLabel("Rate ($)")` and that
  label exists nowhere in the app. It tests a redesigned quote flow.
- `git checkout -- app` reverts `app/prototype.css` too. It has bitten twice.
- Two visual-net runs do not fit in one 10-minute tool call. Split them.

---

## What is left, and what each item actually costs

### 1. Form labels — 83 sites (14%-weighted category)

`Field` (`components/ui/input.tsx`) was fixed in #242 and now associates correctly via `useId()`,
covering **50** fields. But **83 hand-rolled `<label>` sites remain** across 26 files, and they
are already violations of the "compose the primitives" house rule.

Measured split:
- **19 are mechanically regular** — `<div className="field"><label>X</label><control/></div>`.
  Convert to `<Field label="X">{control}</Field>`. `Field` uses `useId()`, so this is safe even
  inside a `.map()`.
- **64 are irregular** — nested markup, hint text, or several controls per label. Per-site work.
  Either extend the primitive to accept a hint and associate the *first* control, or add
  `htmlFor`/`id` by hand.

Worst files: `new-customer-modal` (8), `job-modal` (7), `booking-service-card` (6),
`new-job-modal` (6), `invoice-modal` (6).

**Assert with `getByLabelText`**, which resolves the control *through* the label exactly as a
screen reader and Playwright do. Asserting the attribute exists proves much less.

⚠️ **axe passes this defect.** It sees the placeholder, decides the control has an accessible
name, and goes green. Your a11y gate has that blind spot.

### 2. Critical path: ~310 KB JS → under 170 KB (16%-weighted) — ARCHITECTURE

**24 of 31 pages are `"use client"`.** They are client components *because they read the Zustand
store*, which hydrators fill from tRPC on mount. The LCP element is **text** on every route, so
first paint waits on ~310 KB downloading, parsing and hydrating.

Two different projects get conflated here:

- **(a) Server-seed the first screen** via tRPC `initialData`. Precedent exists and works:
  `features/identity/hooks.ts:8` (the `resolveMe` fix, #135). Extend to `/dashboard`,
  `/pipeline`, `/tasks`. Moderate. Makes it **feel** fast — content paints from server HTML
  instead of after hydration. **Ships identical bytes, so it does NOT satisfy the criterion.**
- **(b) Convert pages to server components.** The only route to the byte budget. Server-rendering
  a page means its data cannot come from the store — so this changes **where data enters the
  app**, i.e. the spine of the design in CLAUDE.md.

Do (a) for the user. Do (b) only as a deliberate, scheduled architecture decision.

### 3. Dynamic Type → rem (13%-weighted) — ARCHITECTURE

All 9 `--type-*` tokens are absolute px, so the OS text-size setting does nothing.

Converting the tokens is ~10% of the work. The rest is that **layouts assume fixed text
metrics**: `#mobiletabs` 60px, `.topbar` 54px, `.uirow` min-height 48px, tables with fixed
columns, labels relying on single-line truncation. At 200% those clip or overflow. Plus a full
visual re-baseline in both themes and both viewports.

⚠️ **Unverified and must be prototyped first:** iOS Dynamic Type does **not** resize web text
inside a WKWebView by default. You either lean on `-webkit-text-size-adjust`, or read
`preferredContentSizeCategory` natively and inject it as the root font-size. That is a
native↔web integration, not a CSS change. **Nobody has confirmed which path works in Capacitor.**

### 4. Small, known, unshipped

- **`e2e/field.spec.ts`** — stale, see above.
- **Two transitions animate layout properties**: `.switch::after{transition:all}` and a
  `grid-template-rows` accordion. Move to transform.
- **Motion tokens** — 49 transitions are already `.12s` and 11 are `.15s`; promote to
  `--dur-*` / `--ease-*`.
- **`Space_Mono` 700** — a whole font file for numeric accents. Drop to 400.
- **Service worker** — mobile web has no offline at all. The native shell has
  `errorPath` → `offline.html`, but that is cold-start only; there is no mid-session offline.

### 5. Owed to Owen, not code

**The haptics reinstall.** #241's web half is live, but `@capacitor/haptics` compiles into the
binary. With the phone connected:

```bash
cd mallet-ios/shell && npx cap sync ios
cd ios/App && xcodebuild -project App.xcodeproj -scheme App \
  -destination 'id=<udid>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <udid> <path>/App.app
```

`mallet-ios` is committed locally at `fcb1bf0` and has **no remote**.

---

## Honest framing for whoever picks this up

The rubric is a proxy; the goal is that a plumber can run their business one-handed, in gloves,
on bad cellular. Items 2 and 3 are architecture changes whose sole justification is a rubric
line-item — and LCP already passes p75.

Given that seven of eleven audit findings were wrong, **treat the remaining rubric items as
hypotheses to verify, not a backlog to burn down.** Measure first. Owen has said to do all three;
that is his call, and it is recorded here so the reasoning is not lost.
