import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (cookie-backed session shared with the server helpers).
export const createSupabaseBrowser = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
