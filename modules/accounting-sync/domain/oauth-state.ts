import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

// The OAuth `state` parameter, as a SIGNED, self-verifying token.
//
// Why not the usual cookie? Two reasons, both structural here:
//  1. App auth is a Bearer token, not a cookie session. The user reaches Intuit's consent screen by
//     a top-level navigation, and comes back to our callback the same way — with no Authorization
//     header. So the callback cannot identify the tenant from the request at all.
//  2. Therefore the org id has to travel IN the state, and it has to be tamper-proof: whoever can
//     choose the org id in a callback can attach any QuickBooks company to any tenant.
//
// An HMAC over (orgId, expiry) gives both. An attacker cannot mint a state for a tenant they don't
// control, so they cannot make a victim's org adopt their QuickBooks company — the actual CSRF
// risk in an OAuth callback. Their own state only ever targets their own org, which is harmless.
//
// Replay is bounded by the short TTL and by Intuit treating an authorization code as single-use.
// (A nonce table would make it strictly single-use; it is not worth a table for a 10-minute,
// self-targeting replay window.)

const SEPARATOR = ".";
// Domain separation: this key is also used to seal tokens, so the label keeps the two uses from
// ever producing interchangeable outputs.
const DOMAIN = "qbo-oauth-state:v1";

const sign = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(`${DOMAIN}|${payload}`).digest("base64url");

export interface OauthStateClaims {
  readonly orgId: string;
  readonly expiresAt: Date;
}

/** Mint a state token binding this consent redirect to this org, valid until `expiresAt`. */
export const signOauthState = (secret: string, orgId: string, expiresAt: Date): string => {
  // A random element so two states minted in the same millisecond for the same org still differ —
  // it makes the value unguessable rather than merely unforgeable.
  const nonce = randomBytes(8).toString("base64url");
  const payload = [
    Buffer.from(orgId, "utf8").toString("base64url"),
    String(expiresAt.getTime()),
    nonce,
  ].join(SEPARATOR);
  return `${payload}${SEPARATOR}${sign(secret, payload)}`;
};

/** Verify signature and freshness, and recover the org the flow was started for. */
export const verifyOauthState = (
  secret: string,
  state: string,
  now: Date,
): Result<OauthStateClaims, ValidationError> => {
  const parts = state.split(SEPARATOR);
  if (parts.length !== 4) return err(validation("malformed state", "state"));

  const [orgB64, expRaw, nonce, presented] = parts as [string, string, string, string];
  const payload = [orgB64, expRaw, nonce].join(SEPARATOR);

  const expected = sign(secret, payload);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  // Compare in constant time, and only when lengths match (timingSafeEqual throws otherwise).
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return err(validation("state signature does not match", "state"));
  }

  const expiresAtMs = Number(expRaw);
  if (!Number.isFinite(expiresAtMs)) return err(validation("malformed state", "state"));
  if (expiresAtMs <= now.getTime()) return err(validation("state has expired", "state"));

  const orgId = Buffer.from(orgB64, "base64url").toString("utf8");
  if (!orgId) return err(validation("malformed state", "state"));

  return ok({ orgId, expiresAt: new Date(expiresAtMs) });
};
