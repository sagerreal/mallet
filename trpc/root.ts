import { router } from "./init";
import { createLeadRouter } from "@mallet/customers";
import { createEstimateRouter } from "@mallet/quoting";
import { createJobRouter, createFieldRouter, createVisitRouter } from "@mallet/jobs";
import { createInvoiceRouter } from "@mallet/invoicing";
import { createNotificationRouter } from "@mallet/notifications";
import { createAiRouter } from "@mallet/ai";
import { createIdentityRouter } from "@mallet/identity";
import { createTaskRouter } from "@mallet/tasks";
import { createTimesheetRouter } from "@mallet/timesheets";
import { createCompanyRouter } from "@mallet/companies";
import { createMessagingRouter } from "@mallet/messaging";
import { createSettingsRouter } from "@mallet/settings";
import { createChecklistRouter } from "@mallet/checklists";
import { createInboundRouter } from "@mallet/inbound";
import { createPricebookRouter } from "@mallet/pricebook";

// The versioned API tree. Clients call trpc.v1.<module>.*; a future v2 can coexist here while v1
// stays stable. Module routers are composed in — never defined here.
export const appRouter = router({
  v1: router({
    identity: createIdentityRouter(),
    customers: createLeadRouter(),
    quoting: createEstimateRouter(),
    jobs: createJobRouter(),
    field: createFieldRouter(),
    visits: createVisitRouter(),
    invoicing: createInvoiceRouter(),
    notifications: createNotificationRouter(),
    ai: createAiRouter(),
    tasks: createTaskRouter(),
    timesheets: createTimesheetRouter(),
    companies: createCompanyRouter(),
    messaging: createMessagingRouter(),
    settings: createSettingsRouter(),
    checklists: createChecklistRouter(),
    inbound: createInboundRouter(),
    pricebook: createPricebookRouter(),
  }),
});

export type AppRouter = typeof appRouter;
