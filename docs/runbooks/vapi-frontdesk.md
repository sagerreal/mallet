# Runbook — AI Voice Front Desk (Vapi)

How to connect the org's Twilio number to the Mallet voice agent and test it. The code
(webhook, assistant builder, tools, call logging) ships in PR A; these are the one-time
manual setup steps Owen performs. ~15 minutes.

## What's built (PR A)

- `POST /api/frontdesk/vapi` — the Vapi server webhook. On each inbound call Vapi asks this
  endpoint for the assistant config, which is built live from the org's booking playbook in
  Settings. The agent books nothing yet in PR A — it answers, follows the playbook, takes
  messages, and every call is logged (transcript + recording + disposition). Booking arrives
  in PR B.
- The agent **never generates a price** — it can only speak the service fee and flat-lane
  prices you configured in Settings → the booking playbook.
- Compliance greeting is automatic: "Thanks for calling {brand}. You're speaking with
  {brand}'s AI assistant — this call is recorded. How can I help?"

## One-time setup

### 1. Set the webhook secret (Vercel)

The webhook rejects any request without a matching secret, and stays dark (503) until the
secret is set — so set it first.

- Generate a random string (32+ chars): `openssl rand -hex 24`
- Vercel → the mallet-app project → Settings → Environment Variables → add
  `VAPI_WEBHOOK_SECRET` = that value, scope **Production** (tick Preview too if you want to
  test against a preview deploy).
- **Redeploy** — env vars only take effect on a new deployment.

### 2. Create a Vapi account

- Sign up at https://vapi.ai (the free/pay-as-you-go tier is fine for the pilot).

### 3. Import the Twilio number into Vapi

- Vapi dashboard → **Phone Numbers → Import** → choose Twilio.
- Enter the number `+16693413343`, your Twilio **Account SID** and **Auth Token** (Twilio
  console → Account → API keys & tokens), then Import.
- This moves the number's **voice** routing to Vapi. It should NOT touch SMS.

### 4. Point the number's server URL at Mallet

- On the imported number in Vapi, set the **Server URL** to:
  `https://mallet-app-snowy.vercel.app/api/frontdesk/vapi`
- Set the server **secret header**: header name `x-vapi-secret`, value = the same string you
  put in `VAPI_WEBHOOK_SECRET`. (Vapi credential/secret settings — configurable at the
  phone-number level.)
- Leave the number with NO fixed assistant assigned — Mallet returns a per-call assistant via
  the `assistant-request` webhook (this is how the playbook grounds each call).

### 5. Verify SMS is untouched

- In the **Twilio** console, confirm the number's Messaging webhook still points at
  `https://mallet-app-snowy.vercel.app/api/webhooks/twilio`. (Importing to Vapi changes voice
  routing; if SMS also moved, repoint it here — inbound texts must keep flowing to Mallet.)

### 6. Configure the playbook (Settings)

- In Mallet → Settings, make sure the org's **booking playbook** has services with lanes and
  triggers, a service fee, hours, and service area filled in — the assistant is only as good
  as this config. Confirm the **AI Front Desk** toggle is on (`frontDesk`).

## Test it

Call **+16693413343**. Expected:

1. The agent answers with the compliance greeting naming your brand.
2. Ask "how much to fix a leaky faucet?" → it should NOT quote a repair price; it states the
   service fee (with the credited framing if you set that) and offers to book.
3. Say you want a message left for the office → it takes your name + details.
4. Hang up.

Then check the call landed:

- In the DB (or, after PR C, on the customer timeline): a `frontdesk_calls` row for the call
  with the transcript, recording URL, and a disposition. A left message also creates a lead +
  an office task.

### Quick DB check (until PR C ships the UI)

```sql
select from_number, disposition, left(transcript, 120) as transcript, recording_url, price_audit
from frontdesk_calls
order by created_at desc
limit 5;
```

`price_audit` should be null/empty — if it lists a flagged amount, the agent spoke a dollar
figure that isn't a configured price (that also files a "Review AI call" task). Report it; it
means the playbook has a stray price in a free-text field (triggers / "we don't do" / a job
title) or a prompt-rule gap.

## Troubleshooting

- **No answer / straight to Twilio voicemail:** the number's voice server URL isn't set to the
  Vapi assistant, or the import didn't complete. Re-check step 3–4.
- **Vapi shows a 401 from the server:** the `x-vapi-secret` header value doesn't match
  `VAPI_WEBHOOK_SECRET`, or the env var wasn't redeployed. Re-check step 1 + 4.
- **Vapi shows a 503:** `VAPI_WEBHOOK_SECRET` isn't set in the deployed environment (feature is
  dark by design). Set it + redeploy.
- **Agent answers but is generic / no services:** the org's booking playbook is empty, or the
  To-number doesn't match `orgs.twilio_number` for the org. Confirm the number and the
  playbook.
- **A call didn't log:** check the Vercel function logs for `/api/frontdesk/vapi` — every
  branch logs with the `vapiCallId` and `orgId`.

## Ops loop (hardening — PR D)

Weekly for the first ~3 months: listen to ~5 recorded calls, and tighten ONE prompt rule per
week (prompt rules live in `modules/frontdesk/app/prompt.ts`, versioned in code — never edit
prompt behavior in the Vapi dashboard). The 20-call test matrix (one per caller-intent case)
lands with PR D.
