import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

// Default landing for an invited user who has no password yet.
const SET_PASSWORD_PATH = "/set-password";

// Supabase email-based auth links land here in two formats:
//
//   1. PKCE flow (inviteUserByEmail, modern magic-link): carries a `code` query param.
//      Exchange the code for a session via exchangeCodeForSession.
//
//   2. OTP / token_hash flow (legacy confirmation links): carries `token_hash` + `type`.
//      Verify via verifyOtp — mirrors /auth/confirm.
//
// After a successful session, redirect to `next` (validated against open-redirect attacks) or to
// the set-password screen so the invited tech can choose their password before entering the app.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  const supabase = await createSupabaseServer();

  if (code) {
    // PKCE code exchange — standard for inviteUserByEmail in Supabase Auth v2.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectTo("/login?error=expired_link");
  } else if (tokenHash && type) {
    // OTP token_hash — used by older email templates and password recovery.
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return redirectTo("/login?error=expired_link");
  } else {
    // Neither format present — malformed link.
    return redirectTo("/login?error=invalid_link");
  }

  // Validate and resolve the next destination. Fall back to set-password so invited users land
  // on the password screen rather than the app shell (which would immediately redirect them away
  // because they have no principal yet, since the join hasn't run).
  //
  // Defense-in-depth: after safeNext's lexical check, resolve the path against the request origin
  // and hard-verify the origin still matches. This catches any novel bypass that passes safeNext
  // (e.g. a browser-specific parsing quirk) by having the URL constructor do the resolution and
  // letting us compare origins authoritatively.
  const dest = safeNext(next, SET_PASSWORD_PATH);
  const destUrl = new URL(dest, url.origin);
  const finalPath = destUrl.origin === url.origin ? dest : SET_PASSWORD_PATH;
  return redirectTo(finalPath);
}
