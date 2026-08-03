# App Review notes

What to paste into App Store Connect → **App Review Information → Notes**, and the facts behind it.

Regenerate the demo shop before every submission or resubmission:

```
node --env-file=.env.local scripts/seed-app-review-org.mjs
node scripts/verify-app-review-path.mjs            # 13 checks + screenshots
```

The seed is idempotent — re-running converges onto the same shop and the same credentials, so
notes Apple already has stay valid.

---

## Paste this into App Review Information → Notes

> **Demo account (already verified — no email confirmation needed)**
> Email: `appreview@trymallet.com`
> Password: `Ridgeline-Review-7Q4t!2846`
>
> Mallet is job management for plumbing and trade contractors. The account is a sample shop with
> customers, scheduled work, quotes and invoices already in it.
>
> **To reach the LiDAR room scanner:**
>
> 1. Sign in with the account above. You land on the office screen.
> 2. Tap the **⊕** button in the centre of the bottom bar.
> 3. Tap **New quote**.
> 4. In the **Customer** field type `Alicia`, then tap **Alicia Brennan** in the list below it.
> 5. In the **Measure** card at the top, tap **Scan room**.
> 6. Type any room name, for example `Kitchen`, then tap **Start scanning**.
> 7. Allow camera access. Walk the phone around the room; tap **Done** to finish.
>
> Room scanning uses the device's LiDAR sensor through Apple's RoomPlan framework to build a
> dimensioned floor plan on the device. It cannot be done on the web, which is why this
> capability exists only in the app. Contractors use the resulting wall and floor measurements to
> price work that is billed by the square foot.
>
> **Requires an iPhone Pro, iPhone Pro Max or iPad Pro** — RoomPlan needs the LiDAR scanner and
> reports itself unavailable on models without it, so the **Scan room** button is hidden on those
> devices. On a non-LiDAR device the rest of the app works normally.
>
> A second route to the same scanner: tap **⋯** (top right) → **My day** → the 8:30 job
> **Estimate — whole-house repipe** → the **Quote** tab → **Scan a room**.

Word count: 195.

---

## Why this wording

**Credentials first, verified account.** Guideline 2.1 rejections for login-gated apps are almost
always "we could not sign in." The account is created through the Supabase Admin API with
`email_confirm: true`, so it is verified at creation and signs in with a password on the first
attempt. There is no confirmation link, no phone number and no SMS code anywhere in the path — a
reviewer cannot receive mail sent to Owen's domain, so any of those would be an unpassable gate.

**The composer path is primary because it is the most robust.** `/composer` is in the office route
group, whose layout mounts the settings hydrator, and the Measure card needs nothing but a
selected customer — no job in a particular state, no assignment, no prior scan.

The My-day path is listed second, and it carries **one deploy precondition**: it works on a cold
load only once the field layout also mounts `SettingsHydrator`. Before that change, a hard load of
`/my-day` left `measurementEstimating` at its `false` placeholder and the **Scan a room** row was
absent — while the same row appeared if you happened to soft-navigate in from an office route
first. `scripts/verify-app-review-path.mjs` check **4d** is that regression: run it against the
deployed app and confirm 4d passes before relying on the second route. The composer route in the
numbered steps is unaffected either way.

**The LiDAR sentence is the 4.2 argument, placed where the reviewer reads it.** Minimum-
functionality rejections for a web-backed app turn on whether the app does something the website
cannot. Stating the sensor, the framework, that the work happens on-device, and what the
contractor does with the output answers that in three lines.

**The device requirement is stated plainly.** If a reviewer picks a non-Pro iPhone, the button is
correctly hidden and the app looks like it is missing its headline feature. Naming the requirement
converts a silent absence into an expected one.

---

## Exactly what makes the scan control appear

`components/modals/tech-job-modal/quote-tab.tsx` renders the **Scan a room** row only when all
three of these hold:

```
measurementEstimating && scanAvailable && !readOnly
```

| Condition | Source | True in the demo shop because |
| --- | --- | --- |
| `measurementEstimating` | `store.toggles`, written only by `SettingsHydrator` from `org_settings.measurement_estimating` | the seed sets that column to `true` |
| `scanAvailable` | `useRoomScanAvailable()` → the native `MalletRoomScan` plugin's `available()`, which returns `RoomCaptureSession.isSupported` | the shell registers the plugin and the device has LiDAR |
| `!readOnly` | the job is not closed | the demo job is `scheduled` |

The composer's **Scan room** button (`app/(office)/composer/measured-surfaces-panel.tsx`) uses the
same two gates plus a selected customer.

**The row is invisible in a browser, and that is correct.** `roomScanPlugin()` reads
`window.Capacitor.Plugins.MalletRoomScan`, which only exists inside the native shell — Capacitor
injects it with a `WKUserScript` scoped to the webview. In mobile Safari, in Chrome, and in any
Playwright run without a stub, `scanAvailable` is `false` and no scan control renders anywhere.
Testing the app at `app.trymallet.com` in a browser will therefore never show it. The reviewer is
in the shell, so this does not affect them; `scripts/verify-app-review-path.mjs` installs the same
plugin shape the shell injects in order to exercise the render path from a desktop browser.

`available()` reflects the LiDAR gate only. It does **not** check camera permission: a Pro device
whose owner denied camera can still report `available: true`, and the denial surfaces later as a
`captureRoom` rejection. Hence step 7's "Allow camera access".

---

## The demo shop

Org `Apple Review — Ridgeline Plumbing`, a small Central Oregon plumbing outfit. Created and
maintained solely by `scripts/seed-app-review-org.mjs`; the fixture lives in
`scripts/app-review/shop-data.mjs`.

- 3 staff — the reviewer's owner login (Dana Whitfield, also field crew so she has a My day) and
  two technicians
- 17 customers with real-shaped names, `+1 541 555-01xx` numbers (the reserved fiction block) and
  Bend-area addresses, spread across every pipeline stage
- 8 jobs: four on today's board including one in progress, one unscheduled, two finished and
  invoiced, one finished and deliberately unbilled
- 4 quotes (two out, one won, one draft), 2 invoices (one paid, one inside terms)
- 16 pricebook services, two of them measurement-priced — wall access per sq ft and hydronic
  baseboard per ln ft — so a room scan produces a number the price multiplies
- `frontDesk` is **off** and must stay off: switching it on provisions a real phone number and
  answers real calls

Nothing in it is placeholder text. A reviewer reads the demo account as a sample of the product.
