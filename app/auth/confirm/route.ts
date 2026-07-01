import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

// Supabase email links (signup confirmation, password recovery) land here with a token_hash.
// Verify server-side, then send the user to the right screen.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!tokenHash || !type) return redirectTo("/login?error=invalid_link");

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return redirectTo("/login?error=expired_link");

  return redirectTo(type === "recovery" ? "/reset-password" : "/");
}
