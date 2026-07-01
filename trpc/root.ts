import { router } from "./init";
import { createLeadRouter } from "@mallet/customers";
import { createEstimateRouter } from "@mallet/quoting";
import { createJobRouter } from "@mallet/jobs";
import { createInvoiceRouter } from "@mallet/invoicing";

// The versioned API tree. Clients call trpc.v1.customers.* / .quoting.* / .jobs.* / .invoicing.*;
// a future v2 can coexist here while v1 stays stable. Module routers are composed in.
export const appRouter = router({
  v1: router({
    customers: createLeadRouter(),
    quoting: createEstimateRouter(),
    jobs: createJobRouter(),
    invoicing: createInvoiceRouter(),
  }),
});

export type AppRouter = typeof appRouter;
