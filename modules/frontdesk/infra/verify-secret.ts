import { timingSafeEqual } from "node:crypto";

// Constant-time comparison of the provided `x-vapi-secret` header against the configured secret.
// A naive `===` short-circuits on the first differing byte, leaking secret length + prefix through
// timing. timingSafeEqual is constant-time BUT throws on a length mismatch (which would itself leak
// length), so we length-guard first and return false — an attacker learns only "wrong", never how
// wrong. A null/absent header is always a miss.
export const verifyVapiSecret = (provided: string | null | undefined, expected: string): boolean => {
  if (provided === null || provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};
