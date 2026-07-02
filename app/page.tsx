import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSessionPrincipal } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function Root() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await getSessionPrincipal();
  if (!principal) redirect("/welcome");
  redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
}
