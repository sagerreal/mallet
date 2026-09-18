# Mallet Design System

The single source of truth for how Mallet looks and behaves. One styling system
(`app/prototype.css`), one set of tokens, one set of primitives. This document is
the "why" behind the rules so they don't drift back.

> **There is exactly one styling system.** `prototype.css` holds the design tokens
> (`:root`), the base reset, and every semantic class. Tailwind was removed in full
> (there is no `tailwindcss` dependency, no `@theme`, no utility classes) — if you
> reach for `text-sm` / `flex` / `gap-2`, it will silently do nothing. Style with the
> tokens and the primitives below.

---

## 1. Tokens — never hard-code a magic number

All spacing, type, radius, and elevation come from CSS custom properties defined in
`app/prototype.css :root`. Inline styles reference them as `var(--…)`; stylelint
enforces this for CSS files (`declaration-property-value-allowed-list`).

### Spacing — a 4px grid (`--space-*`)

| token | px | | token | px |
|---|---|---|---|---|
| `--space-2xs` | 2 | | `--space-5` | 20 |
| `--space-1` | 4 | | `--space-6` | 24 |
| `--space-2` | 8 | | `--space-8` | 32 |
| `--space-3` | 12 | | `--space-10` | 40 |
| `--space-4` | 16 | | | |

`--space-2xs` (2px) exists only for optical nudges; don't reach past it for real
layout. When an off-scale value must snap, **ties round up** (the established
precedent — e.g. a 6px value between 4 and 8 becomes 8).

### Type (`--type-*`)

`xs 11 · sm 12 · base 13 · md 15 · lg 17 · xl 20 · 2xl 24 · 3xl 32 · 4xl 44`

> Named `--type-*`, **not** `--text-*` — the latter was Tailwind v4's namespace and
> collided (a scale named `--text-*` silently resized every text utility). The name
> stays `--type-*` even though Tailwind is gone, so nothing has to change.

### Radius (`--radius-*`)

`2xs 4 · xs 6 · sm 9 · md 10 · (base) 12 · lg 16 · xl 20 · pill 999`

> **`--radius-pill` (999px) is a sentinel for fully-round** — pills and circular
> avatars. It is NOT interchangeable with `--radius-xl` (20px): a 46px avatar at 20px
> is a rounded square. A codemod once snapped `999 → radius-xl` and flattened every
> avatar; that's why this is called out.

### Fonts

`--font-display` (Space Grotesk, headings) · body (Inter) · `--font-mono`
(Space Mono, figures — money, job/quote #s). Each token leads with the next/font
variable (`var(--font-inter)` etc.) so the optimised, self-hosted face resolves,
then the literal name as a fallback.

### Elevation & focus

`--shadow-sm` / `--shadow` / `--shadow-lg`, and the global `:focus-visible` ring.
Base `line-height: 1.5` lives on `body`.

---

## 2. Primitives — don't hand-roll what exists

`components/ui/` (the visual layer) and `components/shared/` (behavioural helpers).
Every one renders a `prototype.css` class; none carry per-surface style hacks.

| primitive | renders | use for |
|---|---|---|
| `Button` | `.btn` (+ `primary`/`quiet`/`danger`, `sm`) | every button — one height set, one focus ring |
| `Card` | `.card` (forwards `style` for per-instance layout) | bordered surfaces |
| `Badge` | `.pill` (+ tone) | flat status/label pills |
| `Field` / `Input` / `Select` | `.field` wrapper + descendant-styled controls | labelled form fields |
| `COMPACT_INPUT` (const) | inline compact treatment | dense inputs that must override `.field input` sizing |
| `PageHeader` | `.pagehead` (title + actions + optional subtitle) | the one page/section header — hidden on mobile BY CONTRACT (SectionTabs is the mobile page identity; actions need a `.mob-new` home) |
| `Sheet` | in-flow titled card (not a modal) | expand-below-trigger panels |
| `Row` | `.uirow` (renders `<button>` when interactive) | list rows that are clickable |
| `DisclosureRow` | `.fdd` (label over live value, editor expands in-flow) | staged/optional form inputs — the collapsed value IS the summary; never for a form's 2-3 essentials (open `.field`s) or a single action (a button) |

Shared behaviour: `FirstRunEmptyState`, `ListLoading`, `LoadFailed`, `SavedFlash` +
`useSaveFlash`, `StagePill`, `WriteErrorToast`, `ViewToggle`.

### Vertical rhythm

`.stack-1 … .stack-4` — `margin-top` on subsequent siblings (block flow, so margins
collapse). The prototype-native replacement for the old `space-y-*` utility.

---

## 3. State & feedback rules

### The four list states (mutually exclusive)

Every list surface renders exactly one of, driven by `lib/first-run.ts`:

1. **`isFirstLoad`** — first fetch in flight, store empty → quiet `Loading…`
   (`ListLoading`, `aria-busy`). Never the first-run screen, never the chrome.
2. **`shouldShowLoadFailed`** — errored with no cached rows → `LoadFailed`
   (`role="alert"` + Try again). A failed load is NOT "no data".
3. **`shouldShowFirstRun`** — loaded, no error, count 0 → `FirstRunEmptyState`
   (an invitation to act, not a dead end).
4. **populated** — the list. A refetch that fails while rows are cached keeps the
   rows (stale data beats an error screen).

### Success & failure feedback (visibility of status)

- **Store writes stay quiet** — optimistic UI is its own feedback. On failure they
  roll back and surface `WriteErrorToast` (no silent failures).
- **Explicit Save buttons flash** `Saved ✓` for 2s via `useSaveFlash` — the only
  sign a commit-on-click worked. Call `flash()` on success, `reset()` on change.

### Clickable rows without nested-interactive a11y errors

`.rowopen` pattern: the container keeps its mouse `onClick` but drops
`role="button"`/`tabIndex`; a focusable child `<button>` (chrome-reset, with
`stopPropagation`) provides keyboard access. Fixes row-in-button a11y nodes.

---

## 4. Accessibility floor (enforced)

`e2e/a11y.spec.ts` runs axe on 25 routes. **Zero violations, enforcing** —
`A11Y_MAX` defaults to `0`, so any regression fails the build. Keyboard operability
has its own specs. Contrast: body/secondary/tertiary ink are all verified ≥ 4.5:1 on
both surfaces and both themes.

> Honest cap: automated tooling catches roughly half of WCAG. A certified AA pass
> needs a human with a screen reader — the automated floor is a verified 9, not a
> certified 10.

---

## 5. The visual + a11y net (how changes are proven)

- `e2e/visual.spec.ts` — 25+ routes × light/dark (+ mobile), Playwright
  `toHaveScreenshot`, **absolute `maxDiffPixels: 150`** (a ratio scales with page
  height and hid a real change).
- `e2e/visual-modals.spec.ts` — modals + the two dynamic detail routes, driven via a
  dev-only `window.__appStore.openModal(id, params)` handle reading seeded ids.
- `e2e/helpers/ui.ts` — `prepare()` freezes `Date` + pins theme before boot;
  `settle()` waits networkidle + fonts.ready + scroll-primes the page (kills the
  font-swap flake on long lists); `dynamicRegions()` masks wall-clock-derived text.

Run with `E2E_VISUAL=1`. Pixel-moving changes are re-baselined **deliberately**
(review the diffs — that review IS the value), never blanket `--update`.

---

## 6. House rules (design)

- **No floating UI** — no popovers/portals/floating insets; panels expand in-flow,
  anchored and flush. Suggestion lists render under their input.
- **Copy is functional, not chatty** — errors name the actual problem and the next
  step; an action keeps its verb through the whole flow.
- **Progressive disclosure** — max ~2 levels; reveal detail on demand (a `More`
  fold), don't wall the user with every field at once.
- **No dead buttons, no sample data** — wire a control or delete it; everything is
  DB-backed.

---

## 7. Working on the UI

1. Style with `var(--…)` tokens + the primitives above — never a raw px magic
   number, never a Tailwind class.
2. New list surface → wire all four states from `lib/first-run.ts`.
3. Touching pixels → run the visual net; re-baseline deliberately with screenshots.
4. Run the full gate before a PR: `npx tsc --noEmit` · `npm run lint` · unit ·
   `npm run build` · the visual + a11y nets.
