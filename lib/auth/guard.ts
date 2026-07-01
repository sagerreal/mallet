import { redirect } from "next/navigation";
import type { Principal, Role } from "@mallet/identity";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAppDeps } from "@/trpc/di";

// Server-side session → Principal. Uses the SAME auth path as the API (Bearer → verify → resolve),
// so shells and backend can never disagree about who the caller is.
export const getSessionPrincipal = async (): Promise<Principal | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const result = await getAppDeps().authProvider.authenticate(token);
  return result.ok ? result.value : null;
};

// Layout guard: anonymous → login; authenticated-but-unprovisioned → welcome; wrong role → their
// own home. Defense in depth — every backend procedure re-checks the role regardless.
export const guardRole = async (allowed: readonly Role[]): Promise<Principal> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await getSessionPrincipal();
  if (!principal) redirect("/welcome");
  if (!allowed.includes(principal.role)) redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
  return principal;
};
