#!/usr/bin/env bash
# One-shot: link the Vercel project + push all PRODUCTION env vars from .env.local.
# Prereq: authenticated Vercel CLI — either run `npx vercel login` first, OR
#   export VERCEL_TOKEN=<token>  (create at vercel.com/account/tokens) before running this.
# Usage:  bash scripts/vercel-prod-setup.sh
#
# Deliberately does NOT set (handle separately):
#   - STRIPE_WEBHOOK_SECRET  → your .env.local has the localdummy; prod needs the real whsec_
#                              created at the Stripe dashboard step. Set it after the endpoint exists.
#   - PUBLIC_APP_URL         → forced to https://trymallet.com below (NOT the localhost in .env.local)
#   - APP_DB_PASSWORD / NODE_ENV → not runtime prod vars (Vercel sets NODE_ENV itself)
#   - EMAIL_FROM / TWILIO_*  → absent / trial; email stays stubbed until you add them
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "ERROR: .env.local not found in $(pwd)"; exit 1; }

VC="npx --yes vercel@latest"
PROJECT="mallet-app"

# The vars pushed verbatim from .env.local (present ones only).
INCLUDE=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  DATABASE_URL
  APP_DATABASE_URL
  ANTHROPIC_API_KEY
  STRIPE_SECRET_KEY
  RESEND_API_KEY
  CRON_SECRET
)

# Read a var's value from .env.local (strip an optional surrounding single/double quote).
readval() {
  grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']$//"
}

# Idempotent set: remove any existing prod value, then add from stdin.
setvar() {
  local name="$1" val="$2"
  if [ -z "$val" ]; then echo "  skip $name (not in .env.local)"; return; fi
  $VC env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$val" | $VC env add "$name" production >/dev/null
  echo "  set  $name"
}

echo "== Linking Vercel project '$PROJECT' (creates it if missing) =="
$VC link --yes --project "$PROJECT"

echo "== Pushing production env vars =="
for v in "${INCLUDE[@]}"; do
  setvar "$v" "$(readval "$v")"
done
setvar PUBLIC_APP_URL "https://trymallet.com"

echo
echo "Done. Still to set MANUALLY (not from .env.local):"
echo "  - STRIPE_WEBHOOK_SECRET  → after you create the Stripe webhook endpoint (real whsec_):"
echo "      printf '%s' 'whsec_REAL' | $VC env add STRIPE_WEBHOOK_SECRET production"
echo
echo "Then deploy:  $VC --prod"
