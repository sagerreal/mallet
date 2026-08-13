import { router } from "./init";
import { createFrontdeskRouter } from "@mallet/frontdesk";
import { createLeadRouter } from "@mallet/customers";
import { createEstimateRouter } from "@mallet/quoting";
import { createJobRouter, createFieldRouter, createVisitRouter } from "@mallet/jobs";
import { createInvoiceRouter, createFieldInvoiceRouter, createTerminalRouter } from "@mallet/invoicing";
import { createNotificationRouter } from "@mallet/notifications";
import { createAiRouter, createFieldCopilotRouter } from "@mallet/ai";
import { createIdentityRouter } from "@mallet/identity";
import { createTaskRouter } from "@mallet/tasks";
import { createTimesheetRouter } from "@mallet/timesheets";
import { createCompanyRouter } from "@mallet/companies";
import { createTeamChatRouter } from "@mallet/team-chat";
import { createMeasurementRouter } from "@mallet/measurements";
import { createMessagingRouter } from "@mallet/messaging";
import { createSettingsRouter } from "@mallet/settings";
import { createChecklistRouter } from "@mallet/checklists";
import { createInboundRouter } from "@mallet/inbound";
import { createPricebookRouter } from "@mallet/pricebook";
import { createA2pRouter } from "@mallet/a2p";
import { createAssemblyRouter } from "@mallet/assemblies";
import { createQboRouter } from "@mallet/accounting-sync";
import { createCallRouter } from "@mallet/calls";

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
    // The technician's own money surface — field-scoped siblings of `invoicing`, mounted beside it
    // rather than folded into it so the office router's role guards stay exactly as they were.
    fieldInvoicing: createFieldInvoiceRouter(),
    // Stripe Terminal (Tap to Pay) server plumbing — the native reader PR consumes these.
    terminal: createTerminalRouter(),
    notifications: createNotificationRouter(),
    ai: createAiRouter(),
    fieldCopilot: createFieldCopilotRouter(),
    tasks: createTaskRouter(),
    timesheets: createTimesheetRouter(),
    companies: createCompanyRouter(),
    teamChat: createTeamChatRouter(),
    measurements: createMeasurementRouter(),
    messaging: createMessagingRouter(),
    calls: createCallRouter(),
    settings: createSettingsRouter(),
    checklists: createChecklistRouter(),
    inbound: createInboundRouter(),
    pricebook: createPricebookRouter(),
    assemblies: createAssemblyRouter(),
    frontdesk: createFrontdeskRouter(),
    a2p: createA2pRouter(),
    qbo: createQboRouter(),
  }),
});

export type AppRouter = typeof appRouter;
