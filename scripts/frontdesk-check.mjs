/**
 * scripts/frontdesk-check.mjs
 * Can this shop's front desk answer a call? One line per org, and the reason when it can't.
 *
 *   pnpm fd:check              every org that owns a number
 *   pnpm fd:check "joe plumb"  one shop by name (case-insensitive, partial)
 *   pnpm fd:check --all        every org, including those with no number yet
 *
 * WHY THIS EXISTS. Answering takes four independent things to be true, owned by three different
 * systems — a number on the org (Twilio), that number registered for voice (Vapi), a settings row
 * that passes frontDeskReadiness, and the switch itself. Any one missing produces the same
 * symptom: the phone rings and nothing useful happens. Two live shops sat unable to answer for ten
 * days because nothing put those four facts on one line.
 *
 * READ-ONLY. It writes nothing. With VAPI_API_KEY present it also asks Vapi which numbers are
 * actually registered — the one fact the database cannot know, and the one that was silently false
 * for every number bought while the key was unset. Without the key it says "unknown" rather than
 * guessing, because a confident wrong answer here is what hid the problem in the first place.
 */
import postgres from "postgres";

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL is not set — run through `pnpm fd:check`, which loads .env.local.");
  process.exit(1);
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const nameArg = args.find((a) => !a.startsWith("--")) ?? null;

/**
 * Numbers Vapi actually holds, or null when we cannot ask.
 *
 * E.164 compared as-is: both sides store the same format Twilio sells, and normalising would
 * invent a match rule that could report a line as wired when it is not.
 */
async function registeredNumbers() {
  if (!process.env.VAPI_API_KEY) return null;
  try {
    const res = await fetch("https://api.vapi.ai/phone-number", {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!res.ok) {
      console.error(`  (Vapi lookup failed: ${res.status} — voice state shown as unknown)`);
      return null;
    }
    const list = await res.json();
    return new Set((Array.isArray(list) ? list : []).map((n) => n?.number).filter(Boolean));
  } catch (e) {
    console.error(`  (Vapi lookup threw: ${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

const wired = await registeredNumbers();

const sql = postgres(DB, { max: 1, ssl: "require", prepare: false });

// The readiness rule, in SQL — the twin of modules/settings/domain/front-desk-readiness.ts.
// Kept deliberately explicit rather than clever so a reader can check it against that file.
const rows = await sql.unsafe(
  `
  select o.name,
         o.twilio_number,
         coalesce(s.front_desk, false)                              as fd_on,
         (s.org_id is not null)                                     as has_settings,
         (coalesce(s.hours_mon_close,0) > coalesce(s.hours_mon_open,0)
       or coalesce(s.hours_tue_close,0) > coalesce(s.hours_tue_open,0)
       or coalesce(s.hours_wed_close,0) > coalesce(s.hours_wed_open,0)
       or coalesce(s.hours_thu_close,0) > coalesce(s.hours_thu_open,0)
       or coalesce(s.hours_fri_close,0) > coalesce(s.hours_fri_open,0)
       or coalesce(s.hours_sat_close,0) > coalesce(s.hours_sat_open,0)
       or coalesce(s.hours_sun_close,0) > coalesce(s.hours_sun_open,0)) as has_hours,
         (coalesce(s.service_origin_address,'') <> '')               as has_origin,
         (jsonb_array_length(coalesce(s.booking->'services','[]'::jsonb)) > 0) as has_services,
         jsonb_array_length(coalesce(s.booking->'services','[]'::jsonb)) as n_services
    from orgs o
    left join org_settings s on s.org_id = o.id
   where ($1::text is null or o.name ilike '%' || $1 || '%')
     and ($2::boolean or o.twilio_number is not null)
   order by o.twilio_number is null, o.name
  `,
  [nameArg, all],
);

if (rows.length === 0) {
  console.log(nameArg ? `No org matching "${nameArg}".` : "No org owns a number yet.");
  await sql.end();
  process.exit(0);
}

const mark = (ok) => (ok ? "ok" : "MISSING");
let blocked = 0;

for (const r of rows) {
  const gaps = [
    !r.has_hours && "hours",
    !r.has_origin && "service area",
    !r.has_services && "a bookable service",
  ].filter(Boolean);

  // The order below is the order a call hits them, so the FIRST failure is the one to fix.
  // Voice registration is part of "will answer" whenever we could actually check it.
  const voiceOk = wired === null ? null : Boolean(r.twilio_number && wired.has(r.twilio_number));
  const willAnswer =
    Boolean(r.twilio_number) && r.fd_on && gaps.length === 0 && voiceOk !== false;
  if (!willAnswer) blocked++;

  console.log(`\n${r.name}`);
  console.log(`  number          ${r.twilio_number ?? "MISSING — never provisioned"}`);
  console.log(
    `  voice wired     ${
      voiceOk === null
        ? "unknown (set VAPI_API_KEY to check)"
        : voiceOk
          ? "ok"
          : "MISSING — bought but never registered with Vapi"
    }`,
  );
  console.log(`  settings row    ${mark(r.has_settings)}${r.has_settings ? "" : " — lazy-created on first read"}`);
  console.log(`  hours           ${mark(r.has_hours)}`);
  console.log(`  service area    ${mark(r.has_origin)}`);
  console.log(`  services        ${r.n_services > 0 ? `ok (${r.n_services})` : "MISSING"}`);
  console.log(`  front desk      ${r.fd_on ? "on" : "off"}`);

  if (willAnswer) {
    console.log(`  VERDICT: will answer`);
  } else if (!r.twilio_number) {
    console.log(`  VERDICT: cannot answer — no phone number`);
  } else if (voiceOk === false) {
    // The line rings and the caller hears Twilio's default recording. Nothing in the app is wrong.
    console.log(`  VERDICT: cannot answer — the number is not connected to Vapi (run: pnpm fd:register --apply)`);
  } else if (gaps.length > 0 && !r.fd_on) {
    console.log(`  VERDICT: cannot answer — add ${gaps.join(", ")}, then switch it on`);
  } else if (gaps.length > 0 && r.fd_on) {
    // The dangerous one: switched on and answering while it knows nothing.
    console.log(`  VERDICT: ANSWERING WHILE UNREADY — missing ${gaps.join(", ")}`);
  } else {
    console.log(`  VERDICT: ready, but the switch is off`);
  }
}

console.log(
  `\n${rows.length} org${rows.length === 1 ? "" : "s"} checked · ${blocked} cannot answer as configured.`,
);
await sql.end();
