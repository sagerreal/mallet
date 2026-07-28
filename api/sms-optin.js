/**
 * Records an SMS opt-in from /sms.
 *
 * The form used to be `action="mailto:"`, which handed the whole submission to the visitor's mail
 * client. Nothing was stored, nothing was confirmed, and a reviewer who pressed Send saw no result
 * at all. A2P registration asks you to show how consent is captured — consent you cannot produce
 * on request is not consent.
 *
 * Zero-config Vercel function (no package.json in this repo), so it uses the built-in fetch against
 * Resend's REST API rather than an SDK.
 *
 * Plain form POST, not fetch(), so it works with JavaScript disabled and a reviewer lands on a real
 * confirmation page they can screenshot.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const NOTIFY_TO = process.env.OPTIN_NOTIFY_TO ?? "joe@trymallet.com";
const NOTIFY_FROM = process.env.OPTIN_NOTIFY_FROM ?? "Mallet <onboarding@resend.dev>";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      // A form this small has no business being large; refuse rather than buffer forever.
      if (raw.length > 10_000) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

// Digits only, then require a plausible US length. Deliberately permissive about formatting —
// rejecting "(925) 555-0123" for its punctuation would be the wrong kind of strict.
export function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

async function notify(record) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not silent: the submission still lands in the function log, which is the durable record
    // until the key is set. Loud enough to find, and it does not fail the visitor's request.
    console.error("[sms-optin] RESEND_API_KEY is not set — no email sent. Record:", JSON.stringify(record));
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      subject: `SMS opt-in — ${record.name || record.phone}`,
      text: [
        `Phone:    ${record.phone}`,
        `Name:     ${record.name || "(not given)"}`,
        `Consent:  ${record.consent ? "YES — checkbox ticked" : "no — box left unchecked"}`,
        `Details:  ${record.details || "(none)"}`,
        `When:     ${record.at}`,
        `IP:       ${record.ip}`,
        "",
        "Consent wording shown at the time of submission is the disclosure block on",
        "https://trymallet.com/sms — keep this email as the record of consent.",
      ].join("\n"),
    }),
  });

  if (!res.ok) {
    console.error(`[sms-optin] Resend rejected the notification (${res.status}):`, await res.text());
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const raw = await readBody(req);
    const form = new URLSearchParams(raw);

    const phone = normalizePhone(form.get("mobile"));
    if (!phone) {
      res.redirect(303, "/sms?error=phone");
      return;
    }

    const record = {
      phone,
      name: (form.get("name") ?? "").trim().slice(0, 120),
      details: (form.get("details") ?? "").trim().slice(0, 2000),
      // Unchecked box submits nothing at all, so absence IS the "no" — recorded either way,
      // because a submission without consent is still a lead we may call, just never text.
      consent: form.get("sms_consent") === "yes",
      at: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] ?? "unknown",
    };

    await notify(record);

    res.redirect(303, "/sms-thanks");
  } catch (err) {
    console.error("[sms-optin] failed:", err);
    res.redirect(303, "/sms?error=server");
  }
}
