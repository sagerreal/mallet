# App Review notes

What to paste into App Store Connect → **App Review Information → Notes**, and the facts behind it.

Regenerate the demo shop before every submission or resubmission:

```
node --env-file=.env.local scripts/seed-app-review-org.mjs
node scripts/verify-app-review-path.mjs            # 13 checks — scanner LIVE (an iPhone Pro)
node scripts/verify-app-review-path.mjs --no-lidar # the same path on a BASE iPhone
node scripts/verify-app-review-path.mjs --no-stub  # the same path in a plain browser
```

All three must pass. The last two are what a reviewer on a non-Pro device sees, and you do not
get to choose the device Apple reviews on.

The seed is idempotent — re-running converges onto the same shop and the same credentials, so
notes Apple already has stay valid.

---

## Paste this into App Review Information → Notes

The canonical copy of this text — the one to paste — lives in
[`docs/app-store/listing.md`](app-store/listing.md) alongside every other App Store Connect field.
It is reproduced here because the reasoning below is about this wording specifically.

> Demo account (verified — no email confirmation, no SMS code):
> Email: `appreview@trymallet.com`
> Password: `Ridgeline-Review-7Q4t!2846`
>
> Mallet is job management for plumbing and trade contractors. This sample shop already has
> customers, scheduled work, quotes and invoices in it.
>
> **To reach the LiDAR room scanner:**
>
> 1. Sign in. You land on the office screen.
> 2. Tap the circled **+** in the centre of the bottom bar, then tap **New quote**.
> 3. In the **Customer** field type `Alicia`, then tap **Alicia Brennan**.
> 4. In the **Measure** card at the top, tap **Scan room**.
> 5. Type any room name, then tap **Start scanning**.
> 6. Allow camera access, walk the phone around the room, tap **Done**.
>
> Room scanning uses the device's LiDAR sensor through Apple's RoomPlan framework to build a
> dimensioned floor plan on device. RoomPlan has no web API, so this cannot be done in a browser.
> Contractors price wall and floor work from the measurements.
>
> **Requires an iPhone Pro, iPhone Pro Max or iPad Pro** — RoomPlan needs the LiDAR scanner and
> reports itself unavailable on models without it. On a model without LiDAR the **Scan room**
> button is still shown, disabled, reading "This device reports no LiDAR sensor — room scanning
> needs an iPhone Pro or iPad Pro." The rest of the app works normally on any device.
>
> **Charge a card** reports that Stripe setup is incomplete: every shop connects its own Stripe
> account and this sample shop has none.

Word count: 255 (Apple's field is capped at 4000 characters; the constraint that matters is that a
reviewer reads it).

A second route to the same scanner, kept **out** of the pasted text because it is date-sensitive —
see below — but useful to Owen: tap **⋯** (top right) → **My day** → the 8:30 job
**Estimate — whole-house repipe** → the **Quote** tab → **Scan a room**.

---

## Why this wording

**Credentials first, verified account.** Guideline 2.1 rejections for login-gated apps are almost
always "we could not sign in." The account is created through the Supabase Admin API with
`email_confirm: true`, so it is verified at creation and signs in with a password on the first
attempt. There is no confirmation link, no phone number and no SMS code anywhere in the path — a
reviewer cannot receive mail sent to Owen's domain, so any of those would be an unpassable gate.

**The composer path is primary because it is the most robust, and because it is the only one that
does not rot.** `/composer` is in the office route group, whose layout mounts the settings
hydrator, and the Measure card needs nothing but a selected customer — no job in a particular
state, no assignment, no prior scan. Crucially it is also **date-independent**: `shop-data.mjs`
gives every job a `dayOffset` relative to *now* and the seeder resolves it in SQL at seed time, so
the shop is only "today" on the day it was seeded. Apple normally reviews one to three days after
submission, by which point My day is empty and any walkthrough that starts there dead-ends on a
blank agenda. That is why the numbered steps never mention My day, and why the click-list in
`docs/app-store/listing.md` puts a re-seed immediately before Submit and another one every couple
of days the review stays pending.

**The Charge-a-card sentence exists so a working error does not read as a broken app.** The
invoice's primary button is `Charge a card — $304`, and on this shop it returns "this shop hasn't
finished Stripe payment setup". That is correct — every shop connects its own Stripe account — but
a reviewer will press the primary button, so the note gets there first.

The My-day path is kept out of the pasted text but recorded above, and it used to carry a deploy
precondition on top of the date problem: on a cold load it worked only once the field layout
mounted a settings hydrator, because a hard load of `/my-day` otherwise left
`measurementEstimating` at a `false` placeholder and the **Scan a room** row was
absent — while the same row appeared if you happened to soft-navigate in from an office route
first. That class of failure is now closed at the root: the gate is a THREE-state value
(`lib/measurement-gate.ts`) and "not loaded" is not "off", so an unhydrated or failed settings read
leaves the affordance on screen. `scripts/verify-app-review-path.mjs` checks **4d**, **6c** and
**7e** cover the cold load, the technician's own surface, and a settings read that 500s.

**The LiDAR sentence is the 4.2 argument, placed where the reviewer reads it.** Minimum-
functionality rejections for a web-backed app turn on whether the app does something the website
cannot. Stating the sensor, the framework, that the work happens on-device, and what the
contractor does with the output answers that in three lines.

**The device requirement is stated plainly, and the app now says it too.** The scan control used
to be HIDDEN whenever it could not run. A reviewer on a base iPhone therefore saw no scanner at
all — no native functionality, on the exact capability the 4.2 argument rests on — and had no way
to tell a missing feature from an unsupported device. The control now renders on every device and
states the reason it cannot run, so the note above and the screen agree.

---

## Exactly what makes the scan control appear

`components/modals/tech-job-modal/quote-tab.tsx` renders the **Scan a room** row whenever:

```
measurementSurfacesVisible(measurementGate)      // i.e. gate !== "off"
```

That is the ONLY thing that hides it. Everything else that can stand in the way renders the
control DISABLED with the reason attached — a closed job, a device without LiDAR, a browser, a
composer with no customer picked yet, or a settings read that never landed.

| Condition | Source | True in the demo shop because |
| --- | --- | --- |
| gate is not `"off"` | a tri-state (`on`/`off`/`unknown`) resolved SERVER-SIDE by the office/field layouts (`lib/auth/server-measurement-gate.ts`) and read through `features/settings/measurement-gate-provider.tsx`, which prefers the client store once `SettingsHydrator` (office) or `FieldTogglesHydrator` (tech) has written a real answer | the seed sets `org_settings.measurement_estimating` to `true` — and a read that fails leaves `"unknown"`, which still shows the control |

**The gate FAILS OPEN, and that is deliberate.** It used to be a boolean whose pre-hydration
placeholder was `false`, with `SettingsHydrator` its only writer — so one 500 from
`v1.settings.get` (which happened, on a malformed settings blob) removed the composer's entire
Measure card and every scan control in the app, with no reason shown anywhere. A read that did not
answer is not an answer. See `lib/measurement-gate.ts`.

**Open means VISIBLE, not LIVE.** On `"unknown"` the control renders disabled with its own
sentence — "Couldn't load this shop's settings — reload the page to scan a room." — rather than
staying tappable. Tapping creates an estimate job server-side, so a live scanner during a settings
outage would write rows into a shop that may have turned measuring off on purpose. The
guideline-4.2 answer stays on screen either way; only the writing stops.

**The gate is answered before the first paint.** It is resolved in the layout, beside the shell
identity (`resolveMe`), so `/composer` and `/my-day` are server-rendered already knowing whether
this shop measures. Previously the only writers were client hydrators, so every cold load painted
the Measure card and then removed it a beat later for the non-measuring trades — plumbing, HVAC,
electrical, i.e. most shops. `"unknown"` now means what it says: the read failed.

**A technician reads a different, narrower endpoint.** `v1.settings.get` is `ownerOrOffice` and
returns the whole office configuration, so the field layout can only mount `SettingsHydrator` for
owner/office. Techs get `v1.settings.fieldToggles` (`anyRole`, one boolean) instead — without it,
`store.toggles` was never written for the role the field scanner exists for, so the row could not
render there on any device.

**The trade can no longer switch this off behind the user.** `setTrade` derives the flag from the
trade's pricebook, and the Front Desk's always-visible "Starter playbook" button used to pass a
display LABEL to it — which matched no pricebook, resolved to false, and wrote
`measurement_estimating: false` to the database. A reviewer poking at Front Desk could destroy the
scanner for the rest of the review. The trade may now GRANT measuring and never revokes it, and the
router accepts only real trade keys.

**Whether the device can scan decides LIVE vs DISABLED, never shown vs hidden.**
`useRoomScanAvailability()` returns a status, not a boolean, and the row renders in all of them:

| Status | Reached when | The row |
| --- | --- | --- |
| `ready` | in the shell, plugin registered, `available()` true | live |
| `no-lidar` | in the shell, `available()` false — `RoomCaptureSession.isSupported` is false on a non-Pro model, **and in the iOS Simulator** | disabled — "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro." |
| `no-native-app` | no Capacitor bridge at all: any browser | disabled — "Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor." |
| `scanner-missing` | bridge present but the plugin is not registered on it (a shell BUILD fault — registration is a static manifest in `capacitorDidLoad`), or its probe rejected or timed out | disabled — "This version of the Mallet app is missing the room scanner — update the app in the App Store." |
| `checking` | the native probe is still in flight (shell only). It is bounded — `ROOM_SCAN_PROBE_TIMEOUT_MS` — so an unsettled promise can no longer strand a permanently disabled "Checking…" | disabled — "Checking whether this device can scan." |

`no-lidar` leads with what the device REPORTED rather than what phone to buy, because the report is
not always about the hardware: the iOS Simulator answers `isSupported: false` too, and the old
wording made a build under test read as the tester's phone being the wrong phone. The native side
is NOT asked to distinguish simulator from unsupported-device — App Review runs on physical
hardware, so that case is a developer/TestFlight one, and plumbing it through would need a
coordinated shell build in `mallet-ios` that the web side could not use until it shipped.

The composer's **Scan room** button (`app/(office)/composer/measured-surfaces-panel.tsx`) and the
room card's **Re-scan room** control behave identically — and the composer's renders BEFORE a
customer is picked (disabled, "Pick a customer first"), so the native affordance is on screen the
moment `/composer` loads rather than appearing at step 4. The copy for every status lives in one
place, `components/shared/scan-unavailable.tsx`.

On that composer row the missing-customer sentence outranks the device one, which is the only
place the device answer does not win. The row has TWO controls sharing ONE reason line, and
"+ Add a room" needs no scanner at all — so "open the Mallet iPhone app" would be false of the
button beside it, and it unblocks nothing in the office's browser, while picking a customer makes
"+ Add a room" live immediately. A reviewer on a base iPhone still gets the LiDAR sentence: it
appears on this same row the moment the customer is picked, which is the next step in the walk-
through (checks **3a** and **3c**).

**Two different "no"s, two different sentences.** `roomScanPlugin()` reads
`window.Capacitor.Plugins.MalletRoomScan`, which only exists inside the native shell — Capacitor
injects it with a `WKUserScript` scoped to the webview. So a browser is `no-native-app` and a base
iPhone is `no-lidar`, and they must not share a message: telling a desktop user to buy an iPhone
Pro is wrong, and telling someone already holding the app to open the app is useless.
`scripts/verify-app-review-path.mjs` proves all three states from a desktop browser — default
(stub says LiDAR), `--no-lidar` (stub says no LiDAR), `--no-stub` (no stub at all).

**Testing at `app.trymallet.com` in a browser now shows the scanner**, disabled, with the browser
reason. It previously showed nothing, which read as a broken build every time.

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
