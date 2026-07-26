# Moving the app to app.trymallet.com

Decision, Owen, 26 Jul 2026: production moves off the Vercel URL to **`app.trymallet.com`**. The
marketing site keeps `trymallet.com`.

Nothing in the app hardcodes a URL — every caller reads `PUBLIC_APP_URL` through
`resolvePublicAppOrigin` (`shared/config/index.ts`), which falls back to Vercel's own production URL
when it is unset. So the code needs no change at all.

**What breaks is everything OUTSIDE the app that was told the old address.** Six systems, each of
which fails SILENTLY — no error, just a thing that quietly stops working. That is the whole reason
this runbook exists.

## Order matters

Do these in order. Steps 1–3 are safe while the old URL keeps serving; step 4 is the switch.

### 1. Add the domain and set the env var

```
VERCEL_TOKEN=xxx node add-app-domain.mjs           # shows what it would do
VERCEL_TOKEN=xxx node add-app-domain.mjs --apply
```

### 2. Add the DNS record at Namecheap

`trymallet.com` uses Namecheap DNS (`dns1.registrar-servers.com`), not Vercel DNS — so this cannot
be automated from the Vercel side.

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` | Automatic |

Wait for Vercel to show the domain as Valid. Usually minutes.

### 3. Redeploy

`PUBLIC_APP_URL` only applies to NEW builds. Until a redeploy, the running deployment still emits
the old origin in every link it generates.

### 4. The six external systems

Each was told the old address by hand. Miss one and it fails with no error.

- [ ] **QuickBooks redirect URI** — Intuit dashboard → app → Keys & credentials → Redirect URIs.
      Add `https://app.trymallet.com/api/qbo/callback`. KEEP the old one until the cutover is
      proven, then remove. A mismatch is refused by Intuit *before* the request reaches Mallet, so
      the app cannot report it.
- [ ] **Twilio message-status callback** — Messaging → your Service → Integration → Callback URL →
      `https://app.trymallet.com/api/webhooks/twilio/message-status`. Without it, delivery status
      stops updating and every text reads "sent" forever again.
- [ ] **Twilio voice webhooks** — Phone Numbers → the business line → the Voice and Messaging
      webhook URLs.
- [ ] **Supabase auth redirect allowlist** — Authentication → URL Configuration → Site URL and
      Redirect URLs. Miss this and signup/reset emails send links that refuse to open, which looks
      exactly like email delivery being broken. (It has been mistaken for that before — see
      `auth-email-delivery` in memory.)
- [ ] **Stripe Connect return URLs** — onboarding return/refresh URLs.
- [ ] **Inbound web-form endpoints** — any embed a shop has already been given points at the old
      origin.

### 5. Keep the old URL alive

Do NOT remove `mallet-app-snowy.vercel.app`. It costs nothing, and it is the fallback if any of the
six above turns out to have been missed. Retire it only once a full flow has been exercised on the
new domain: sign in, send a text, connect QuickBooks, place a call.

## Verify

```
curl -sI https://app.trymallet.com | head -1          # 200
```

Then in the app: sign in, open a customer, send a text, and check Settings → QuickBooks still reads
Connected. Those four touch four of the six systems above.
