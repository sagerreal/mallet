# Google Play listing — Mallet

Copy-paste source for every text field and form in Play Console. Derived from the
production app (app.trymallet.com) and the shell's **merged release manifest** on
2026-08-12 — re-verify the data-safety rows if the web app gains new permissions or
analytics. Store graphics live in [`shell/store-assets/`](../shell/store-assets/).

## App details

| Field | Value |
|---|---|
| App name | Mallet |
| Category | Business |
| Contact email | owenduggan@trymallet.com |
| Privacy policy URL | `https://trymallet.com/privacy` (live — resolves to www.trymallet.com/privacy, HTTP 200) |
| Ads | No — contains no ads |
| Target audience | 18+ (business tool) |
| App access | Sign-in required — Play review needs a demo account. Provide credentials for a **demo/test org**, never a real shop's login. |

## Short description (76/80 chars)

```
Field service for small trade shops: scheduling, quotes, invoices, payments.
```

## Full description (≤4000 chars)

```
Mallet runs the day-to-day of a small trade business — plumbing, electrical, garage door, and other field service shops — from one place.

SCHEDULING
• See the day's work on one board: who's going where, and when.
• Book visits, assign techs, and reschedule without paper or spreadsheets.
• Every tech gets a My Day view on their phone: today's visits, addresses, and job details.

QUOTES AT THE DOOR
• Build an itemized quote on-site from your own price book.
• Offer good-better-best options when it helps the sale.
• Get approval on the spot and turn the quote into booked work — no re-typing.

INVOICES AND PAYMENTS
• Turn finished work into an invoice in a couple of taps.
• Send the customer a link they can open and pay by card; payments are processed by Stripe.
• Take card payment at the door before the truck leaves.
• See what's outstanding and what's been paid.

CUSTOMERS AND JOBS
• One record per customer: quotes, jobs, invoices, notes, and photos together.
• Attach job photos from the field.
• A simple day clock for payroll hours.

BUILT FOR THE FIELD
• Made for a phone in a truck: portrait-first, fast screens, big touch targets.
• The same account works in the office on a desktop browser.

Mallet is the mobile app for Mallet accounts. Sign in with your existing account — new shops can request access at trymallet.com.
```

(~1,230 chars — well under the 4,000 limit.)

## Data safety form (Play Console → App content → Data safety)

The app is a native shell around `https://app.trymallet.com` (HTTPS only). Answers
below were derived on 2026-08-12 from: the merged release manifest
(`INTERNET` + `VIBRATE` are the only user-facing permissions — **no location, no
camera, no contacts**), the web app's source (no analytics/ads SDKs of any kind:
no PostHog, GA, Mixpanel, Amplitude, or ad libraries), and the privacy policy at
trymallet.com/privacy.

**Overview answers**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (collects; does not share) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — all traffic is HTTPS to app.trymallet.com |
| Do you provide a way for users to request that their data is deleted? | **Yes — by request**: email joe@trymallet.com (the contact named in the privacy policy). There is **no in-app account-deletion flow** (verified against the web app source 2026-08-12), so do NOT claim one; use the "request deletion" option and link the privacy policy's §7 rights section. |

**Data types collected** (all: collected — not shared, required for the service,
purpose = app functionality / account management)

| Play data type | What it actually is |
|---|---|
| Personal info → Name | Account holder and staff names |
| Personal info → Email address | Sign-in identity |
| Personal info → Phone number | Staff mobile numbers (used to route business-line calls to the tech's phone) |
| Personal info → Other info | The business records users enter: their customers' names, addresses, and phone numbers on jobs, quotes, and invoices |
| Financial info → Purchase history / Other financial info | Quotes, invoices, and payment records for the user's business. Card numbers are entered into Stripe's hosted payment fields and go to Stripe directly — Mallet servers never store card numbers |
| Photos and videos → Photos | Job photos — user-initiated uploads only (the shell requests no camera permission; photos go through the system picker) |

**Data types NOT collected** — say No to everything else, specifically:

| Play data type | Why it's a clean No |
|---|---|
| Location (approximate or precise) | No location permission exists in the merged manifest; the web app never requests browser geolocation |
| App activity / App info and performance / Device or other IDs | No analytics or crash-reporting SDK in the app or the shell. Ordinary web-server request logs (IP, browser type) exist on the backend, which Play's form does not require declaring as device-ID collection |
| Contacts, calendar, messages, audio, health, browsing history | Never touched |

**Sharing:** No. Data goes only to processors operating the service on Mallet's
behalf (Vercel hosting, database/auth, Stripe, Twilio, email) — under Play's
definitions, transfers to service providers are not "sharing".

**Ads:** none, and no ad SDKs.

## Content rating questionnaire

Business/productivity app: no user-generated public content, no violence, no
sexual content, no gambling, no drugs. Expect an **Everyone** rating.

## Store graphics inventory (`shell/store-assets/`)

| File | Size | What |
|---|---|---|
| `icon-512.png` | 512×512 | Play app icon — white sparkle on ink `#15110B`, exported from `shell/assets/icon-only.png` |
| `feature-graphic-1024x500.png` | 1024×500 | Ink `#15110B` background, white sparkle + "Mallet" wordmark (Space Grotesk 700, the app's display font). No tagline |
| `screenshots/01-my-day.png` | 1080×1920 | Field My Day — on the clock, today's visits with statuses |
| `screenshots/02-schedule.png` | 1080×1920 | Schedule — to-schedule queue + crew × hour dispatch board |
| `screenshots/03-invoice.png` | 1080×1920 | Invoice sheet — line item, total, due now, Send invoice |
| `screenshots/04-jobs.png` | 1080×1920 | Jobs list — statuses and amounts |
| `screenshots/05-money.png` | 1080×1920 | Money — billing queue with ready-to-bill work |
| `screenshots/06-office-today.png` | 1080×1920 | Office Today — approval queue headline + new requests |

All screenshots are the production app (app.trymallet.com) in the E2E demo org, plain
frames, no device mockups. Some records carry seeded test names ("Onejob …",
"Signedrec …") — reshoot from a prettier demo-seeded org before a public launch if
that bothers you; internal testing doesn't care.
