import { describe, it, expect } from "vitest";
import { describeProposal } from "./proposal-summary";

describe("describeProposal", () => {
  it("summarizes quote_draft with subtotal math (optional lines excluded), tax and deposit", () => {
    const s = describeProposal("quote_draft", {
      leadId: "0b8f2c1a-1111-2222-3333-444444444444",
      title: "Panel upgrade",
      taxBps: 875,
      depBps: 2500,
      lines: [
        { description: "Labor", quantity: 2, rateCents: 15000 },
        { description: "Panel", quantity: 1, rateCents: 42000 },
        { description: "Surge protector (optional)", quantity: 1, rateCents: 9900, isOptional: true },
      ],
    });
    expect(s).toContain("0b8f2c1a-1111-2222-3333-444444444444");
    expect(s).toContain('"Panel upgrade"');
    expect(s).toContain("3 line item(s)");
    expect(s).toContain("$720.00"); // 2×150 + 1×420, optional excluded
    expect(s).toContain("tax 8.75%");
    expect(s).toContain("deposit 25%");
    expect(s).toContain("DRAFT");
  });

  it("omits absent title/tax/deposit rather than rendering empty fragments", () => {
    const s = describeProposal("quote_draft", { leadId: "x", lines: [{ description: "Labor", quantity: 1, rateCents: 5000 }] });
    expect(s).toContain("1 line item(s), subtotal $50.00");
    expect(s).not.toContain("tax");
    expect(s).not.toContain("deposit");
    expect(s).not.toContain('""');
  });

  it("summarizes invoice_send with the invoice id and the payment-terms consequence", () => {
    const s = describeProposal("invoice_send", { invoiceId: "inv-1" });
    expect(s).toContain("inv-1");
    expect(s).toContain("SENT");
    expect(s).toContain("payment terms");
  });

  it("summarizes quote_send with the estimate id and 'sent' transition", () => {
    const s = describeProposal("quote_send", { estimateId: "est-42" });
    expect(s).toContain("est-42");
    expect(s).toContain("sent");
    expect(s).not.toContain("JSON");
  });

  it("summarizes notification_send_invoice_reminder with invoice id and channel", () => {
    const s = describeProposal("notification_send_invoice_reminder", { invoiceId: "inv-7", channel: "sms" });
    expect(s).toContain("inv-7");
    expect(s).toContain("sms");
    expect(s).not.toContain("JSON");
  });

  it("summarizes job_schedule with customer id and optional title+start", () => {
    const s = describeProposal("job_schedule", { leadId: "lead-1", title: "Roof inspection", scheduledStart: "2026-08-01T09:00:00Z" });
    expect(s).toContain("lead-1");
    expect(s).toContain("Roof inspection");
    expect(s).toContain("2026-08-01");
    expect(s).not.toContain("JSON");
  });

  it("summarizes job_assign with job id (no raw assignee UUID)", () => {
    const s = describeProposal("job_assign", { jobId: "job-5", assigneeUserId: "user-99" });
    expect(s).toContain("job-5");
    expect(s).not.toContain("user-99"); // no raw UUID
    expect(s).not.toContain("JSON");
  });

  it("summarizes job_assign with unassign when assigneeUserId is null", () => {
    const s = describeProposal("job_assign", { jobId: "job-5", assigneeUserId: null });
    expect(s).toContain("job-5");
    expect(s).toContain("Unassign");
    expect(s).not.toContain("JSON");
  });

  it("summarizes task_create with text and due date", () => {
    const s = describeProposal("task_create", { text: "Call Jane", dueDate: "2026-07-20" });
    expect(s).toContain("Call Jane");
    expect(s).toContain("2026-07-20");
    expect(s).not.toContain("JSON");
  });

  it("summarizes customer_create with the proposed name", () => {
    const s = describeProposal("customer_create", { name: "Apex Roofing" });
    expect(s).toContain("Apex Roofing");
    expect(s).not.toContain("JSON");
  });

  it("summarizes invoice_draft with subtotal and line count (no raw cents)", () => {
    const s = describeProposal("invoice_draft", {
      leadId: "lead-2",
      title: "Electrical work",
      termsDays: 14,
      lines: [
        { description: "Labor", quantity: 4, rateCents: 10000 },
        { description: "Parts", quantity: 1, rateCents: 5000 },
      ],
    });
    expect(s).toContain("lead-2");
    expect(s).toContain("Electrical work");
    expect(s).toContain("2 line item(s)");
    expect(s).toContain("$450.00"); // 4×100 + 1×50
    expect(s).toContain("net 14");
    expect(s).toContain("DRAFT");
    expect(s).not.toContain("10000"); // no raw cents
    expect(s).not.toContain("JSON");
  });

  it("summarizes invoice_create_from_job with job id", () => {
    const s = describeProposal("invoice_create_from_job", { jobId: "job-12" });
    expect(s).toContain("job-12");
    expect(s).toContain("Idempotent");
    expect(s).not.toContain("JSON");
  });

  it("summarizes schedule_visit with job id, date, start, duration", () => {
    const s = describeProposal("schedule_visit", {
      jobId: "job-3",
      assigneeUserId: "user-99",
      scheduledDate: "2026-08-05",
      scheduledStart: "08:00",
      durationHours: 3,
    });
    expect(s).toContain("job-3");
    expect(s).toContain("2026-08-05");
    expect(s).toContain("08:00");
    expect(s).toContain("3h");
    expect(s).not.toContain("user-99"); // assigneeUserId not surfaced in summary
    expect(s).not.toContain("JSON");
  });

  it("invoice_record_payment renders a dollar amount (not raw cents) — no JSON dump", () => {
    const s = describeProposal("invoice_record_payment", {
      invoiceId: "inv-15",
      amountCents: 45000,
      method: "cash",
    });
    expect(s).toContain("$450.00"); // formatted dollar amount
    expect(s).toContain("cash");
    expect(s).toContain("inv-15");
    expect(s).toContain("SENSITIVE");
    expect(s).not.toContain("45000"); // no raw cents
    expect(s).not.toContain("JSON");
  });

  it("invoice_record_payment — idempotencyKey (server-minted, may be present in frozen args) does not appear as raw UUID", () => {
    const s = describeProposal("invoice_record_payment", {
      invoiceId: "inv-15",
      amountCents: 10000,
      method: "card",
      idempotencyKey: "some-server-minted-key",
    });
    expect(s).toContain("$100.00");
    expect(s).toContain("card");
    // The key itself is an implementation detail — should not be in the human summary
    expect(s).not.toContain("some-server-minted-key");
  });

  it("summarizes invoice_void with invoice id and DESTRUCTIVE warning", () => {
    const s = describeProposal("invoice_void", { invoiceId: "inv-20" });
    expect(s).toContain("inv-20");
    expect(s).toContain("DESTRUCTIVE");
    expect(s).not.toContain("JSON");
  });

  it("summarizes timesheet_approve_week with dates (no raw UUID)", () => {
    const s = describeProposal("timesheet_approve_week", {
      techUserId: "user-42",
      dates: ["2026-07-07", "2026-07-08", "2026-07-09"],
    });
    expect(s).toContain("2026-07-07");
    expect(s).toContain("2026-07-08");
    expect(s).toContain("payroll");
    expect(s).not.toContain("user-42"); // raw UUID suppressed from human summary
    expect(s).not.toContain("JSON");
  });

  it("summarizes customer_update with the customer id (not leadId) and changed field names", () => {
    const s = describeProposal("customer_update", {
      customerId: "cust-9",
      phone: "+15551234567",
      email: "j@example.com",
    });
    expect(s).toContain("cust-9");
    expect(s).not.toContain("?"); // the id resolved — this is the regression the bug produced
    expect(s).toContain("phone");
    expect(s).toContain("email");
    expect(s).not.toContain("customerId"); // the id field itself is never listed as "changed"
    expect(s).not.toContain("leadId");
    expect(s).not.toContain("+15551234567"); // no raw PII value on the approval card
    expect(s).not.toContain("JSON");
  });

  it("summarizes customer_update with 'nothing' when no field keys are present besides the id", () => {
    const s = describeProposal("customer_update", { customerId: "cust-10" });
    expect(s).toContain("cust-10");
    expect(s).toContain("nothing");
  });

  it("falls back to compact JSON for a tool without a bespoke renderer", () => {
    const s = describeProposal("future_tool", { a: 1 });
    expect(s).toContain("future_tool");
    expect(s).toContain('{"a":1}');
  });
});
