import { describe, it, expect, beforeEach } from "vitest";
import { asLeadId, asPhone, asUserId, type OrgId } from "@mallet/shared/types";
import type { JobKind } from "../../../jobs/domain/job";
import type { ToolInvocationLedger } from "../../domain/call-record";
import { RunToolCallsUseCase } from "../run-tool-calls";
import {
  bookVisitTool,
  BOOK_VISIT_INVALID_PHONE_SPEAK,
  BOOK_VISIT_ERROR_SPEAK,
} from "./book-visit";
import { BOOKING_CONFIRMATION_KIND, confirmationSms } from "./booking-confirmation";
import {
  buildHarness,
  settingsFrom,
  onlyJob,
  REPAIR_INPUT,
  ORG,
  LEAD_UUID,
  FIRST_CREW_UUID,
  SECOND_CREW_UUID,
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
        "slot_start",
      ].sort(),
    );
    expect(params.required).not.toContain("urgency");
    expect(params.required).not.toContain("slot_window");
    expect(Object.keys(params.properties).sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "service_name",
        "slot_date",
        "slot_start",
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

    // a visit seeded on the job: correct date, scheduledStart = the chosen slot_start (08:00),
    // duration from visitRepairMinutes (90m = 1.5h)
    const visit = job.props.visits[0]!;
    expect(visit).toBeDefined();
    expect(visit.props.scheduledDate).toBe("2026-07-16");
    expect(visit.props.scheduledStart).toBe("08:00");
    expect(visit.props.durationMinutes).toBe(90);

    // price provenance: the service fee, credited phrasing on
    expect(result.speak).toContain("$89");
    expect(result.speak).toContain("credited toward the repair");
    // confirmation quotes the DISCRETE start time booked (day + start), not a range
    expect(result.speak).toContain("Someone will arrive Thursday at 8am.");
    expect(result.speak).not.toContain("between"); // no range phrasing in the spoken line
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
    // safe fallback: states EXACTLY the configured service fee ($89) and NO other dollar token —
    // not the 99 flat price, not any invented value. Thousands-commas only between digit groups so
    // a trailing sentence comma is never captured.
    const spokenTokens = result.speak.match(/\$\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
    expect(spokenTokens).toEqual(["$89"]);
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("flat: redacts a stray price the model smuggles into service_name (only the config $price is spoken)", async () => {
    // A configured flat service whose NAME (raw model text may echo it) carries a stray "$20" —
    // e.g. an owner named it "Drain ($20 coupon)". The sanctioned config price is 99; the spoken
    // line must state ONLY $99 and never leak the $20 from the model-supplied name.
    const withCouponName = settingsFrom({
      booking: {
        services: [{ name: "Drain ($20 coupon)", lane: "flat", price: 99, triggers: "clogged" }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withCouponName });
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "flat", service_name: "Drain ($20 coupon)" },
      h2.ctx,
    );
    // only the configured $99 is spoken — the $20 in the model-supplied name is stripped
    const spokenTokens = result.speak.match(/\$\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
    expect(spokenTokens).toEqual(["$99"]);
    expect(result.speak).not.toContain("$20");
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("books at the EXACT chosen slot_start (an afternoon window), never a window default", async () => {
    // "14:00" is in-hours (wd 8–17) → scheduledStart is exactly 14:00, and the confirmation quotes
    // the 2–4pm arrival window.
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_start: "14:00" }, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.scheduledStart).toBe("14:00");
    expect(result.speak).toContain("Someone will arrive Thursday at 2pm.");
    expect(result.speak).toContain("$89");
  });

  it("honours a specific requested time inside hours (books that exact start)", async () => {
    // The caller said "today at 2" → the model passes the offered window's start 14:00. We book it.
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_start: "14:00" }, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.scheduledStart).toBe("14:00");
    void result;
  });

  // ── auto-place on the board: assign the booking to the first field crew ──
  it("assigns the visit to the FIRST field crew so it lands on the board", async () => {
    const h2 = buildHarness({
      fieldCrewIds: [asUserId(FIRST_CREW_UUID), asUserId(SECOND_CREW_UUID)],
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // assigned to the first crew in the reader's stable order — so it renders on the crew grid.
    const visit = onlyJob(h2).props.visits[0]!;
    expect(visit.props.assigneeUserId).toBe(asUserId(FIRST_CREW_UUID));
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("leaves the visit UNASSIGNED (null) when the org has zero field crew", async () => {
    // default harness → no field crew; the booking stays in "To schedule" for the office to place.
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.assigneeUserId).toBeNull();
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("degrades to UNASSIGNED (never fails the booking) when the crew read throws", async () => {
    const h2 = buildHarness({ fieldCrewThrows: true });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // the booking STILL succeeds; the visit is just unassigned (office places it).
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBeNull();
  });

  it("books at a Saturday slot_start when Saturday hours admit it", async () => {
    const satHours = settingsFrom({ hoursSatOpen: 9, hoursSatClose: 15 });
    const h2 = buildHarness({ settings: satHours });
    // 2026-07-18 is a Saturday; 09:00 is Saturday's open hour and in [9,15).
    await bookVisitTool.handle(
      { ...REPAIR_INPUT, slot_date: "2026-07-18", slot_start: "09:00" },
      h2.ctx,
    );
    expect(onlyJob(h2).props.visits[0]!.props.scheduledStart).toBe("09:00");
  });

  it("out-of-hours slot_start (before open): falls back, never books a garbage time", async () => {
    // 06:00 is before the weekday 8:00 open → a hallucinated time. Degrade to the fallback + task.
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_start: "06:00" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.leads.ensured).toHaveLength(0);
    expect(h.tasks.created.length).toBeGreaterThanOrEqual(1);
  });

  it("out-of-hours slot_start (at/after close): falls back, never books", async () => {
    // 17:00 == weekday close (8–17) → [open, close) excludes it. Fallback, no booking.
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_start: "17:00" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h.jobs.jobs.size).toBe(0);
  });

  it("malformed slot_start ('later'): falls back, never books", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_start: "later" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.sms.sent).toHaveLength(0);
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
    // the same slot phrase book_visit speaks: day + the discrete start time ("Thursday at 8am")
    expect(cmd.body).toContain("Thursday at 8am");
    // the body matches the pure builder exactly (no drift between helper + send)
    expect(cmd.body).toBe(confirmationSms("My Business", "Thursday at 8am"));
  });

  it("routes the confirmation through SendNotificationUseCase → writes an observable notifications row", async () => {
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);

    const jobId = onlyJob(h).props.id;
    // The B3 requirement: the send goes THROUGH the use-case, which persists a notifications row
    // (observable while A2P is blocked). One row, matching the confirmation kind + idempotency key.
    const rows = [...h.sms.rows.values()];
    expect(rows).toHaveLength(1);
    const row = rows[0]!.props;
    expect(row.kind).toBe(BOOKING_CONFIRMATION_KIND);
    expect(row.idempotencyKey).toBe(`booking-confirm-${jobId}`);
    expect(row.orgId).toBe(ORG);
    // ok sender → the row is marked sent (the observable happy path).
    expect(row.status).toBe("sent");
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

  it("SMS send returns err: booking STILL succeeds and the row records the degraded send (no fail)", async () => {
    const h2 = buildHarness({ smsMode: "err" });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // the confirmation speak is unchanged — the booking succeeded
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
    expect(result.speak).toContain("$89");
    expect(h2.jobs.jobs.size).toBe(1);
    expect(h2.sms.sent).toHaveLength(1); // attempted once
    // the use-case still wrote an observable row, marked failed (degraded, not fatal)
    const rows = [...h2.sms.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.props.status).toBe("failed");
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

  // ── runner replay: a Vapi tool retry must NOT re-run book_visit (no second SMS send) ──
  it("a replayed book_visit toolCallId returns the cached result and sends NO second SMS", async () => {
    const CALL_ID = "vapi-call-1";
    const TOOL_CALL_ID = "tc-book-1";

    // A ledger already holding a stored result for this toolCallId (the first, real invocation).
    const seeded: ToolInvocationLedger = {
      async find(toolCallId: string) {
        return toolCallId === TOOL_CALL_ID
          ? { result: { speak: "You're booked Thursday morning.", data: { kind: "work" } } }
          : null;
      },
      async save() {},
      async listByCall() {
        return [];
      },
    };

    // Run the REAL bookVisitTool through the runner against the seeded ledger. A replay hit must
    // return the stored result WITHOUT invoking handle — so no lead/job is created and, critically,
    // the notification use-case fires 0 additional times (no duplicate confirmation SMS).
    const runner = new RunToolCallsUseCase([bookVisitTool], seeded, () => h.ctx.deps);
    const out = await runner.exec({
      vapiCallId: CALL_ID,
      toolCalls: [{ id: TOOL_CALL_ID, name: "book_visit", arguments: REPAIR_INPUT }],
      ctx: { tx: {} as never, orgId: ORG as OrgId, principal: h.ctx.principal },
    });

    expect(JSON.parse(out.results[0]!.result)).toEqual({
      speak: "You're booked Thursday morning.",
      data: { kind: "work" },
    });
    // handle never ran → nothing booked, nothing sent.
    expect(h.leads.ensured).toHaveLength(0);
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.sms.sent).toHaveLength(0);
    expect([...h.sms.rows.values()]).toHaveLength(0);
  });
});
