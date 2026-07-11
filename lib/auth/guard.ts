import { redirect } from "next/navigation";
import type { Principal, Role } from "@mallet/identity";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAppDeps } from "@/trpc/di";

// Authenticate an access token → Principal via the SAME auth path as the API (verify → resolve),
// failing closed to null on any error so shells re-auth rather than 500.
const principalFromToken = async (token: string | null | undefined): Promise<Principal | null> => {
  if (!token) return null;
  try {
    const result = await getAppDeps().authProvider.authenticate(token);
    return result.ok ? result.value : null;
  } catch {
    return null; // a transient auth-provider/network error must fail closed to re-auth, not a 500
  }
};

// Server-side session → Principal. Uses the SAME auth path as the API (Bearer → verify → resolve),
// so shells and backend can never disagree about who the caller is.
export const getSessionPrincipal = async (): Promise<Principal | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  return principalFromToken(data.session?.access_token);
};

// Layout guard: anonymous → login; authenticated-but-unprovisioned → welcome; wrong role → their
// own home. Defense in depth — every backend procedure re-checks the role regardless.
// Reads the session ONCE (no redundant second read) and verifies its token locally via getClaims.
export const guardRole = async (allowed: readonly Role[]): Promise<Principal> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await principalFromToken(data.session.access_token);
  if (!principal) redirect("/welcome");
  if (!allowed.includes(principal.role)) redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
  return principal;
};
