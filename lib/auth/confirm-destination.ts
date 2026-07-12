import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "./safe-next";

// Default redirect path for each Supabase email OTP type.
// Anything not explicitly listed (e.g. "email_change") falls back to "/".
const TYPE_DEFAULTS: Partial<Record<EmailOtpType, string>> = {
  recovery: "/reset-password",
  invite: "/set-password",
};

const FALLBACK = "/";

// Pure helper: given a Supabase OTP type and an optional `next` query param,
// return the destination path the confirm route should redirect to.
//
// Rules:
//   1. Start with the type's default path (recovery→/reset-password, invite→/set-password, else /).
//   2. If `next` is present, validate it with safeNext against that default.
//      A safe `next` wins; a missing or unsafe one falls back to the type default.
//
// Never mutates arguments; always returns a same-origin relative path.
export function confirmDestination(type: string, next: string | null | undefined): string {
  const defaultPath = TYPE_DEFAULTS[type as EmailOtpType] ?? FALLBACK;
  return safeNext(next, defaultPath);
}
