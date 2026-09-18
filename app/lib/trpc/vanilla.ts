/**
 * lib/trpc/vanilla.ts
 * Vanilla (non-React) tRPC client — used by the Zustand store slices that persist
 * optimistic writes (board visits, tasks, estimates, invoices, companies, timesheets).
 *
 * BROWSER-ONLY: it authenticates by reading the live Supabase browser session and
 * sending the same `Bearer <access_token>` header the React provider sends
 * (lib/trpc/provider.tsx). Without this, every store-action write hits the tRPC
 * endpoint unauthenticated and 401s (then the optimistic update rolls back).
 * Do not import this from server code — a server caller has no browser session.
 *
 * Use `api` (createTRPCReact) inside React components; use `trpcVanilla` from store slices.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import type { AppRouter } from "@/trpc/root";

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Read the token PER REQUEST from the live session (never cached) so refreshes propagate,
      // mirroring the React provider so store-action writes authenticate identically.
      headers: async () => {
        const { data } = await createSupabaseBrowser().auth.getSession();
        const token = data.session?.access_token;
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
