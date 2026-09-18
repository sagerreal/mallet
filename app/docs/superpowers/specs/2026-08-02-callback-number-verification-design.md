# Verifying a staffer's mobile — design

**Date:** 2026-08-02
**Status:** draft, awaiting Owen

## Why this exists

`users.callback_verified_at` is read in three places and **written in none**. Nothing in the
codebase has ever set it. That leaves two features permanently dark and one control that can only
refuse:

- **On-call transfer.** `modules/frontdesk/infra/drizzle-on-call-reader.ts:46` requires
  `callback_verified_at IS NOT NULL`. No staffer can ever be on call, so the AI front desk can
  never transfer an urgent caller to a human.
- **`setMemberTakesCalls`** (`modules/identity/api/identity-router.ts:525`) refuses with
  PRECONDITION_FAILED — "they need a verified callback number before they can take calls" — and
  there is no way to satisfy it. The control exists only to say no.
- **The SMS agent's tenancy resolution.**
  `modules/sms-agent/infra/drizzle-sms-agent-readers.ts:31` matches an inbound sender against
  verified numbers only.

## The thing to be careful about

The obvious shortcut — stamp `callback_verified_at` when someone types their mobile at signup — is
a **security regression**, not a shortcut.

Every shop's staff texts one shared Mallet number. When an inbound command arrives there is no
tenant yet: **the sender's verified number is what decides whose books get written to.** The code
says so plainly:

> "isNotNull(callbackVerifiedAt) is the security boundary, not a nicety. An unverified
> callback_number is self-asserted, and users_verified_callback_uidx only constrains VERIFIED rows
> — matching unverified ones would reintroduce exactly the ambiguity that index exists to remove,
> with a coin flip deciding whose books an inbound command writes to."

`users_verified_callback_uidx` is deliberately partial for the same reason: only verified numbers
are unique, so self-asserted duplicates stay legal and harmless. Stamping the column on an unproven
number would hand cross-tenant write authority to a typed claim.

So the column may only be set by proof of possession.

## Feasibility: outbound SMS works now

Checked against the live database rather than assumed — **the earlier "A2P blocked / 30034" note is
out of date.**

| Outcome | Count | Range |
|---|---|---|
| `delivered` | 9 | to a real mobile (`+1781…`), through 2026-07-31 |
| `failed`, error `30006` | 72 | 2026-07-31 → 2026-08-02 |

No `30034` (unregistered A2P) appears at all. Every one of the 72 failures went to a
`+1925555xxxx` address — the **seeded sample customers**. `555` numbers are non-routable, and
`30006` is "landline or unreachable carrier". The failures are entirely explained by texting
fictional data.

**Two conclusions.** An SMS code can be delivered, so this design is viable. And `30006` is exactly
what a real shop will hit when the owner types their **desk landline** — so "this number cannot
receive texts" is a first-class outcome, not an edge case. The live data proves that path is
common.

## Design

### Storage

No new table. Add to `users`:

- `callback_challenge_hash text` — the code, hashed. Never stored in clear.
- `callback_challenge_number text` — the E.164 the code was sent to. The stamp is only valid for
  **this** number; changing the number invalidates the challenge.
- `callback_challenge_expires_at timestamptz`
- `callback_challenge_attempts integer not null default 0`

Storing the target number alongside the hash closes the swap: request a code to a number you own,
then change `callback_number` to someone else's before entering it.

### Two endpoints, in the calls module

`sendCallbackCode` (`anyRole`, self only — the user id comes from `ctx.principal`, never input):
1. `Phone.parse` the number; refuse an unparseable one by name.
2. Refuse if the number is already verified **on another user** — the partial unique index would
   raise a bare constraint violation otherwise, which reaches the UI as "check your connection".
3. Generate a 6-digit code, store its hash, the target number, and a 10-minute expiry.
4. Send it. **Interactive send, so a degraded channel must surface** — per the notification
   module's rule, this path uses `assertDelivered` and returns PRECONDITION_FAILED rather than
   pretending.
5. Rate limit: 3 sends per user per hour, 10 per org per hour. This endpoint spends money and can
   be used to text strangers.

`confirmCallbackCode` (`anyRole`, self only):
1. Refuse when expired, when attempts ≥ 5, or when `callback_challenge_number` no longer matches
   the user's current `callback_number`.
2. Compare hashes in constant time. On failure increment attempts and refuse.
3. On success set `callback_verified_at = now()`, clear all four challenge columns.

### Handling a landline

When the send fails with `30006`, the response says so in the user's terms — *"That number can't
receive texts. It looks like a landline — use a mobile, or skip for now."* — and offers **skip**.

Skipping is not a failure state. An unverified number still powers click-to-call (
`drizzle-call-directory.ts:55` reads `callbackNumber` with no verification check). Only on-call
transfer and the SMS agent need the stamp. The UI must say which capability is waiting, rather
than blocking signup on a text message.

### Where it appears

- **`/welcome`** — after the mobile field, inline and in-flow (no modal, no popover): "We texted
  you a code" + a 6-digit input + "Skip for now".
- **Settings → the callback number card** — the same pair of controls, so a skipped verification
  can be finished later and a changed number can be re-verified.
- **The team list** — show verified / not verified per member, since `setMemberTakesCalls` refuses
  on unverified and the owner currently gets a refusal with no explanation of what to do about it.

## What this unblocks

Emergency transfer from the AI front desk to a human — currently impossible for every org — and
the SMS agent's ability to recognise a staffer texting in.

## Risks

- **It sends SMS on demand.** Rate limits are part of the feature, not a follow-up.
- **A wrong number gets a stranger a code.** Harmless in itself (the code proves nothing without
  the session), but it costs money and annoys people; the rate limit is the control.
- **`30006` on a landline is the common path**, not the exception. Skip must be a real, unpunished
  option or shops will stall at signup.
- **Existing users all have `NULL`.** Nothing changes for them until they verify; no current
  behaviour regresses, because nothing currently works.

## Out of scope

Voice-call fallback for landlines (Twilio Verify supports it; adds a second channel and a second
failure mode). Re-verification on a schedule. Verifying a number the shop does not control, e.g.
an answering service.

## Open question for Owen

**Twilio Verify vs. our own code over the existing messaging path.** Verify handles generation,
hashing, expiry, attempt limits and delivery — and uses Twilio's own messaging route, which may
sidestep A2P entirely. Rolling our own reuses a channel that is now proven to deliver and keeps the
data in our database, at the cost of writing the security-sensitive parts ourselves.

Recommendation: **roll our own**, because outbound delivery is now demonstrated, it adds no vendor
surface, and the four columns above are less work than a new Twilio subaccount concept. Worth
30 minutes of checking Verify's pricing before committing.
