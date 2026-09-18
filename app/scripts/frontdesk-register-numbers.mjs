/**
 * scripts/frontdesk-register-numbers.mjs
 * Connect ALREADY-BOUGHT numbers to the AI front desk.
 *
 *   pnpm fd:register            report what would be registered, change nothing
 *   pnpm fd:register --apply    actually register
 *   pnpm fd:register --apply "joe plumbing"
 *
 * WHY A BACK-FILL EXISTS. Registration happens once, at provisioning time
 * (ProvisionOrgNumberUseCase → VapiVoiceRegistrar). While VAPI_API_KEY was unset in production that
 * step silently self-disabled, so numbers were bought and left pointing at Twilio's default
 * "not configured" recording. Setting the key fixes every FUTURE signup and nothing already sold —
 * hence this.
 *
 * IDEMPOTENT, exactly like the registrar it mirrors: Vapi answers 409 / "already exists" for a
 * number it already holds, and that counts as success. Re-running is safe.
 *
 * DRY BY DEFAULT. It prints the plan and exits unless --apply is passed; this touches live phone
 * lines belonging to real shops.
 */
import postgres from "postgres";

const { DATABASE_URL, VAPI_API_KEY, VAPI_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PUBLIC_APP_URL } =
  process.env;

const missing = [
  !DATABASE_URL && "DATABASE_URL",
  !VAPI_API_KEY && "VAPI_API_KEY",
  !TWILIO_ACCOUNT_SID && "TWILIO_ACCOUNT_SID",
  !TWILIO_AUTH_TOKEN && "TWILIO_AUTH_TOKEN",
  !PUBLIC_APP_URL && "PUBLIC_APP_URL",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}`);
  console.error("Pull production values first:  npx vercel env pull .env.local --environment production");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const nameArg = args.find((a) => !a.startsWith("--")) ?? null;

// The SAME server URL the registrar uses. A mismatch here would point the line at a URL that
// answers nothing, which is worse than the state we are fixing.
const serverUrl = `${PUBLIC_APP_URL.replace(/\/$/, "")}/api/frontdesk/vapi`;

const sql = postgres(DATABASE_URL, { max: 1, ssl: "require", prepare: false });
const rows = await sql.unsafe(
  `select o.name, o.twilio_number
     from orgs o
    where o.twilio_number is not null
      and ($1::text is null or o.name ilike '%' || $1 || '%')
    order by o.name`,
  [nameArg],
);

if (rows.length === 0) {
  console.log(nameArg ? `No org with a number matching "${nameArg}".` : "No org owns a number.");
  await sql.end();
  process.exit(0);
}

console.log(`Server URL: ${serverUrl}`);
console.log(`Webhook secret: ${VAPI_WEBHOOK_SECRET ? "set" : "NOT SET — Vapi calls will fail verification"}`);
console.log(`${rows.length} number${rows.length === 1 ? "" : "s"}:\n`);
for (const r of rows) console.log(`  ${r.twilio_number}  ${r.name}`);

if (!apply) {
  console.log(`\nDry run — nothing changed. Re-run with --apply to register.`);
  await sql.end();
  process.exit(0);
}

console.log("");
let okCount = 0;
let already = 0;
let failed = 0;

for (const r of rows) {
  // Body identical to VapiVoiceRegistrar.register — no assistantId, because Vapi asks Mallet for an
  // assistant on every call and the org is resolved from the To-number.
  const res = await fetch("https://api.vapi.ai/phone-number", {
    method: "POST",
    headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "twilio",
      number: r.twilio_number,
      twilioAccountSid: TWILIO_ACCOUNT_SID,
      twilioAuthToken: TWILIO_AUTH_TOKEN,
      server: { url: serverUrl, ...(VAPI_WEBHOOK_SECRET ? { secret: VAPI_WEBHOOK_SECRET } : {}) },
    }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const text = JSON.stringify(body ?? {});

  if (res.status >= 200 && res.status < 300) {
    okCount++;
    console.log(`  registered   ${r.twilio_number}  ${r.name}`);
  } else if (res.status === 409 || /already exists|already in use|duplicate/i.test(text)) {
    already++;
    console.log(`  already had  ${r.twilio_number}  ${r.name}`);
  } else {
    failed++;
    // Print the provider's own words — a generic failure here would send somebody hunting.
    console.log(`  FAILED       ${r.twilio_number}  ${r.name}  [${res.status}] ${text.slice(0, 200)}`);
  }
}

console.log(`\n${okCount} registered · ${already} already connected · ${failed} failed`);
await sql.end();
process.exit(failed > 0 ? 1 : 0);
