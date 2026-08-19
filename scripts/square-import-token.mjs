/**
 * scripts/square-import-token.mjs
 * DEV ONLY. Store a Square OAuth token that was minted OUTSIDE the browser consent flow.
 *
 * WHY THIS EXISTS. Square's SANDBOX refuses the browser consent screen unless the browser already
 * carries a launched seller session, and that session does not reliably survive a profile with
 * other Square logins in it — the page renders blank with
 *   {"step":"ERROR","payload":{"error":"...first launch the seller test account..."},
 *    "merchant_token":null}
 * That is a sandbox-only obstacle: a real seller in production signs in normally. So rather than
 * let it block every downstream test (storage, status, disconnect, payments), the Developer
 * Console's "Authorize test account" button mints a token directly and this puts it where the app
 * expects it.
 *
 * It writes exactly what the real callback writes — same repository, same sealing — so what gets
 * tested afterwards is the real storage path, not a fixture.
 *
 *   node --env-file=.env.local scripts/square-import-token.mjs <ORG_ID> <ACCESS> <REFRESH> <MERCHANT_ID>
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { createCipheriv, randomBytes } from "node:crypto";

const [orgId, access, refresh, merchantId] = process.argv.slice(2);
if (!orgId || !access || !merchantId) {
  console.error("usage: node --env-file=.env.local scripts/square-import-token.mjs <ORG_ID> <ACCESS_TOKEN> <REFRESH_TOKEN> <MERCHANT_ID>");
  process.exit(1);
}

const key = process.env.SQUARE_TOKEN_ENCRYPTION_KEY;
if (!key) { console.error("SQUARE_TOKEN_ENCRYPTION_KEY is not set"); process.exit(1); }

// Mirrors platform/crypto/secret-box's envelope: v1.iv.tag.ciphertext, all base64.
const seal = (plaintext) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
};

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
try {
  // Same law as the repository: reconnecting REPLACES, so a shop never has two live merchants.
  await sql`update square_connections set deleted_at = now(), status = 'disconnected'
            where org_id = ${orgId} and deleted_at is null`;
  const rows = await sql`
    insert into square_connections
      (org_id, merchant_id, access_token_sealed, refresh_token_sealed, access_expires_at, status, scopes)
    values (${orgId}, ${merchantId}, ${seal(access)}, ${seal(refresh ?? "")},
            now() + interval '30 days', 'active',
            ${"MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS ORDERS_READ ORDERS_WRITE CUSTOMERS_READ CUSTOMERS_WRITE"})
    returning id, merchant_id`;
  console.log("connected:", rows[0]);
} finally {
  await sql.end();
}
