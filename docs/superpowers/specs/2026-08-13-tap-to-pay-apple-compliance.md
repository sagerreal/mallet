# Tap to Pay — Apple's actual requirements, and what Mallet owes

2026-08-13 · read against **Apple's own files**, not a third party's restatement:
`Getting Started App Requirements and Review 1_6.pdf` (24pp, v1.6, Nov 2025 / Mar 2026 cover) and
`App Review Requirements Checklist 1_6.numbers`.

**Entitlement status:** GRANTED with the **development distribution restriction** (Case-ID
21574646) — buildable and demoable on registered test devices only. Lifting that restriction to
ship publicly needs the three videos + the completed checklist. So this document is the gate
between "works on Owen's phone" and "in the App Store".

> **A correction worth recording.** An earlier pass in this session quoted requirement numbers
> from NMI's developer docs — a PSP restating Apple's rules for its own integrators. The substance
> mostly held; the numbering did not (there is no 2.1; the progress indicator is 3.9 not 3.9.1;
> education-after-T&Cs is 4.2 not 4.1). Everything below is transcribed from Apple's files.

## The one that is not a UI fix

**2.2 — "Creating an account and accessing Tap to Pay on iPhone requires a fully digital
onboarding experience within the app. This experience must be fully completed on an iPhone."**

Mallet's entitlement request told Apple merchants "subscribe on our website (trymallet.com)" and
onboard through **Stripe Connect Express hosted onboarding** — which opens Stripe's own page in a
browser/`SFSafariViewController`. That is not "within the app", and 2.3 caps the whole thing at 15
minutes (the request already says 10–15, i.e. at the ceiling).

**The fix exists and is Stripe's:** the **Connect embedded `account-onboarding` component**
(`stripe-ios` → `StripeConnect`), which renders onboarding *inside* the app with no browser hop.
Requires `NSCameraUsageDescription` in the shell's Info.plist (identity-document capture).

→ **DECISION FOR OWEN, and the only one that changes architecture.** Everything else here is a
screen. See the decision block at the end.

## What Apple actually requires

Transcribed from the checklist. `R` = Required, `C` = Conditional, `Rec` = Recommended.

### 1.x — device & lifecycle

| # | | Requirement | Mallet |
|---|---|---|---|
| 1.1 | R | Support iPhone XS and later | probe already answers this |
| 1.2 | C | iOS Deployment Target = PSP minimum, if TTP is the primary payment method | not primary — Checkout stays |
| 1.3 | C | A12 minimum + `UIRequiredDeviceCapabilities` | as above |
| 1.4 | R | Handle `PaymentCardReaderError.osVersionNotSupported` with an update-iOS message | **owed** (plugin) |
| 1.5 | R | **Warm up the reader at launch and on foreground** | **owed** — 5.6's 1-second budget is unreachable without it |
| 1.6 | R | Read T&C acceptance **from Apple**, never a local variable | **owed** — do not cache in `org_settings` |
| 1.7 | Rec | Face ID / Touch ID login | out of scope |
| 1.8 | C | Follow the HIG | — |
| 1.9 | C | Follow the TTP Developer Marketing Guidelines | affects the site, not the app |

### 2.x — onboarding

| # | | Requirement | Mallet |
|---|---|---|---|
| 2.2 | R | Fully digital onboarding **within the app**, completed on iPhone | **FAILS today** — see above |
| 2.3 | R | Under 15 minutes for most users | at the ceiling |

### 3.x — enabling

| # | | Requirement | Mallet |
|---|---|---|---|
| 3.1 | R | Highly visible, discoverable TTP communication | **owed** |
| 3.2 | Rec | Full-screen modal / splash (also satisfies marketing 6.2) | **owed** |
| 3.3 | R | Communicate to **all eligible users at least once** (push is fine; also marketing 6.3) | **owed** — the Existing User Flow video |
| 3.4 | R | Show how to enable TTP **at the end of every new merchant onboarding** | **owed** — the New User Flow video |
| 3.5 | R | A clear action to accept the TTP Terms & Conditions | **owed** |
| 3.6 | R | Enable TTP **outside** comms and checkout — e.g. app settings | **owed** |
| 3.7 | R | Either a trigger to enable inside checkout, or require it enabled first | satisfied by 5.3's behaviour |
| 3.8 | R | **T&Cs accepted only by an admin or authorized party** | **owed** — owner/office only, never a tech |
| 3.8.1 | R | Unauthorized user sees "contact an admin to enable it" | **owed** |
| 3.9 | R | Config progress indicator via `PaymentCardReader.Event.updateProgress(_:)` (or PSP equivalent) | **owed** (plugin) |

### 4.x — education

| # | | Requirement | Mallet |
|---|---|---|---|
| 4.1 | R | **Use `ProximityReaderDiscovery` on iOS 18+ — "this fulfils requirements 4.4, 4.6…"** | **owed, and the shortcut** |
| 4.2 | R | Education screens **after** the user accepts T&Cs | **owed** |
| 4.3 | R | Education findable later, in Settings or Help | **owed** |
| 4.4 | C | Education outside the app uses the approved Toolkit | marketing |
| 4.5 | R | Show how to accept **contactless cards** | 4.1 covers |
| 4.6 | R | Show how to accept **Apple Pay / digital wallets** | 4.1 covers |
| 4.7 | C-region | PIN entry + its accessibility options | **not US** — skip |
| 4.8 | C-region | Fallback payment method | **not US** (CA/GL/IE/IM/JE/UK) — skip |
| — | R | **"a dedicated screen inviting them to try it out"** after the tutorial | **owed** — only in the checklist, not the PDF body |

### 5.x — checkout

| # | | Requirement | Mallet |
|---|---|---|---|
| 5.1 | R | Clearly visible, prominent button to start a TTP transaction | button exists — but disabled |
| 5.2 | R | Reachable **without scrolling**; **top of the list** when there are multiple options | **owed** — it sits beside Card/Cash/Check |
| 5.3 | C | **Never altered, greyed out or obscured** — and if not yet enabled, **pressing it opens the T&Cs** | **PR1 VIOLATES THIS**, see below |
| 5.4 | C | Region-appropriate button copy (Localization strings) | US: "Tap to Pay on iPhone" |
| 5.5 | C | Icon must be SF Symbol `wave.3.right.circle` or `.fill` | **owed** |
| 5.6 | R | TTP UI within **1 second, ≥90% of the time** | depends on 1.5 |
| 5.7 | R | "Initializing" screen if still configuring | **owed** |
| 5.8 | R | "Processing" screen after a successful read | plugin/SDK |
| 5.9 | R | Clearly report approved / declined / timed out | **owed** |
| 5.10 | R | Digital receipt on **approve or decline** — SMS, email, QR or Activity view | **likely already passes** (SMS + email receipts exist) |
| 5.11 | C-region | Regional compliance | US only for now |

## Requirement 5.3 inverts PR1's central design decision

PR1 ships the Tap to Pay button **visible but `disabled`, with a reason** — the room-scan honesty
pattern. That was the right instinct for shipping before an entitlement existed. It is also
exactly what 5.3 forbids, and the requirement goes further than "don't grey it out":

> *"If the user hasn't yet enabled it, pressing the button will automatically open the acceptance
> of Tap to Pay on iPhone Terms and Conditions."*

So the correct behaviour is the **opposite** of disabled-with-reason: the button is always live,
and an un-enabled shop tapping it lands in the T&C flow. That is a better product than PR1's
scaffold, and it also discharges 3.7 for free.

**`tap-to-pay-unavailable.tsx` does not die.** 5.3 is *Conditional* — conditional on whether the
user can accept T&Cs on their iPhone with an Apple account. A genuinely unsupported device
(iPhone X, browser, non-admin user) still needs a sentence, and that component is the one place
that owns those sentences.

## Plan

**Phase A — compliance surfaces (web, no plugin needed).** Buildable and testable today:
3.5/3.8/3.8.1 T&C acceptance gated to owner/office · 3.6 enable from Settings · 4.2/4.3 education
+ where to find it later · Try It Out · 3.1/3.2/3.3 the awareness modal · 5.2 button to the top of
the pay block · 5.5 the SF Symbol · 5.3 button always live → opens T&Cs when not enabled.

**Phase B — the plugin (PR2).** `MalletTapToPay` per the existing spec, plus what the real
requirements add: 1.5 warm-up on launch/foreground · 1.4 the osVersionNotSupported message · 3.9
`updateProgress` · 4.1 `ProximityReaderDiscovery` · 5.7 initializing · 5.9 outcome.

**Phase C — 2.2 embedded onboarding.** Only if Owen says so; see the decision.

**Phase D — the submission.** Three videos + checklist. Note from the checklist: *"Use another
device to record the Checkout flow video as the Tap to Pay on iPhone UI screens won't work for
screen recordings."*

## DECISION — Owen

**2.2 is the only architectural question. Three options:**

1. **Swap hosted Connect onboarding for Stripe's embedded `account-onboarding` component.**
   Compliant, keeps merchants in-app, needs `NSCameraUsageDescription` and reworks a flow that
   currently works. Real work, and it touches money onboarding.
2. **Ship with hosted onboarding and argue it.** Stripe hosted onboarding is *digital* and
   *completable on an iPhone*; the browser hop is the exposure. Cheapest, and risks a rejection
   after the videos are filmed.
3. **Embedded for iOS only, hosted on the web.** Two paths to maintain, which is how they drift.

**Recommend 1**, but not first — Phase A is required regardless of how 2.2 lands, and none of it
is wasted work under any option.

**Also for Owen:** 1.6 says read T&C acceptance **from Apple**, never a local variable. So Mallet
must not persist "this shop accepted" in `org_settings` and trust it — the SDK is the source of
truth on every launch.
