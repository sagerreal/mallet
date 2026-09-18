import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { confirmDestination } from "@/lib/auth/confirm-destination";

// Supabase email links (invite, magic link, signup confirmation, password recovery) land here
// with a token_hash. Verify server-side, then route the user to the correct next screen.
//
// Expected query params:
//   token_hash  — the opaque hash from Supabase's {{ .TokenHash }} template variable
//   type        — Supabase OTP type: "invite" | "recovery" | "magiclink" | "signup" | "email"
//   next        — (optional) a same-origin relative path to redirect to after verification;
//                 validated by safeNext inside confirmDestination to prevent open-redirect
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!tokenHash || !type) {
    return redirectTo("/login?error=invalid_link");
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return redirectTo("/login?error=expired_link");
  }

  const destination = confirmDestination(type, next);
  return redirectTo(destination);
}
