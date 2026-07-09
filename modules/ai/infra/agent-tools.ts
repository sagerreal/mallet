import type { AgentTool } from "../domain/tool";
import {
  getContextTool,
  customerListTool,
  invoiceListTool,
  estimateListTool,
  customerGetTool,
  estimateGetTool,
  invoiceGetTool,
  jobListTool,
  jobGetTool,
  taskListTool,
  memberListTool,
  companyListTool,
  companyGetTool,
  timesheetListTool,
  notificationDueRemindersTool,
} from "./tools/read-tools";
import {
  quoteDraftTool,
  invoiceSendTool,
  quoteSendTool,
  notificationSendInvoiceReminderTool,
  jobScheduleTool,
  jobAssignTool,
  taskCreateTool,
  customerCreateTool,
  invoiceDraftTool,
  invoiceCreateFromJobTool,
  scheduleVisitTool,
  invoiceRecordPaymentTool,
  invoiceVoidTool,
  timesheetApproveWeekTool,
} from "./tools/write-tools";

// MCP-shaped tool registry: each tool reuses the SAME use-case the tRPC API calls, constructed from
// the per-call tenant tx (one business-logic surface). Read tools run unattended; mutating:true tools
// pause for human approval before the loop ever executes them. Summaries return human names + INV-/
// EST- numbers and the ids the model needs to chain. Tenant scoping is enforced by ctx (withTenant);
// org/tenant fields never appear in an input schema.
//
// Tool implementations live in:
//   ./tools/shared.ts      — shared helpers and all input schemas
//   ./tools/read-tools.ts  — get_context + all read (mutating: false) tools
//   ./tools/write-tools.ts — all write + sensitive (mutating: true) tools

// The curated tool surface. Grow it as real field-service tasks reveal gaps — not one tool per API.
// Order is preserved: get_context first, reads next, writes last.
export const buildAgentTools = (): AgentTool[] => [
  // Context bootstrap (call first on any new conversation)
  getContextTool,
  // Existing read tools
  customerListTool,
  invoiceListTool,
  estimateListTool,
  // New platform read tools (Phase A)
  customerGetTool,
  estimateGetTool,
  invoiceGetTool,
  jobListTool,
  jobGetTool,
  taskListTool,
  memberListTool,
  companyListTool,
  companyGetTool,
  timesheetListTool,
  notificationDueRemindersTool,
  // Existing write tools
  quoteDraftTool,
  invoiceSendTool,
  // Approval-gated write tools (Phase B)
  quoteSendTool,
  notificationSendInvoiceReminderTool,
  jobScheduleTool,
  jobAssignTool,
  taskCreateTool,
  customerCreateTool,
  invoiceDraftTool,
  invoiceCreateFromJobTool,
  scheduleVisitTool,
  // Sensitive write tools (Phase C)
  invoiceRecordPaymentTool,
  invoiceVoidTool,
  timesheetApproveWeekTool,
];
