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
    expect(params.required).not.toContain("scope_signal");
    expect(Object.keys(params.properties).sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "scope_signal",
        "service_name",
        "slot_date",
        "slot_start",
        "urgency",
      ].sort(),
    );
  });

  /**
   * The old "repair" lane — the service call — IS an estimate visit under the two-type model:
   * someone goes to look, prices it at the door, and probably fixes it same trip. It books
   * kind='estimate' now (it used to book kind='work', which is how a voice-booked service call
   * rendered as priced work it never was). The fee speech and the repair-length visit stay.
   */
  it("legacy repair lane: books an ESTIMATE-kind fee visit and states the visit fee (credited)", async () => {
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);

    // lead ensured with the AI source + problem as notes + parsed phone
    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.notes).toBe("kitchen faucet dripping");
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));

    // an estimate-kind job with the service name + notes — the trade label stays the SPOKEN name
    const job = onlyJob(h);
    expect(job.props.kind).toBe<JobKind>("estimate");
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
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
  });

  it("legacy repair lane: omits the credited phrase when feeCredited is off", async () => {
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

  // ── proximity dispatch: least-loaded + proximity crew assignment ──

  it("assigns to the emptier crew (B has 0 jobs, A has 1) regardless of order", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);
    const crewB = asUserId(SECOND_CREW_UUID);
    const h2 = buildHarness({
      sameDayCrewLoads: [
        { userId: crewA, skillTags: [], sameDayJobs: [{ point: null }] }, // 1 job
        { userId: crewB, skillTags: [], sameDayJobs: [] },                // 0 jobs → should win
      ],
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    const visit = onlyJob(h2).props.visits[0]!;
    expect(visit.props.assigneeUserId).toBe(crewB);
    expect(result.data).toMatchObject({ kind: "estimate" });
  });

  it("proximity tie-break: nearer crew wins (crew A nearer jobPoint)", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);
    const crewB = asUserId(SECOND_CREW_UUID);
    // jobPoint at (37.6, -122.0). Use origin = same as jobPoint + very large radius so the check
    // is "in" and area.point = the geocoded point. Both crews have 1 job (load tie) → proximity.
    // crewA's job is 0.01° latitude away (~0.7 mi); crewB's is 1° away (~69 mi).
    const origin = { lat: 37.6, lng: -122.0 };
    const jobPt  = { lat: 37.6, lng: -122.0 };
    const h2 = buildHarness({
      settings: settingsFrom({ originLat: origin.lat, originLng: origin.lng, areaRadiusMi: 500 }),
      geocoder: { async geocode() { return jobPt; } },
      sameDayCrewLoads: [
        { userId: crewA, skillTags: [], sameDayJobs: [{ point: { lat: 37.61, lng: -122.0 } }] }, // ~0.7 mi
        { userId: crewB, skillTags: [], sameDayJobs: [{ point: { lat: 38.6,  lng: -122.0 } }] }, // ~69 mi
      ],
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBe(crewA);
    expect(result.data).toMatchObject({ kind: "estimate" });
  });

  it("proximity tie-break: flip nearer crew → assigns the other (proves distance, not order)", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);
    const crewB = asUserId(SECOND_CREW_UUID);
    const origin = { lat: 37.6, lng: -122.0 };
    const jobPt  = { lat: 37.6, lng: -122.0 };
    // crewB is now nearer, crewA is far — same settings, different crew-point positions.
    const h2 = buildHarness({
      settings: settingsFrom({ originLat: origin.lat, originLng: origin.lng, areaRadiusMi: 500 }),
      geocoder: { async geocode() { return jobPt; } },
      sameDayCrewLoads: [
        { userId: crewA, skillTags: [], sameDayJobs: [{ point: { lat: 38.6,  lng: -122.0 } }] }, // ~69 mi — far
        { userId: crewB, skillTags: [], sameDayJobs: [{ point: { lat: 37.61, lng: -122.0 } }] }, // ~0.7 mi — near
      ],
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBe(crewB);
    expect(result.data).toMatchObject({ kind: "estimate" });
  });

  it("persists the geocoded point on the created visit when area.point is non-null", async () => {
    // To get a non-null area.point we need origin+radius set AND the geocoder to return a point
    // that is within the radius. Use originLat/Lng = jobPt and areaRadiusMi = 1 → always "in".
    const jobPt = { lat: 37.7749, lng: -122.4194 };
    const h2 = buildHarness({
      settings: settingsFrom({ originLat: jobPt.lat, originLng: jobPt.lng, areaRadiusMi: 1 }),
      geocoder: { async geocode() { return jobPt; } },
      sameDayCrewLoads: [],
    });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    const visit = onlyJob(h2).props.visits[0]!;
    expect(visit.props.lat).toBeCloseTo(37.7749);
    expect(visit.props.lng).toBeCloseTo(-122.4194);
  });

  it("leaves the visit UNASSIGNED (null) when the org has zero field crew", async () => {
    // default harness → no sameDayCrewLoads → chooseCrew([], ...) → null → UNASSIGNED.
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.assigneeUserId).toBeNull();
    expect(result.data).toMatchObject({ kind: "estimate" });
  });

  it("degrades to UNASSIGNED (never fails the booking) when readSameDayCrewLoads throws", async () => {
    const h2 = buildHarness({ sameDayLoadsThrows: true });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // the booking STILL succeeds; the visit is just unassigned (office places it).
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBeNull();
  });

  it("empty crew loads → UNASSIGNED (same zero-crew behaviour via chooseCrew)", async () => {
    const h2 = buildHarness({ sameDayCrewLoads: [] });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
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
    expect(result.data).toMatchObject({ emergency: true, kind: "estimate" });
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
    // The B3 requirement: the send goes THROUGH the use-case, which persists a notifications row —
    // observable, regardless of provider config. One row, matching the confirmation kind + idempotency key.
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
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
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
    expect(result.data).toMatchObject({ kind: "estimate" });
    expect(result.speak).toContain("$89");
    expect(h2.jobs.jobs.size).toBe(1);
  });

  // ── A2P compliance gate (final-review Critical fix) ──────────────────────────────
  // Voice calls are never gated (10DLC governs SMS, not voice), but the one background SMS this
  // tool fires — the booking confirmation — must skip, never send, for an org whose 10DLC campaign
  // isn't active yet. Skip-not-throw: the booking itself must be completely unaffected.

  it("A2P-inactive org: confirmation SMS is SKIPPED — sender/transport never called, no row written — booking still succeeds", async () => {
    const inactive = buildHarness({ smsA2pActive: false });
    const result = await bookVisitTool.handle(REPAIR_INPUT, inactive.ctx);
    // the booking itself is entirely unaffected — same outcome as the A2P-active happy path
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
    expect(result.speak).toContain("$89");
    expect(inactive.jobs.jobs.size).toBe(1);
    // this is a SKIP, not a degraded send: the sender is never invoked and no notifications row
    // is written at all (contrast with the "err"/"throw" sms-mode tests above, which DO write a
    // row because the use-case was actually called).
    expect(inactive.sms.sent).toHaveLength(0);
    expect([...inactive.sms.rows.values()]).toHaveLength(0);
  });

  it("A2P-active org: the gate only blocks inactive orgs — confirmation SMS still sends", async () => {
    const active = buildHarness({ smsA2pActive: true });
    await bookVisitTool.handle(REPAIR_INPUT, active.ctx);
    expect(active.sms.sent).toHaveLength(1);
    expect([...active.sms.rows.values()]).toHaveLength(1);
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

// ── scope_signal capture (task 3b) ────────────────────────────────────────────
// The voice front desk may collect a caller's "anything else you've noticed?" answer and pass it
// to book_visit as scope_signal. The handler decorates it (found-work prefix when keywords hit)
// and persists the result on the job's scope field.

import { decorateScope } from "../found-work";

describe("bookVisitTool — scope_signal capture", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("books successfully when scope_signal is omitted (scope is null on the job)", async () => {
    // scope_signal is optional — a caller with nothing to add must not dead-end.
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
    expect(onlyJob(h).props.scope).toBeNull();
  });

  it("books successfully when scope_signal is explicitly undefined", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, scope_signal: undefined }, h.ctx);
    expect(result.data).toMatchObject({ kind: "estimate" });
    expect(onlyJob(h).props.scope).toBeNull();
  });

  it("persists the trimmed plain note as-is when no found-work keyword hits", async () => {
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, scope_signal: "  just a dripping faucet  " },
      h.ctx,
    );
    expect(result.data).toMatchObject({ kind: "estimate" });
    const job = onlyJob(h);
    expect(job.props.scope).toBe(decorateScope("  just a dripping faucet  "));
    expect(job.props.scope).toBe("just a dripping faucet");
  });

  it("persists the '[likely found-work] ' prefix when the answer trips a found-work keyword", async () => {
    const foundWorkNote = "the water heater is really old";
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, scope_signal: foundWorkNote },
      h.ctx,
    );
    expect(result.data).toMatchObject({ kind: "estimate" });
    const job = onlyJob(h);
    expect(job.props.scope).toBe(decorateScope(foundWorkNote));
    expect(job.props.scope).toBe("[likely found-work] the water heater is really old");
  });

  it("persists the '[likely found-work] ' prefix for 'rusty pipes'", async () => {
    await bookVisitTool.handle({ ...REPAIR_INPUT, scope_signal: "rusty pipes" }, h.ctx);
    expect(onlyJob(h).props.scope).toBe("[likely found-work] rusty pipes");
  });

  it("persists the '[likely found-work] ' prefix for 'some water damage under the sink'", async () => {
    await bookVisitTool.handle(
      { ...REPAIR_INPUT, scope_signal: "some water damage under the sink" },
      h.ctx,
    );
    expect(onlyJob(h).props.scope).toBe(
      "[likely found-work] some water damage under the sink",
    );
  });

  it("scope on the created job equals decorateScope(scope_signal) — parity with the pure helper", async () => {
    const signal = "pipes are rusty and there is some mold";
    await bookVisitTool.handle({ ...REPAIR_INPUT, scope_signal: signal }, h.ctx);
    expect(onlyJob(h).props.scope).toBe(decorateScope(signal));
  });

  // ── skill gate: cert-filtered dispatch ──

  it("gate: a required cert filters unqualified crew — only the qualified tech is assigned", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);   // has the cert
    const crewB = asUserId(SECOND_CREW_UUID);  // lacks it
    const withCertService = settingsFrom({
      booking: {
        services: [{ name: "Leaky faucet", lane: "estimate" as const, feeApplies: true, price: 0, triggers: "", requiredCerts: ["gas"] }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({
      settings: withCertService,
      sameDayCrewLoads: [
        { userId: crewA, skillTags: ["gas"], sameDayJobs: [] },  // qualified
        { userId: crewB, skillTags: [],       sameDayJobs: [] }, // not qualified
      ],
    });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBe(crewA);
  });

  it("gate: the filter runs BEFORE ranking — a qualified-but-loaded tech beats an unqualified idle one", async () => {
    // The discriminating case: crewB (unqualified) is IDLE and listed FIRST, so WITHOUT the gate
    // chooseCrew would pick crewB on both least-loaded AND stable-first. Only the cert filter
    // running before the ranking makes the loaded-but-qualified crewA win.
    const crewA = asUserId(FIRST_CREW_UUID);   // qualified, 1 job today
    const crewB = asUserId(SECOND_CREW_UUID);  // unqualified, idle
    const withCertService = settingsFrom({
      booking: {
        services: [{ name: "Leaky faucet", lane: "estimate" as const, feeApplies: true, price: 0, triggers: "", requiredCerts: ["gas"] }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({
      settings: withCertService,
      sameDayCrewLoads: [
        { userId: crewB, skillTags: [], sameDayJobs: [] },                 // idle, listed first, no cert
        { userId: crewA, skillTags: ["gas"], sameDayJobs: [{ point: null }] }, // loaded, has the cert
      ],
    });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBe(crewA);
  });

  it("gate: nobody qualified → booking succeeds but assignee is null (UNASSIGNED)", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);
    const withCertService = settingsFrom({
      booking: {
        services: [{ name: "Leaky faucet", lane: "estimate" as const, feeApplies: true, price: 0, triggers: "", requiredCerts: ["backflow"] }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({
      settings: withCertService,
      sameDayCrewLoads: [
        { userId: crewA, skillTags: ["gas"], sameDayJobs: [] }, // wrong cert
      ],
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // Booking still succeeds
    expect(result.data).toMatchObject({ kind: "estimate" });
    // But nobody was assigned
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBeNull();
  });

  it("gate: no requirement (service not in playbook) → all crew are candidates (no filtering)", async () => {
    const crewA = asUserId(FIRST_CREW_UUID);
    // Default settings has no services configured matching "Leaky faucet" with certs.
    const h2 = buildHarness({
      sameDayCrewLoads: [
        { userId: crewA, skillTags: [], sameDayJobs: [] },
      ],
    });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    // crewA assigned despite having no tags (no requirement)
    expect(onlyJob(h2).props.visits[0]!.props.assigneeUserId).toBe(crewA);
  });

  it("gate: booked job persists the resolved requiredCerts", async () => {
    const withCertService = settingsFrom({
      booking: {
        services: [{ name: "Leaky faucet", lane: "estimate" as const, feeApplies: true, price: 0, triggers: "", requiredCerts: ["gas"] }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withCertService });
    await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(onlyJob(h2).props.requiredCerts).toEqual(["gas"]);
  });

  it("gate: service not in playbook → booked job has null requiredCerts", async () => {
    // Default settings has no services with certs
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(onlyJob(h).props.requiredCerts).toBeNull();
  });
});
