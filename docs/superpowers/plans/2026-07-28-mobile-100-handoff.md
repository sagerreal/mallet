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

Two more collapsed when items 1–3 below were re-measured before being actioned. They are written
into their own sections, but in short: **item 2's stated cause and stated remedy are both wrong**
(only 9 of the 24 client pages touch the store, and page-level code is 1–5% of the bytes), and
**item 1's "19 regular / 64 irregular" split was an artifact of the `Field` API, not the markup**
(42 of the 64 were one missing prop away from mechanical). That makes **nine of thirteen** verified
findings in this line of work wrong. Assume the tenth is too until you have measured it.

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

### 1. Form labels — DONE (PR #248)

**Shipped.** Read the rest of this section for what the measurement got wrong, then move on.

Re-measuring found **85** sites across 26 files, not 83 — and the "19 mechanically regular / 64
irregular" split was **an artifact of the `Field` primitive's API, not of the markup**:

| why a site counted as "irregular" | n |
|---|---|
| only a layout style on the wrapper (`<div className="field" style={{margin:"0"}}>`) | 36 |
| only a muted hint span inside the label | 6 |
| genuinely irregular (0 or 2+ controls, non-input control, extra markup) | 25 |

So 42 of the 64 were one missing prop away from mechanical. `Field` gained `style`/`className`/
`hint`, and three primitives now cover what it cannot own, so no site has to hand-roll `htmlFor`
again — which is how 85 unlabelled controls got here in the first place:
`FieldGroup` (a label naming a `role="group"`, for chip toggles), `useFieldId` (an htmlFor/id pair
for hand-laid-out rows), `useGroupLabel` (the group wiring as attributes, where a wrapper would
move pixels).

Four *silently* unassociated labels turned up on the way, each one also invisible to axe:

- `Field` only associated when it had **exactly one child**, so the invoice "Bill to" field
  (`<input list>` + `<datalist>`) rendered `htmlFor={undefined}`. Fixing it needs **one** child
  traversal for both finding and rendering: `Children.toArray` strips `null`/`false` children while
  `Children.map` visits them, so an index from one applied to the other picks the wrong node as
  soon as a call site has a conditional child.
- `AddressInput` and `TagInput` **swallowed `id`**, so a cloned id landed on nothing.
- **Six controls carried an `aria-label` duplicating their visible label.** `aria-label` OUTRANKS a
  `<label>` element, so those labels were decorative and `getByLabelText` matched nothing. If you
  add a label to a control that already has an `aria-label`, you have changed nothing.

Regression net: `components/ui/label-association.test.ts` fails on any bare sibling label, with
`file:line`. It was verified by *injecting* a regression, not by watching it pass.

### 1b. The original note on this category (kept for the reasoning)

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

### 2. Critical path: ~310 KB JS → under 170 KB (16%-weighted) — RE-MEASURED, PLAN WAS WRONG

**The 310 KB is real. The stated cause is wrong, and the stated remedy cannot reach the target.**

Measured against a production build (`pnpm build && PORT=3131 pnpm start`), reading
`performance.getEntriesByType("resource")` per route on a 390×844 viewport. Next 16 + Turbopack no
longer prints per-route sizes, so this figure **cannot be read off the build output** — it has to
come off the wire.

| route | total (wire) | shared floor | genuinely page-specific |
|---|---|---|---|
| /dashboard | 302 KB | 294 KB | **8 KB (2.6%)** |
| /pipeline | 300 KB | 294 KB | 6 KB (2.0%) |
| /tasks | 298 KB | 294 KB | 3 KB (1.1%) |
| /customers | 299 KB | 294 KB | 5 KB (1.7%) |
| /jobs | 310 KB | 294 KB | 16 KB (5.2%) |
| /money | 300 KB | 294 KB | 6 KB (1.9%) |

**17 chunks totalling 294 KB load on every office route.** Uncompressed that is ~1.06 MB to parse.
Per-route variance across all seven routes measured is 295–310 KB — a 15 KB spread.

Two consequences, both of which contradict the plan above:

1. **"They are client components because they read the Zustand store" is wrong.** 24 of 31 pages
   are `"use client"` — that part is right — but only **9 of those 24 import the store**. The other
   15 are client because of hooks and handlers (`useMe`, `useState`, `useRouter`, form `onSubmit`).
   For those, server conversion does **not** touch "where data enters the app", so the
   architectural objection does not apply to them.
2. **(b) is not "the only route to the byte budget" — it is not a route to it at all.** Converting
   every page to a server component can only remove that page's own client code: 1.1–5.2%. Even
   deleting **100%** of page-specific JS leaves the 294 KB shared floor, still **124 KB over** the
   170 KB target. The target lives entirely inside the shared graph (React + the app shell + the
   store + tRPC/React Query), not in the pages.

So: (a) `initialData` server-seeding is still worth doing for how it *feels* — and the note above
is right that it ships identical bytes and does not satisfy the criterion. But **do not schedule
(b) as a byte-reduction project**; it would spend architecture risk on ~2–5% of the payload. If the
170 KB line is genuinely wanted, the work is shrinking or splitting the shared chunk graph, which
is a different and larger project. Given LCP already passes at p75 2424 ms, question whether the
line is worth buying at all before buying it.

One thing already right: the Twilio Voice SDK (176 KB uncompressed) is **not** in the shared
floor — it is lazy-loaded. Don't "fix" it.

### 2b. The original note on this category (kept for the reasoning)

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

**Re-measured — this section holds up, with one correction to the ordering.** Verified: all 9
`--type-*` tokens are absolute px (11–44px); `.topbar` is `height:54px`; `#mobiletabs` is
`height:calc(60px + env(safe-area-inset-bottom))`; and prototype.css carries **80** fixed
`height:NNpx` declarations against 16 `min-height:NNpx`, so "layouts assume fixed text metrics" is
if anything understated. Two refinements:

- `-webkit-text-size-adjust` is **not set anywhere** in `app/` or `components/`, and the native
  shell does nothing with `preferredContentSizeCategory` / `adjustsFontForContentSizeCategory`. So
  nothing is actively *blocking* scaling — the px tokens just make it a no-op.
- `.uirow` is `min-height`, not `height`. It **grows** with text and does not clip. Separate the 80
  fixed heights from the 16 min-heights before estimating; only the former are a clipping risk.

**The correction: the token conversion is not "~10% of the work", it is the instrument that makes
the native question answerable — do it first.** Measured on /dashboard against a production build,
setting `document.documentElement.style.fontSize = "200%"` (the end state of *both* candidate
paths) moved the root from 16px to 32px and changed **nothing else**: `.topbar` 15px → 15px,
`h1` 24px → 24px, `body` 15px → 15px, every sampled height identical. So while the tokens are px, a
*successful* Dynamic Type signal arriving from iOS is indistinguishable from a failed one. You
cannot usefully prototype the native path first, and a phone test cannot tell you anything —
convert the tokens to rem, and only then does the phone report the truth.

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

**Postscript, after doing exactly that.** Item 1 shipped (#248). Items 2 and 3 were then measured
rather than started, and item 2 did not survive: its stated cause is wrong (only 9 of 24 client
pages touch the store) and its stated remedy reaches ~2–5% of the bytes against a target that sits
124 KB below the shared floor. Item 3 survived, but with its order reversed — the token conversion
has to come first, because until it does, a working Dynamic Type signal from iOS looks exactly like
a broken one.

The tally is now **nine of thirteen** findings wrong. Every one of them arrived with the texture of
evidence — a grep that returned zero, a single performance sample, a specific hex, a stated cause —
and none had a second observation behind it. The habit that catches this is cheap: before writing a
number down, ask what you would see if it were false, then go look. Inverting the grep, taking a
second sample, and computing the ratio each cost about a minute. Not doing it cost two days.
