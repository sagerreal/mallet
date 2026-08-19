import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

// The OAuth `state` parameter for the Square connect flow, as a SIGNED, self-verifying token.
// Same construction and same reasoning as accounting-sync's QBO version — kept separate rather
// than shared so the two integrations cannot be made to accept each other's states, and so the
// DOMAIN label below is genuinely distinct.
//
// WHY NOT A COOKIE. App auth is a Bearer token, not a cookie session. The shop owner reaches
// Square's consent screen by a top-level navigation and comes back the same way — with no
// Authorization header — so the callback cannot identify the tenant from the request at all. The
// org id therefore has to travel IN the state, and it has to be tamper-proof: whoever can choose
// the org id in a callback can attach any Square merchant to any tenant. For a payments
// integration that means attaching THEIR merchant account to SOMEONE ELSE'S shop, which would
// route that shop's card revenue to the attacker.
//
// An HMAC over (orgId, expiry, nonce) closes that: an attacker cannot mint a state for a tenant
// they do not control, so their own state only ever targets their own org, which is harmless.
//
// Replay is bounded by the short TTL and by Square treating an authorization code as single-use.

const SEPARATOR = ".";
// Domain separation: this key also seals tokens, so the label keeps the two uses from ever
// producing interchangeable outputs.
const DOMAIN = "square-oauth-state:v1";

const sign = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(`${DOMAIN}|${payload}`).digest("base64url");

export interface SquareOauthStateClaims {
  readonly orgId: string;
  readonly expiresAt: Date;
}

/** Mint a state token binding this consent redirect to this org, valid until `expiresAt`. */
export const signSquareOauthState = (secret: string, orgId: string, expiresAt: Date): string => {
  const nonce = randomBytes(8).toString("base64url");
  const payload = [
    Buffer.from(orgId, "utf8").toString("base64url"),
    String(expiresAt.getTime()),
    nonce,
  ].join(SEPARATOR);
  return `${payload}${SEPARATOR}${sign(secret, payload)}`;
};

/** Verify signature and freshness, and recover the org the flow was started for. */
export const verifySquareOauthState = (
  secret: string,
  state: string,
  now: Date,
): Result<SquareOauthStateClaims, ValidationError> => {
  const parts = state.split(SEPARATOR);
  if (parts.length !== 4) return err(validation("malformed state", "state"));

  const [orgB64, expiryRaw, nonce, mac] = parts as [string, string, string, string];
  const payload = [orgB64, expiryRaw, nonce].join(SEPARATOR);
  const expected = sign(secret, payload);

  // Constant-time: a length-varying or short-circuiting compare leaks the signature a byte at a
  // time to anyone willing to retry.
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return err(validation("bad state signature", "state"));
  }

  const expiresAtMs = Number(expiryRaw);
  if (!Number.isFinite(expiresAtMs)) return err(validation("malformed state", "state"));
  if (now.getTime() > expiresAtMs) return err(validation("state expired", "state"));

  const orgId = Buffer.from(orgB64, "base64url").toString("utf8");
  if (orgId.length === 0) return err(validation("malformed state", "state"));

  return ok({ orgId, expiresAt: new Date(expiresAtMs) });
};
