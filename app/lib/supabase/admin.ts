import { createClient } from "@supabase/supabase-js";

// Service-role Supabase admin client — NEVER import from client components or expose to the
// browser. The service role bypasses RLS; it must only be used in server-side code (tRPC routers,
// route handlers, migration scripts). It is built lazily and cached for the process lifetime so we
// don't construct a new client on every request.
let _admin: ReturnType<typeof createClient> | null = null;

export const getSupabaseAdmin = (): ReturnType<typeof createClient> => {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "getSupabaseAdmin: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set — " +
        "cannot build the service-role client",
    );
  }

  _admin = createClient(url, key, {
    auth: {
      // The admin client never manages a user session — disable auto-refresh so it doesn't
      // start a background timer and doesn't touch localStorage in server-side contexts.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return _admin;
};
