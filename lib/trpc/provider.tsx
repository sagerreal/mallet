"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/react-query";
import superjson from "superjson";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { api } from "./client";
import { registerListCache } from "./list-cache";

// App-wide tRPC + React Query provider. The Bearer token is read PER REQUEST from the live
// Supabase session (never cached) so refreshes propagate.
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  // Hand the cache to the store's mutations. They are not components, so they cannot call
  // useUtils(); without this a save updates the database and the list on screen does not move.
  // Registered during render rather than in an effect: a mutation can resolve before effects run
  // on a slow first paint, and an invalidation dropped then is a stale list nobody refreshes.
  registerListCache(queryClient);
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers: async () => {
            const { data } = await createSupabaseBrowser().auth.getSession();
            const token = data.session?.access_token;
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
