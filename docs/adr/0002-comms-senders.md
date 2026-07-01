# ADR 0002: Real comms senders (email + SMS)

- **Status:** Accepted
- **Date:** 2026-07-01
- **Context:** The Notifications slice shipped with a `LoggingNotificationSender` stub behind the `NotificationSender` port. With a Resend API key (and later Twilio credentials) in hand, we bind that port to real providers so invoices/estimates/reminders actually reach customers — without changing any use-case.

## Decision

### 1. One port, per-channel adapters, a channel router

`NotificationSender.send(cmd)` stays the single port. Two real adapters implement it:

- **`ResendEmailSender`** (`channel: "email"`) — the only file importing the Resend SDK.
- **`TwilioSmsSender`** (`channel: "sms"`) — the only file importing the Twilio SDK.

A **`ChannelRouterNotificationSender`** composes them: it dispatches by `cmd.channel` to the configured adapter, and any channel with no configured provider falls through to an injected fallback (the logging stub). The DI root builds the router from config — email is wired only when `RESEND_API_KEY` + `EMAIL_FROM` are set; SMS only when all three `TWILIO_*` vars are set. This is **per-channel graceful degradation**: email can be live while SMS is still stubbed (exactly the pilot state — Twilio is a trial with no verified number yet).

`AppDeps.notificationSender` is optional; the router falls back to the logging stub when a caller (e.g. a test) omits it, so unconfigured comms never error.

### 2. Idempotency & retry policy differs by channel

- **Email (Resend):** the caller (`SendNotificationUseCase`) already claims an idempotency key at the ledger before calling `send`. On top of that, we pass Resend's own **`idempotencyKey`**, so a transient-error retry returns the same email rather than sending a second one. Resend reports API-level failures in the `error` field (not thrown) — those are deterministic, so they neither retry nor count toward the breaker; only a thrown network error retries. `idempotent: true, retries: 2`.
- **SMS (Twilio):** `messages.create` has **no per-message idempotency key**, so a retry could send a second text. We therefore set **`idempotent: false`** (no retries). A single attempt is correct because the caller already deduped at the ledger; a failure surfaces as `status = failed` (the slice's graceful-degradation rule), not a rollback.

Both adapters go through the platform resilience `call()` (timeout + per-service circuit breaker).

### 3. No provider detail leaks; no PII in logs

On failure each adapter logs the raw provider error **server-side** (with `kind`, never the recipient or body) and returns a generic `ExternalServiceError` ("temporarily unavailable" / "rejected the message"). This mirrors the Stripe gateway decision (ADR 0001): provider internals and PII stay out of both client responses and logs.

### 4. Testability seam for email

`ResendEmailSender` accepts an optional injected `EmailTransport`, defaulting to the real Resend client. Unit tests inject a fake transport to cover the success / API-error / thrown-error mappings **without sending real email**. A live send is a separate **opt-in** integration test gated on `RESEND_LIVE_TEST` (not just `RESEND_API_KEY`, which now lives in `.env.local` and would otherwise email on every `pnpm test:int`). Verified once against live Resend (to the `delivered@resend.dev` sandbox sink).

## Review hardening (2026-07-01)

The slice's adversarial review confirmed six findings; all fixed with tests:

- **PII in logs (HIGH/MED):** both adapters logged the provider's raw `error.message`, which for Twilio embeds the recipient number (e.g. code 21211 "The 'To' number +1… is not valid") and for Resend can echo the recipient email. Now they log only the stable numeric/enum discriminators (`code`, `status`/`statusCode`, error `name`) — never the free-text message. (Key-based pino redaction can't scrub PII embedded in a string value, so the message is dropped at the source.)
- **Breaker mis-classification (HIGH + MED), mirror-image bugs:**
  - *Twilio over-trips* — it throws on every error, so deterministic per-recipient 4xx (invalid / unverified-trial / opted-out numbers) counted toward the breaker; five bad numbers opened it and disabled SMS for *valid* recipients (acute on a trial account, where every unverified number throws). Fix: a 4xx is returned as a resolved rejection (breaker sees success), only 5xx/timeout/network re-throws to trip it.
  - *Resend never trips* — it *returns* failures in `error` (never throws), so the breaker saw success on every outage and retries never fired (the policy was inert). Fix: a transient failure (`statusCode` null / ≥500 / 429) is thrown so the breaker counts it and the idempotent retry fires; a deterministic 4xx is returned without tripping or retrying.
- **SMS orphaned-request timeout (MED):** the Twilio client ignored the resilience `AbortSignal`, so a slow-but-successful send could be marked failed while Twilio still delivered it (and a future re-drive would double-send). Fix: set the Twilio client's own `timeout: 10_000` so a timed-out request is actually aborted. **Deferred:** a durable per-message dedupe token (SMS has no idempotency key) must land *before* the Phase-2 retry worker re-drives failed SMS rows, or it will double-send on any timed-out row.
- **Silent unconfigured channel (MED):** an unconfigured channel logged a stub send but recorded `status="sent"`, indistinguishable from a real delivery. Fix: the stub returns a distinguishable sentinel `externalId` (`stub:logged`) recorded on the row, and DI emits a boot-time `logger.warn` for each channel that fell back — so a partial-config deploy is visible in ops.

## Consequences

- Comms remain **optional**: the app boots and logs sends without any provider configured.
- The Stripe SDK, Resend SDK, and Twilio SDK are each confined to one adapter file; use-cases depend only on the port.
- **Operational / deferred:** a **verified sending domain** + a real `EMAIL_FROM` are needed before email reaches arbitrary customers (unverified Resend can only send from `onboarding@resend.dev` to the account owner). Real SMS needs Twilio out of trial: a purchased number + **toll-free verification** (faster than 10DLC) or a 10DLC campaign, plus `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`. Both keys were pasted in chat and must be **rotated before launch**.
- **Still on the durability roadmap:** post-commit delivery via a transactional outbox + a scheduler (so a send failure/crash can't lose a queued message and reminders fire on time). This slice makes the *senders* real; the outbox makes *delivery* durable and is the next slice.
