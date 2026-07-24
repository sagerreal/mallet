import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, systemClock, type OrgId } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { EnsureCustomerUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { CreateTaskUseCase, DrizzleTaskRepository } from "@mallet/tasks";
import { CreateManualJobUseCase, CreateVisitUseCase, DrizzleJobRepository } from "@mallet/jobs";
import {
  LoggingNotificationSender,
  SendNotificationUseCase,
  DrizzleNotificationRepository,
} from "@mallet/notifications";
import { bookVisitTool } from "./book-visit";
import { inertGeocoder } from "./test-support";
import { DrizzleSettingsReader } from "../../infra/drizzle-settings-reader";
import { DrizzleAvailabilityReader } from "../../infra/drizzle-availability-reader";
import { DrizzleToolInvocationLedger } from "../../infra/drizzle-tool-ledger";
import { RunToolCallsUseCase } from "../run-tool-calls";
import { voicePrincipal } from "../voice-principal";
import type { VoiceToolContext, VoiceToolDeps } from "./tool-result";

// Live RLS integration for book_visit. Proves an end-to-end booking creates a lead + job (correct
// kind) + a seeded visit, all org-scoped under RLS, and that a replay of the SAME Vapi toolCallId
// through the runner returns the stored result and never double-books. Skipped without DB.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// A repair booking on a Thursday (weekday); slot_start 08:00 is in the default 8–17 weekday hours.
const REPAIR_INPUT = {
  caller_name: "Int Booking Caller",
  phone: "(925) 555-0143",
  address: "9 Test Ln, Pleasanton",
  service_name: "Leaky faucet",
  lane: "repair" as const,
  problem: "kitchen faucet dripping",
  slot_date: "2026-08-13", // Thursday
  slot_start: "08:00" as const,
  urgency: "normal" as const,
};

// Build the real per-call voice tool deps from a tenant tx (mirrors the route's buildVoiceToolDeps).
const buildDeps = (tx: TenantTx, org: OrgId): VoiceToolDeps => {
  const bus = new OutboxEventBus(tx, org);
  const jobs = new DrizzleJobRepository(tx, org);
  return {
    ensureCustomer: new EnsureCustomerUseCase(new DrizzleLeadRepository(tx, org), bus, systemClock),
    createManualJob: new CreateManualJobUseCase(jobs, bus, systemClock, uuidGenerator),
    createVisit: new CreateVisitUseCase(jobs, systemClock, uuidGenerator),
    createTask: new CreateTaskUseCase(new DrizzleTaskRepository(tx, org), systemClock, uuidGenerator),
    settings: new DrizzleSettingsReader(tx, org),
    availability: new DrizzleAvailabilityReader(tx, org),
    // Inert geocoder keeps the RLS test hermetic (no live Census HTTP): the lazily-created default
    // settings row has a NULL origin, so the service-area check is "unknown" → books normally anyway.
    geocoder: inertGeocoder(),
    // The confirmation SMS is routed through the real SendNotificationUseCase (writes an observable
    // notifications row) with the logging stub as the channel (comms channel unconfigured in this
    // test) — never fails the booking. This test targets job/visit RLS, not the A2P gate (that's
    // covered by notification-router.int.test.ts's dedicated A2P-inactive org), so the gate itself
    // is hardcoded active here rather than reading a real a2p_registrations row.
    sendNotification: new SendNotificationUseCase(
      new DrizzleNotificationRepository(tx, org),
      new LoggingNotificationSender(systemClock),
      bus,
      systemClock,
      uuidGenerator,
    ),
    isSmsA2pActive: async () => true,
    bus,
    clock: systemClock,
    ids: uuidGenerator,
  };
};

suite("book_visit against live Supabase RLS", () => {
  let admin: Sql;
  let orgId = "";
  let firstCrewId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('BookVisit ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    // Two field-crew members so book_visit auto-assigns the booking to the FIRST (oldest) crew and
    // it lands on the board. The office member must NOT be picked (not field crew).
    const [crew1] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew1@bookvisit.ex', 'tech', true) returning id`;
    firstCrewId = crew1!.id;
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew2@bookvisit.ex', 'tech', true)`;
    await admin`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'office@bookvisit.ex', 'office', false)`;
  });

  afterAll(async () => {
    if (orgId) {
      // FKs have no ON DELETE CASCADE — clear children first, in dependency order.
      await admin`delete from frontdesk_tool_invocations where org_id = ${orgId}`;
      await admin`delete from notifications where org_id = ${orgId}`;
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from jobs where org_id = ${orgId}`;
      await admin`delete from tasks where org_id = ${orgId}`;
      await admin`delete from leads where org_id = ${orgId}`;
      await admin`delete from users where org_id = ${orgId}`;
      await admin`delete from org_settings where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("books a work-kind job + seeded visit and states the service fee, visible under RLS", async () => {
    const org = asOrgId(orgId);
    const result = await withTenant(org, async (tx) => {
      const ctx: VoiceToolContext = {
        tx,
        orgId: org,
        principal: voicePrincipal(org),
        deps: buildDeps(tx, org),
      };
      return bookVisitTool.handle(REPAIR_INPUT, ctx);
    });

    // The default settings row (lazily created) has serviceFee 89 + feeCredited true.
    expect(result.speak).toContain("$89");
    expect(result.data).toMatchObject({ kind: "work", emergency: false });

    // The lead, work job, and seeded morning (08:00) visit all persisted for this org.
    const leads = await admin<{ id: string; source: string }[]>`
      select id, source from leads where org_id = ${orgId}`;
    expect(leads).toHaveLength(1);
    expect(leads[0]!.source).toBe("AI Front Desk");

    const jobs = await admin<{ id: string; kind: string; svc: string }[]>`
      select id, kind, svc from jobs where org_id = ${orgId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("work");
    expect(jobs[0]!.svc).toBe("Leaky faucet");

    // Cast date/time to text so the driver returns the raw stored strings (a bare `date` column
    // comes back as a local-tz Date object otherwise, which misrenders the calendar day).
    const visits = await admin<{
      d: string;
      s: string;
      duration_minutes: number;
      assignee_user_id: string | null;
    }[]>`
      select scheduled_date::text as d, scheduled_start::text as s, duration_minutes, assignee_user_id
      from job_visits where org_id = ${orgId}`;
    expect(visits).toHaveLength(1);
    expect(visits[0]!.d).toBe("2026-08-13"); // the slot_date, unshifted
    expect(visits[0]!.s.slice(0, 5)).toBe("08:00"); // scheduledStart == the chosen in-hours slot_start
    expect(visits[0]!.duration_minutes).toBe(90); // default visitRepairMinutes
    // AUTO-PLACED ON THE BOARD: assigned to the first field crew (not unassigned, not the office).
    expect(visits[0]!.assignee_user_id).toBe(firstCrewId);
  });

  it("replaying the SAME toolCallId through the runner does not double-book", async () => {
    const org = asOrgId(orgId);
    const vapiCallId = `vc-${crypto.randomUUID()}`;
    const toolCallId = `tc-${crypto.randomUUID()}`;
    // A distinct phone so this booking is its own lead (no dedupe with the first test's lead).
    const call = {
      id: toolCallId,
      name: "book_visit",
      arguments: { ...REPAIR_INPUT, phone: "(925) 555-0188", caller_name: "Replay Caller" },
    };

    const runOnce = () =>
      withTenant(org, async (tx) => {
        const ledger = new DrizzleToolInvocationLedger(tx, org);
        const runner = new RunToolCallsUseCase([bookVisitTool], ledger, () => buildDeps(tx, org));
        return runner.exec({
          vapiCallId,
          toolCalls: [call],
          ctx: { tx, orgId: org, principal: voicePrincipal(org) },
        });
      });

    const first = await runOnce();
    const second = await runOnce(); // Vapi retry — must hit the ledger, not re-book.

    // Identical spoken result both times.
    expect(second.results[0]!.result).toBe(first.results[0]!.result);

    // Exactly one NEW job for the replay caller (the first test booked a different caller).
    const replayJobs = await admin<{ id: string }[]>`
      select j.id from jobs j
      join leads l on l.id = j.lead_id
      where j.org_id = ${orgId} and l.name = 'Replay Caller'`;
    expect(replayJobs).toHaveLength(1);
  });
});
