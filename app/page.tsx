import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { lookupSessionPrincipal } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * The post-login fork: every signed-in session lands here and is sent to its home.
 *
 * It reads the FULL lookup rather than `Principal | null` because the three ways there can be no
 * principal need three different destinations. Collapsing them is what showed a provisioned owner
 * "Set up your shop" while the connection pooler was refusing connections.
 */
export default async function Root() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");

  const lookup = await lookupSessionPrincipal();

  if (lookup.status === "unauthenticated") redirect("/login");

  // NEVER /welcome. "We could not reach the database" is not "you have no workspace", and the
  // difference is expensive: /welcome offers a Create workspace button that provisions a new org
  // and buys it a phone number. The error boundary says "Something went wrong" and offers Try
  // again — honest, recoverable, and incapable of minting anything.
  if (lookup.status === "unavailable") {
    throw new Error("could not resolve this session's workspace");
  }

  if (lookup.status === "unprovisioned") redirect("/welcome");

  redirect(lookup.principal.role === "tech" ? "/my-day" : "/dashboard");
}
