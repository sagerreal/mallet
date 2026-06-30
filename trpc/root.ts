import { router } from "./init";
import { createLeadRouter } from "@mallet/customers";

// The versioned API tree. Clients call trpc.v1.customers.*; a future v2 can coexist here while
// v1 stays stable. Module routers are composed in — never defined here.
export const appRouter = router({
  v1: router({
    customers: createLeadRouter(),
  }),
});

export type AppRouter = typeof appRouter;
