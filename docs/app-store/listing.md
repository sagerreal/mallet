# App Store listing — Mallet 1.0

Everything that goes into App Store Connect, in the order Owen pastes it. Character limits are
Apple's; the counts in brackets are the actual length of the text as written here.

Nothing in this file has been uploaded. The binary facts live in
`mallet-ios/docs/app-store-submission.md`; the reviewer walkthrough lives in
`docs/app-review-notes.md`.

---

## DECISION: four things only Owen can settle

1. **The name "Mallet" is probably contested.** `MALLET.` (App Store id 1442692767, seller
   *Mallet.Footwear Ltd*, category Shopping) is live in the US and GB storefronts and was last
   updated 21 Jul 2026. Apple enforces uniqueness on the App Store name and normalises
   punctuation and case when it does — `Mallet` vs `MALLET.` differ only by a full stop, so the
   reservation may be refused. **Try `Mallet` first** in App Store Connect; it either takes it or
   it does not, and that is a ten-second test. If it is refused, use one of these (all ≤30, all
   still lead with the brand): `Mallet — Field Service` [22] · `Mallet Field Service` [20] ·
   `Mallet Trade Software` [21]. This is a listing-name collision only, not a trademark problem:
   footwear (Nice class 25) and trade software (classes 9/42) do not conflict.
2. **Does the AI front desk go in the description?** It is written into the Description below,
   labelled as off by default. Reason to cut it: switching the toggle on **provisions a real
   Twilio phone number and starts answering real calls**, and a curious reviewer with owner
   credentials can flip it. Reason to keep it: it is a real capability and a differentiator.
   If you cut it, delete the "OPTIONAL, OFF UNTIL YOU SET IT UP" block — nothing else refers to it.
3. **App Review contact.** Apple needs a first name, last name, phone number and email that a
   human answers within a day. I have not invented one. Fill in the App Review Information block.
4. **Fix the Geocoding billing before you submit, or the review note grows a line.** See
   *Reviewer-tripping defects* — "Measure from satellite" cannot look up an address on production
   right now.

---

## What Owen clicks, in order

Work top to bottom. Everything above the line is done; everything below is App Store Connect.

- [x] Screenshots captured at 1290 × 2796 — `docs/app-store/screenshots/`
- [x] Listing copy written — this file
- [x] App Privacy answers audited with evidence — below
- [ ] **Apple Distribution certificate + App Store provisioning profile** for `com.trymallet.app`
      (the export blocker in `mallet-ios/docs/app-store-submission.md` §1)
- [ ] Archive, export, upload the build (`xcodebuild archive` → `-exportArchive` → `altool`)
- [ ] App Store Connect → **My Apps → +** → name (see DECISION 1), primary language English (U.S.),
      bundle id `com.trymallet.app`, SKU `mallet-ios-1`
- [ ] **App Information** → Subtitle, Category (Business / Productivity), Content Rights, Age Rating
- [ ] **Pricing and Availability** → Free, all territories
- [ ] **App Privacy** → paste every answer from the App Privacy section below
- [ ] **1.0 Prepare for Submission** → Promotional text, Description, Keywords, Support URL,
      Marketing URL, Copyright
- [ ] Upload the six screenshots to **iPhone 6.9" Display** in the order 01 → 06
- [ ] Select the uploaded build. Export compliance does not prompt —
      `ITSAppUsesNonExemptEncryption=false` is already in the plist
- [ ] **App Review Information** → demo account, contact, and the Notes text below
- [ ] **RE-RUN THE DEMO SEED — do this immediately before you hit Submit.**
      ```
      node --env-file=.env.local scripts/seed-app-review-org.mjs
      node scripts/verify-app-review-path.mjs         # 13 checks, all must pass
      ```
      The demo shop's jobs are dated relative to the moment the seed runs, so "My day" empties out
      a day after seeding. Re-running is idempotent: same org, same rows, same password, so the
      credentials Apple already holds stay valid.
- [ ] **Submit for Review**
- [ ] **If review has not started after two days, re-run the seed again.** Same two commands. Do it
      as often as the wait continues — there is no downside and an empty My day reads as a broken app.

---

## App Name

**Limit 30.**

```
Mallet
```

[6] — see DECISION 1 for what to do if App Store Connect refuses it.

---

## Subtitle

**Limit 30.** Shown under the name in search results and on the product page.

```
Schedule, quote and get paid
```

[28] — says the job it does in the three words a shop owner would use, and the words are indexed
for search alongside the name, so they are deliberately not repeated in Keywords.

---

## Promotional text

**Limit 170.** Editable any time without shipping a build — this is the field to change when
something new lands.

```
For plumbing, HVAC and electrical shops running one to three trucks. Put the day on a board, price the work standing in the room, invoice before you leave the driveway.
```

[168]

---

## Description

**Limit 4000.**

```
Mallet is the app a small plumbing, HVAC or electrical shop runs the day on. The customers, the schedule, the quotes and the invoices live in one place instead of a notebook, a text thread and a spreadsheet that disagree with each other.

It is built for shops with one to three trucks, where the owner is usually still in the field.

THE DAY

My day gives each tech an agenda: the times, the addresses, the gate codes and the note the office left. Tap a job for the customer, one-tap navigation, and an On my way that tells the office you are moving.

The dispatch board puts the crew against the hours, with the work that still needs a slot sitting right beside it.

QUOTING

Build a quote from your own pricebook, at your prices and your labor rates, with your cost hidden behind one tap so you can see the margin before you send.

Describe the job in a sentence and Mallet drafts the itemized lines from that pricebook and from the quotes you have already won. Correct it and it learns the correction.

Send one price, or good, better and best. The customer opens it on their phone and accepts it there. Mallet tracks what has been viewed, what has been accepted, and what has gone quiet.

MEASURING

On an iPhone Pro, scan a room with the LiDAR sensor. Mallet builds a dimensioned floor plan on the device and turns it into wall area, floor area and baseboard length.

Price a service by the square foot or the linear foot and the scan fills the quantity in, so the number on the quote is the number in the room. No tape measure, no second visit to price the patch.

GETTING PAID

Turn a finished job into an invoice carrying what was sold plus whatever the tech found and added on site. Money shows what is ready to bill and what is still owed, job by job.

Record cash and checks as they come in. Connect your own Stripe account and you can charge a card from the invoice.

THE CREW

A day clock that exists to pay people: clock in, clock out, hours per person per week. Approve the week and push the hours straight to QuickBooks Online.

Per-job checklists so the same steps happen on every call, whoever is driving.

OPTIONAL, OFF UNTIL YOU SET IT UP

An AI front desk that answers the phone when nobody can pick up, books the call against your real availability, and hands anything urgent to a person. It stays off until you switch it on and give it a number.

WHAT YOU NEED

A Mallet account and a network connection. Room scanning needs an iPhone with a LiDAR sensor — on any other iPhone the rest of the app works normally and the scan button is simply not there.
```

[2576]

**Claims deliberately not made, and why.** Outbound SMS is gated on 10DLC campaign registration
that is not complete, so nothing here says Mallet texts your customers. Card payments require the
shop to finish Stripe Connect onboarding, so the sentence is conditional ("Connect your own Stripe
account and you can charge a card"). QuickBooks invoice and payment sync is built but switched off
pending a tax model, so only the approved-hours push is claimed. "Measure from satellite" is not
mentioned at all — it is broken on production (see the defects section).

---

## Keywords

**Limit 100.** Comma-separated, no space after the commas, and no word repeated from the App Name
or Subtitle (Apple indexes those already, so repeating wastes the field).

```
plumbing,hvac,electrician,contractor,estimate,invoice,dispatch,jobs,crew,trades,timesheet,billing
```

[97] — nothing here appears in "Mallet" or "Schedule, quote and get paid".

---

## Category

| | Value |
|---|---|
| **Primary** | Business |
| **Secondary** | Productivity |

**Business** is where a contractor looks and where every other field-service tool sits; the app is
a business record (customers, jobs, quotes, invoices, payroll hours) and nothing else.
**Productivity** as secondary because the day-planning and scheduling half of the app genuinely
belongs there. Deliberately not **Finance** — invoicing is one of five surfaces, and Finance puts
the app in a list of banking apps where a plumber is not shopping.

---

## Age rating

**Result: 4+.** Every question, and the reason.

| Question | Answer | Why |
|---|---|---|
| Cartoon or Fantasy Violence | None | No games, no illustrated content of any kind. |
| Realistic Violence | None | Same. |
| Prolonged Realistic Violence / Sadistic Violence | None | Same. |
| Profanity or Crude Humor | None | All copy is business language; the only free text is what the shop types about its own jobs. |
| Mature / Suggestive Themes | None | None present. |
| Horror / Fear Themes | None | None present. |
| Sexual Content or Nudity | None | None present. |
| Graphic Sexual Content and Nudity | None | None present. |
| Alcohol, Tobacco, or Drug Use or References | None | None present. |
| Medical / Treatment Information | None | Plumbing work, not health advice. |
| Simulated Gambling | None | No gambling of any kind. |
| Contests | None | No sweepstakes, no prizes. |
| Unrestricted Web Access | No | The webview is pinned to `app.trymallet.com`; there is no address bar and no in-app browser. Links that leave the app (Stripe hosted checkout, Apple/Google Maps navigation) are handed to the system browser, which is not an in-app browsing capability. |
| Gambling and Contests | No | Neither. |
| In-app purchases | No | Billing is handled outside the app; no StoreKit anywhere in the binary. |
| User-generated content shared with other users | No | Everything a user types is their own shop's private business record, visible only to their own org. There is no public feed, no profile, no user-to-user discovery, and therefore no moderation surface. |
| Age assurance / kids category | Not in Kids | The app is a business tool for adults. |

---

## App Privacy

Answers audited against both repositories and the full transitive dependency graph.

**Tracking: NO.** IDFA is not used and no data goes to a data broker. Verified by exhaustive
negative search of both repos plus the whole `pnpm-lock` transitive graph across every major
analytics, ad, attribution and crash SDK — zero real hits. Capacitor's `PrivacyInfo.xcprivacy`
declares `NSPrivacyTracking=false`; `NSUserTrackingUsageDescription` is absent; there are no
`SKAdNetworkItems`; `Package.resolved` pins a single SwiftPM dependency; `cordova_plugins.js` is
empty. Zero hits for `ATTrackingManager`, `advertisingIdentifier` and `identifierForVendor`.

### Data collected — answer YES to these

For every row below: **Purpose = App Functionality**, **Linked to the user's identity = Yes**,
**Used for tracking = No**.

| Category | Data type | What it actually is |
|---|---|---|
| Contact Info | Name | Staff names and the shop's customers' names. |
| Contact Info | Email Address | Staff sign-in addresses and customer email addresses. |
| Contact Info | Phone Number | Customer numbers, and the user's own `callbackNumber`. |
| Contact Info | Physical Address | Customer service addresses and the shop's own service origin. |
| Contact Info | Other | Per-customer custom fields, plus A2P business registration details. |
| User Content | Photos or Videos | Job photos taken on site or picked from the library. |
| User Content | Audio Data | **Transient only** — push-to-talk dictation via `SFSpeechRecognizer` behind WebKit, and live Twilio call audio. Neither is stored. |
| User Content | Other User Content | Job notes, signatures, room and site geometry, SMS message bodies. |
| Identifiers | User ID | The Supabase auth id, which is also the identity on the Twilio Voice token. |
| Financial Info | Other Financial Info | The shop's customers' invoice and payment amounts. |
| Diagnostics | Other Diagnostic Data | `pino` server logs stamped with `user_id`. Phone, email, password and token values are redacted before write. |

### Data NOT collected — answer NO to these

| Not collected | Evidence |
|---|---|
| Device ID | No IDFA or IDFV. Zero hits for `ATTrackingManager` / `advertisingIdentifier` / `identifierForVendor`. |
| Payment Info | Stripe **hosted** Checkout only. No Stripe.js and no Elements anywhere — card data never touches the app. |
| Precise Location | No `navigator.geolocation`, no CoreLocation, no `NSLocation*` key in the plist. |
| Coarse Location | Same. Stored lat/lng is geocoded **server-side** from a typed address — it is the customer's property, never the device's position. |
| Contacts | No Contacts framework, no contact picker. |
| Usage Data (all types) | No analytics SDK of any kind. |
| Crash Data | No crash reporter linked. |
| Performance Data | No performance SDK linked. |
| Purchase History | No StoreKit, no in-app purchases. |
| Search History | Search boxes filter the shop's own rows client-side; nothing is recorded. |
| Browsing History | The app is not a browser. |
| Health & Fitness | Nothing health-related. |
| Sensitive Info | None of Apple's sensitive categories are collected. |
| Customer Support | No in-app support ticketing. |

### Third parties

**Reached from the device:** Supabase (the database and auth) · Google Maps / Places (address
autocomplete sends the partial address as it is typed; the key is baked into the production build)
· Twilio Voice (microphone, and a token whose identity is the user's UUID) · Vercel (platform
request logs).

**Reached only from the server:** Anthropic (prompt text and job photos as base64) · Stripe
(hosted checkout) · Vapi (AI front desk, off by default) · Resend (transactional email) ·
QuickBooks Online (optional, per-shop connection) · the US Census geocoder.

None of these is a data broker and none receives data for advertising.

---

## URLs

| Field | Value |
|---|---|
| Support URL | `https://trymallet.com/support` |
| Privacy Policy URL | `https://trymallet.com/privacy` |
| Marketing URL | `https://trymallet.com` |

Both the support and privacy pages must resolve **before** you submit — a 404 on either is an
automatic rejection, and it is the cheapest one to avoid.

---

## Copyright

App Store Connect prepends the © symbol itself, so the field takes the year and the entity only:

```
2026 Mallet Technologies, Inc.
```

(Rendered on the product page as "© 2026 Mallet Technologies, Inc.")

---

## Version and export compliance

| Field | Value |
|---|---|
| Version | `1.0` |
| Build | `1` |
| Export compliance | Already declared — `ITSAppUsesNonExemptEncryption=false` is in `Info.plist`, so App Store Connect does not ask. |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) — upload iPhone screenshots only. |
| Minimum OS | iOS 17.0 |
| Team | Mallet Technologies, Inc — `6SMLK52FUJ` |

---

## App Review Information

### Sign-in required: **Yes**

| Field | Value |
|---|---|
| User name | `appreview@trymallet.com` |
| Password | `Ridgeline-Review-7Q4t!2846` |

The account is created through the Supabase Admin API with `email_confirm: true`, so it is
verified at creation and signs in on the first attempt. There is no confirmation link, no phone
number and no SMS code anywhere in the path — a reviewer cannot receive mail sent to Owen's
domain, so any of those would be an unpassable gate.

### Contact information

| Field | Value |
|---|---|
| First name | *(DECISION 3 — fill in)* |
| Last name | *(DECISION 3 — fill in)* |
| Phone number | *(DECISION 3 — fill in)* |
| Email address | *(DECISION 3 — fill in)* |

### Notes

Paste exactly this. **199 words.**

```
Demo account (verified — no email confirmation, no SMS code):
Email: appreview@trymallet.com
Password: Ridgeline-Review-7Q4t!2846

Mallet is job management for plumbing and trade contractors. This sample shop already has customers, scheduled work, quotes and invoices in it.

To reach the LiDAR room scanner:

1. Sign in. You land on the office screen.
2. Tap the circled + in the centre of the bottom bar, then tap New quote.
3. In the Customer field type Alicia, then tap Alicia Brennan.
4. In the Measure card at the top, tap Scan room.
5. Type any room name, then tap Start scanning.
6. Allow camera access, walk the phone around the room, tap Done.

Room scanning uses the device's LiDAR sensor through Apple's RoomPlan framework to build a dimensioned floor plan on device. RoomPlan has no web API, so this cannot be done in a browser. Contractors price wall and floor work from the measurements.

Requires an iPhone Pro or Pro Max — RoomPlan needs LiDAR, so Scan room is hidden on other models. The rest of the app works normally.

Charge a card reports that Stripe setup is incomplete: every shop connects its own Stripe account and this sample shop has none.
```

The composer route is first on purpose. It is the most robust path in the app: `/composer` sits in
the office route group whose layout mounts `SettingsHydrator`, and the Measure card needs nothing
but a selected customer — no job in a particular state, no assignment, no prior scan. It is also
**date-independent**, which the My day route is not: the demo shop's jobs are dated relative to the
seed run, so an agenda that was full on the day you submitted is empty by the time Apple opens it.

A second route to the same scanner, if the reviewer prefers it and the seed is fresh: tap **⋯**
(top right) → **My day** → the 8:30 job **Estimate — whole-house repipe** → the **Quote** tab →
**Scan a room**.

If you have not fixed the Google geocoding billing (see the defects section), add this sentence to
the end of the Notes:

> Measure from satellite opens a map but cannot look up an address on this build; the LiDAR
> scanner above is unaffected.

---

## Screenshots

Six, iPhone 6.9" Display, **1290 × 2796 portrait**, verified with `sips` and inspected by eye.
Captured against production (`https://app.trymallet.com`) signed in as the demo shop, so every
figure a reviewer sees in the store is a figure they can find in the account.

Reproduce with `node scripts/shot-app-store.mjs`.

| # | File | What it shows |
|---|---|---|
| 1 | `01-my-day.png` | **The day.** A tech's agenda — 8:30 repipe estimate and a 10:30 water heater, with the office note and the gate code on the card. |
| 2 | `02-job.png` | **The job in hand.** Customer, service address, one-tap Navigate, On my way, Mark done, and the note the office left. |
| 3 | `03-quote.png` | **The quote.** EST-1001 itemized to $10,954, including the measured line — 186 sq ft of wall access at $14 — and the follow-up trail. |
| 4 | `04-measure.png` | **Measure on site.** The field Quote tab with **Scan a room**, the entry point to the native LiDAR capture. |
| 5 | `05-money.png` | **Getting paid.** One job ready to bill at $370, one invoice unpaid at $304 and 12 days old. |
| 6 | `06-schedule.png` | **The board.** Crew against the hours for today, with the one job that still needs a slot above it. |

**One honesty note about shot 4.** The **Scan a room** row renders only when the `MalletRoomScan`
Capacitor plugin answers `available: true`, and that plugin exists only inside the iOS shell — in
any browser the row is correctly absent. `scripts/shot-app-store.mjs` installs the same plugin
shape the shell injects via `WKUserScript`, so the screenshot shows exactly what a LiDAR iPhone
shows. Nothing about the scan itself is faked: `captureRoom` is never called. On a non-LiDAR iPhone
that row is genuinely absent, which is why the review notes name the device requirement.

---

## Reviewer-tripping defects found while shooting

Reported in severity order. None of these blocks the upload; two of them would change what a
reviewer sees.

### 1. HIGH — "Measure from satellite" cannot find any address on production

Open a quote for any customer and tap **Measure from satellite**. The address is prefilled
correctly, the satellite tiles load, and then:

> Couldn't find "1544 NW Fort Clatsop St, Bend, OR 97703" on the map — pan and zoom to the site.

The map sits at continental zoom over the whole United States. The browser console says why:

```
Geocoding Service: You must enable Billing on the Google Cloud Project
```

The Maps JavaScript API and the Places Autocomplete API on the same key both work — I confirmed
Places returns "1544 Northwest Fort Clatsop Street, Bend, OR, USA" while typing. It is only the
**Geocoding API** that is unbilled or not enabled on that Cloud project. A reviewer exploring
beyond the scripted path lands on a headline measurement feature that visibly fails on the demo
shop's own customer. It degrades politely rather than crashing, so this is not a certain
rejection — but it is a bad look and the fix is a billing checkbox, not code. **Fix it before
submitting, or add the caveat sentence to the review Notes.**

### 2. MEDIUM — every office screen's breadcrumb reads "Customer"

`components/shell/topbar.tsx` hardcodes `section: "Customer"` for all fourteen office routes, so
the top-left of the app reads **Customer › Money**, **Customer › Jobs**, **Customer › Office**. The
sidebar, the mobile tab bar and the More menu all call that same group **Office**. It is in the top
bar of screenshots 3, 5 and 6 and on every office screen a reviewer opens. Field routes are correct
(`Field › My day`). A one-line fix, but the screenshots would need re-shooting after it deploys.

### 3. LOW — the Artie bar's placeholder is clipped mid-word

The assistant bar above the tab bar renders `Ask Artie — or just say what you want done…` with no
ellipsis and no overflow rule, so at 430pt it is sliced through "wan|t" at the right edge. Visible
in screenshots 1, 5 and 6 and on every scrolling screen.

### 4. Not a defect, but say it in the Notes — "Charge a card" errors on the demo shop

Tapping **Charge a card — $304** on INV-1002 returns, in red, under the invoice:

> this shop hasn't finished Stripe payment setup — complete onboarding in Settings → Payments to
> accept cards

That is the correct behaviour — each shop connects its own Stripe account and a demo shop has
none — and the message is honest and actionable. But it is the invoice's primary button, so a
reviewer will press it. The Notes text above pre-empts it in one sentence.

### 5. Risk, not a defect — the Front Desk toggle spends money

The reviewer signs in as the **owner**, so Settings is open to them. Switching the Front Desk on
provisions a real Twilio phone number and starts answering real calls. The seed keeps
`frontDesk: false` and the seeder asserts it, but nothing stops a reviewer flipping it. See
DECISION 2 — if the AI front desk stays out of the Description, a reviewer has no reason to go
looking for it.

---

## Risks, plainly worded

### Guideline 4.2 — "this is a website in a wrapper"

**The risk.** The shell is a `WKWebView` pointed at `server.url = https://app.trymallet.com`. Every
business screen — customers, jobs, quotes, invoices — is web content. That is the exact shape
Apple rejects under minimum functionality.

**The counter-argument, which is real.** The app performs LiDAR room measurement on device using
Apple's RoomPlan framework. `RoomScanPlugin.swift` is a `CAPPlugin` registered in
`MalletViewController.capacitorDidLoad()`; `RoomScanViewController.swift` presents a native
full-screen `RoomCaptureView` with our own coaching and Done/Cancel chrome; the resulting
`CapturedRoom` is processed entirely on device by our `MalletCapture` SwiftPM package into wall,
opening, floor and ceiling geometry, which is then priced in the estimate. RoomPlan has no web API
and requires the LiDAR sensor and ARKit, so none of it is possible in a browser. Captures are also
written to an on-device store first, so a scan survives losing the network or the app being killed
mid-flow. The full Resolution Center wording is already drafted in
`mallet-ios/docs/app-store-submission.md` §6 — use it verbatim if this comes back.

**What makes the argument land:** the review Notes put the scanner three taps from sign-in and name
the device requirement, so the reviewer sees the native capability instead of hunting for it.

### The demo-account dependency

The app opens straight into a login. Sign-up and password reset both leave the app via Mail and
Safari, so "just make an account" is not a path a reviewer can take. If the seeded account is
missing, expired or has a changed password, the review is a guaranteed 2.1 rejection. Mitigations
already in place: the account is created verified, the password is a constant in the seeder, and
re-seeding converges on the same credentials.

### The My-day route is date-sensitive

`scripts/app-review/shop-data.mjs` gives every job a `dayOffset` relative to *now*, and
`scripts/seed-app-review-org.mjs` resolves it in SQL at seed time (`orgTimestamp` / `orgDate`). The
shop is only "today" on the day it is seeded. Apple typically reviews one to three days after
submission, by which point My day is empty and the second walkthrough route dead-ends. Handled two
ways: the review Notes lead with the date-independent composer route, and the click-list above puts
a re-seed immediately before Submit, plus a re-seed every couple of days while the review is
pending.

**Optional, do not build yet — a scheduled daily re-seed.** A Vercel cron hitting a protected route
that runs the seeder once a day would make the demo shop permanently fresh and delete this whole
class of problem. Cost: roughly an hour to wire the route and the auth, and one more scheduled job
writing to the shared production database on a timer. Benefit: the strongest single failure mode in
this submission stops existing, and it keeps paying off at every future resubmission and sales demo.
Worth it if there will be more than one review cycle, which there will be.

### The standing risk: the shell has no gate on what the web app loads

The binary ships `server.url = https://app.trymallet.com` and nothing else. Every deploy of
`mallet-app` changes what is inside installed copies of the app **with no new App Store review**.
That is fine for features; it is dangerous for privacy. The moment somebody adds a script tag to
`app/layout.tsx` — an analytics snippet, a session recorder, a chat widget, an ad pixel — that code
starts running inside shipped apps, and every "No" in the App Privacy section above silently
becomes a lie. Apple's own rule is that the privacy answers must stay accurate, and the person who
added the tag will not know a submission exists.

**Recommendation:** add a CI check that fails the build when a new external script origin appears.
The cheapest honest version is an allowlist test over `app/layout.tsx` and any `next/script` usage
that asserts the set of third-party origins is exactly the set declared here, with the failure
message pointing at this file. It costs an afternoon and it is the only thing standing between a
routine PR and an inaccurate privacy declaration.

### `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is baked in at build time

Because it is a `NEXT_PUBLIC_*` variable it is compiled into the client bundle, so in production the
address field talks to Google **from the device**, sending keystroke-debounced partial addresses to
`places.googleapis.com/v1/places:autocomplete` as the user types. I confirmed this on production
against the demo shop. This is App Functionality, not tracking — Google is not receiving it for
advertising and no identifier rides along — but it is a device-to-third-party flow and **it belongs
in the privacy policy at `trymallet.com/privacy`**, named explicitly. It is already listed under
"Third parties" above.
