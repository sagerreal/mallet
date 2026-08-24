import { createHash, timingSafeEqual } from "node:crypto";

/**
 * shared/cron/secret.ts
 * Constant-time credential check for the cron routes.
 *
 * Both sides are hashed to a fixed 32 bytes before comparison: timingSafeEqual throws on
 * unequal lengths, so comparing raw strings would turn a length mismatch into a 500 and hand an
 * attacker a length oracle. Never log the presented value.
 *
 * Lives here rather than in either route because a constant-time comparator that exists twice
 * drifts, and because a pure function can be unit-tested — CI does not run the route tests.
 */
const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export const secretMatches = (presented: string, expected: string): boolean => {
  // `presented.length === 0` is the load-bearing half: without it, a blank configured secret
  // (`expected === ""`) would authenticate a blank/absent credential, since digest("") ===
  // digest(""). `expected.length === 0` has no independently observable effect -- digest() is
  // collision-resistant, so a non-empty `presented` can never hash-collide with digest("") --
  // but keep it: it is defence-in-depth for a future caller of this function that has no
  // separate 503-when-unset pre-check, so an unset `expected` still fails closed even if the
  // hash primitive is ever swapped for one where that guarantee is less certain.
  if (presented.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(expected));
};

/**
 * The credential as presented by Vercel Cron (`Authorization: Bearer <secret>`) or a
 * hand-rolled pinger (`x-cron-secret: <secret>`).
 *
 * This mirrors the outbox route's original credential read exactly, including one
 * non-obvious precedence rule: an `authorization` header, if present AT ALL, wins outright.
 * Its value has a leading `Bearer` + whitespace stripped (case-insensitively) when present;
 * if the header carries some other scheme (e.g. `Basic ...`), that raw value is still what
 * gets returned — it is never null and `x-cron-secret` is never consulted. `x-cron-secret` is
 * only read when the `authorization` header is entirely absent. This is a deliberate
 * preservation of the live route's pre-existing behaviour, not a new design decision — see
 * secret.test.ts for the cases this locks in.
 */
export const readCronSecret = (req: Request): string | null => {
  const authorization = req.headers.get("authorization");
  if (authorization !== null) return authorization.replace(/^Bearer\s+/i, "");
  return req.headers.get("x-cron-secret");
};
