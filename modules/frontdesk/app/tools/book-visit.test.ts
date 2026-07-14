import { describe, it, expect, beforeEach } from "vitest";
import { asLeadId, asPhone } from "@mallet/shared/types";
import type { JobKind } from "../../../jobs/domain/job";
import {
  bookVisitTool,
  BOOK_VISIT_INVALID_PHONE_SPEAK,
} from "./book-visit";
import { BOOKING_CONFIRMATION_KIND, confirmationSms } from "./booking-confirmation";
import {
  buildHarness,
  settingsFrom,
  onlyJob,
  REPAIR_INPUT,
  ORG,
  LEAD_UUID,
  type Harness,
} from "./book-visit.harness";

// Happy-path + confirmation-SMS behaviour of book_visit. Failure/edge paths (fallback disposition,
// follow-up tasks, zero-minute duration) live in book-visit.failure.test.ts; the model-facing
// schema ↔ zod parity lives in book-visit.schema.test.ts. All three share book-visit.harness.ts.

describe("bookVisitTool", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("exposes a JSON schema whose required[] matches the zod input (problem in, urgency out)", () => {
    const params = bookVisitTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    // problem IS required (parity with zod); urgency is NOT (optional, defaults to "normal").
    expect(params.required.sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "service_name",
        "slot_date",
        "slot_window",
      ].sort(),
    );
    expect(params.required).not.toContain("urgency");
    expect(Object.keys(params.properties).sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "service_name",
        "slot_date",
        "slot_window",
        "urgency",
      ].sort(),
    );
  });

  it("repair: books a work-kind job + visit and states the service fee (credited)", async () => {
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);

    // lead ensured with the AI source + problem as notes + parsed phone
    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.notes).toBe("kitchen faucet dripping");
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));

    // a work-kind job with the service name + notes
    const job = onlyJob(h);
    expect(job.props.kind).toBe<JobKind>("work");
    expect(job.props.svc).toBe("Leaky faucet");
    expect(job.props.leadId).toBe(asLeadId(LEAD_UUID));

    // a visit seeded on the job: correct date, morning-window start = weekday open (08:00),
    // duration from visitRepairMinutes (90m = 1.5h)
    const visit = job.props.visits[0]!;
    expect(visit).toBeDefined();
    expect(visit.props.scheduledDate).toBe("2026-07-16");
    expect(visit.props.scheduledStart).toBe("08:00");
    expect(visit.props.durationMinutes).toBe(90);

    // price provenance: the service fee, credited phrasing on
    expect(result.speak).toContain("$89");
    expect(result.speak).toContain("credited toward the repair");
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
  });

  it("repair: omits the credited phrase when feeCredited is off", async () => {
    const h2 = buildHarness({ settings: settingsFrom({ booking: { services: [], notServices: "", serviceFee: 120, feeCredited: false } }) });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(result.speak).toContain("$120");
    expect(result.speak).not.toContain("credited");
  });

  it("estimate: books a kind='estimate' job, scope-minutes duration, and NO price", async () => {
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "estimate", service_name: "Repipe estimate" },
      h.ctx,
    );
    const job = onlyJob(h);
    expect(job.props.kind).toBe<JobKind>("estimate");
    // visitScopeMinutes = 30 in the fixture → 0.5h
    expect(job.props.visits[0]!.props.durationMinutes).toBe(30);

    expect(result.speak).toContain("free estimate visit");
    expect(result.speak).not.toContain("$");
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
  });

  it("flat with a configured price: states exactly the configured $price and books work", async () => {
    const withFlat = settingsFrom({
      booking: {
        services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withFlat });
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "flat", service_name: "Drain cleaning" },
      h2.ctx,
    );
    expect(result.speak).toContain("$99");
    expect(result.speak).not.toContain("$89"); // states the flat price, not the fee
    expect(onlyJob(h2).props.kind).toBe<JobKind>("work");
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
  });

  it("flat with an UNCONFIGURED name: falls back to the service fee, never an invented number", async () => {
    // the fixture's only flat service is priced 99; ask for a name that has no configured flat price
    const withFlat = settingsFrom({
      booking: {
        services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withFlat });
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "flat", service_name: "Mystery service" },
      h2.ctx,
    );
    // safe fallback: states the configured service fee, NOT the 99 flat price, NOT any invented value
    expect(result.speak).toContain("$89");
    expect(result.speak).not.toContain("$99");
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("afternoon window derives the 13:00 boundary start, never a model time", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_window: "afternoon" }, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.scheduledStart).toBe("13:00");
    expect(result.speak).toContain("$89");
  });

  it("morning window on Saturday derives Saturday's open hour", async () => {
    const satHours = settingsFrom({ hoursSatOpen: 9, hoursSatClose: 15 });
    const h2 = buildHarness({ settings: satHours });
    // 2026-07-18 is a Saturday
    await bookVisitTool.handle({ ...REPAIR_INPUT, slot_date: "2026-07-18", slot_window: "morning" }, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.scheduledStart).toBe("09:00");
  });

  it("invalid phone: does NOT book and re-asks for the number", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, phone: "not-a-phone" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_INVALID_PHONE_SPEAK);
    expect(h.leads.ensured).toHaveLength(0);
    expect(h.jobs.jobs.size).toBe(0);
  });

  it("emergency: files an EMERGENCY task and sets data.emergency=true", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, urgency: "emergency" }, h.ctx);
    expect(result.data).toMatchObject({ emergency: true, kind: "work" });
    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toContain("EMERGENCY");
    expect(h.tasks.created[0]!.text).toContain("Leaky faucet");
    expect(h.tasks.created[0]!.text).toContain("12 Elm St, Pleasanton");
    // the EMERGENCY task is NOT the failure task (guards the fallback-text rename didn't bleed in)
    expect(h.tasks.created[0]!.text).not.toContain("Booking attempt failed");
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
  });

  // ── booking-confirmation SMS (fired from inside handle, once, after CreateVisit succeeds) ──

  it("repair: sends ONE confirmation SMS keyed on the job id, to the parsed phone, with brand + STOP", async () => {
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);

    const jobId = onlyJob(h).props.id;
    expect(h.sms.sent).toHaveLength(1);
    const cmd = h.sms.sent[0]!;
    expect(cmd.orgId).toBe(ORG);
    expect(cmd.channel).toBe("sms");
    expect(cmd.to).toBe(asPhone("+19255550182"));
    expect(cmd.kind).toBe(BOOKING_CONFIRMATION_KIND);
    expect(cmd.idempotencyKey).toBe(`booking-confirm-${jobId}`);
    // brand name from settings (fixture default) + STOP opt-out language
    expect(cmd.body).toContain("My Business");
    expect(cmd.body).toContain("STOP");
    // the same slot phrase book_visit speaks ("Thursday morning")
    expect(cmd.body).toContain("Thursday morning");
    // the body matches the pure builder exactly (no drift between helper + send)
    expect(cmd.body).toBe(confirmationSms("My Business", "Thursday morning"));
  });

  it("estimate + flat bookings also send exactly one confirmation SMS", async () => {
    const estimate = buildHarness();
    await bookVisitTool.handle({ ...REPAIR_INPUT, lane: "estimate", service_name: "Repipe estimate" }, estimate.ctx);
    expect(estimate.sms.sent).toHaveLength(1);
    expect(estimate.sms.sent[0]!.idempotencyKey).toBe(`booking-confirm-${onlyJob(estimate).props.id}`);

    const flat = buildHarness();
    await bookVisitTool.handle({ ...REPAIR_INPUT, lane: "flat", service_name: "Drain cleaning" }, flat.ctx);
    expect(flat.sms.sent).toHaveLength(1);
  });

  it("SMS send returns err: booking STILL succeeds (background-path — no fail)", async () => {
    const h2 = buildHarness({ smsMode: "err" });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // the confirmation speak is unchanged — the booking succeeded
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
    expect(result.speak).toContain("$89");
    expect(h2.jobs.jobs.size).toBe(1);
    expect(h2.sms.sent).toHaveLength(1); // attempted once
  });

  it("SMS send THROWS: booking STILL succeeds (never throws from the SMS step)", async () => {
    const h2 = buildHarness({ smsMode: "throw" });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(result.data).toMatchObject({ kind: "work" });
    expect(result.speak).toContain("$89");
    expect(h2.jobs.jobs.size).toBe(1);
  });

  it("invalid phone: never books and never sends an SMS", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, phone: "not-a-phone" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_INVALID_PHONE_SPEAK);
    expect(h.sms.sent).toHaveLength(0);
  });
});
