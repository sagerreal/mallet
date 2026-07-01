import { router } from "./init";
import { createLeadRouter } from "@mallet/customers";
import { createEstimateRouter } from "@mallet/quoting";
import { createJobRouter } from "@mallet/jobs";
import { createInvoiceRouter } from "@mallet/invoicing";
import { createNotificationRouter } from "@mallet/notifications";
import { createAiRouter } from "@mallet/ai";

// The versioned API tree. Clients call trpc.v1.<module>.*; a future v2 can coexist here while v1
// stays stable. Module routers are composed in — never defined here.
export const appRouter = router({
  v1: router({
    customers: createLeadRouter(),
    quoting: createEstimateRouter(),
    jobs: createJobRouter(),
    invoicing: createInvoiceRouter(),
    notifications: createNotificationRouter(),
    ai: createAiRouter(),
  }),
});

export type AppRouter = typeof appRouter;
