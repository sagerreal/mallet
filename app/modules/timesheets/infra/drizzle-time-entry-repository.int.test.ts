import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId, asTimeEntryId, toPage } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleTimeEntryRepository } from "./drizzle-time-entry-repository";

// Live RLS integration: the app role (NOBYPASSRLS) goes through the real
// DrizzleTimeEntryRepository inside withTenant against the real Supabase DB.
// Proves keyset paging, soft-delete, bulk approve, and cross-tenant isolation.
// Skipped when DB credentials are absent.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleTimeEntryRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let techAUserId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TERepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TERepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    // Create a tech user in org A (auth_user_id is arbitrary for these tests).
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'tech@a.test', 'tech', true) returning id`;
    techAUserId = u!.id;
  });

  // A fresh technician, so the one-running-entry-per-tech tests below cannot collide with each
  // other: each committed running row occupies its owner's single clock slot for the whole suite.
  const newTech = async (orgId: string, email: string): Promise<string> => {
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), ${email}, 'tech', true) returning id`;
    return u!.id;
  };

  const runningEntry = (orgId: string, techUserId: string, startTime: string) => ({
    id: crypto.randomUUID(),
    orgId,
    techUserId,
    jobId: null,
    workDate: "2026-07-24",
    kind: "shop",
    startTime,
    endTime: null,
    minutes: null,
    note: "",
    src: "clock",
    status: "draft",
    running: true,
    editedByUserId: null,
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("creates an entry and reads it back", async () => {
    const orgA = asOrgId(orgAId);
    const entry = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      return repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-07",
        kind: "job",
        startTime: "08:00",
        endTime: "12:00",
        minutes: null,
        note: "Morning shift",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
    });
    expect(entry.props.workDate).toBe("2026-07-07");
    expect(entry.props.kind).toBe("job");
    expect(entry.props.status).toBe("draft");
    expect(entry.props.running).toBe(false);
  });

  it("findById returns null for a random id", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      return repo.findById(asTimeEntryId(crypto.randomUUID()));
    });
    expect(result).toBeNull();
  });

  it("save persists changes", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      const created = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-07",
        kind: "job",
        startTime: "13:00",
        endTime: "17:00",
        minutes: null,
        note: "",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
      const patched = created.patch({ note: "Afternoon shift" }, new Date());
      if (!patched.ok) throw new Error("patch failed");
      await repo.save(patched.value);
      return repo.findById(created.props.id);
    });
    expect(result?.props.note).toBe("Afternoon shift");
  });

  it("remove soft-deletes; findById returns null afterwards", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      const created = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-07",
        kind: "break",
        startTime: "10:00",
        endTime: "10:15",
        minutes: null,
        note: "",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
      const count = await repo.remove(created.props.id, new Date());
      const after = await repo.findById(created.props.id);
      return { count, after };
    });
    expect(result.count).toBe(1);
    expect(result.after).toBeNull();
  });

  it("findOpenForTech returns null when the technician has nothing running", async () => {
    const orgA = asOrgId(orgAId);
    const techId = await newTech(orgAId, `idle-${crypto.randomUUID()}@a.test`);

    const open = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      // A finished entry must not read as an open clock.
      await repo.create({
        ...runningEntry(orgAId, techId, "08:00"),
        endTime: "12:00",
        running: false,
        editedByUserId: null,
      });
      return repo.findOpenForTech(asUserId(techId));
    });

    expect(open).toBeNull();
  });

  it("findOpenForTech returns the running entry, not the finished ones", async () => {
    const orgA = asOrgId(orgAId);
    const techId = await newTech(orgAId, `open-${crypto.randomUUID()}@a.test`);

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      await repo.create({
        ...runningEntry(orgAId, techId, "08:00"),
        endTime: "12:00",
        running: false,
        editedByUserId: null,
      });
      const created = await repo.create(runningEntry(orgAId, techId, "13:00"));
      const open = await repo.findOpenForTech(asUserId(techId));
      return { openId: open?.props.id, runningId: created.props.id, startTime: open?.props.startTime };
    });

    expect(result.openId).toBe(result.runningId);
    expect(result.startTime).toBe("13:00");
  });

  it("findOpenForTech ignores a soft-deleted running entry, so removing one frees the clock", async () => {
    const orgA = asOrgId(orgAId);
    const techId = await newTech(orgAId, `discard-${crypto.randomUUID()}@a.test`);

    const open = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      const created = await repo.create(runningEntry(orgAId, techId, "09:00"));
      await repo.remove(created.props.id, new Date());
      return repo.findOpenForTech(asUserId(techId));
    });

    expect(open).toBeNull();
  });

  it("findOpenForTech does not return another technician's running entry", async () => {
    const orgA = asOrgId(orgAId);
    const clockedIn = await newTech(orgAId, `mate-a-${crypto.randomUUID()}@a.test`);
    const clockedOut = await newTech(orgAId, `mate-b-${crypto.randomUUID()}@a.test`);

    const open = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      await repo.create(runningEntry(orgAId, clockedIn, "07:30"));
      return repo.findOpenForTech(asUserId(clockedOut));
    });

    expect(open).toBeNull();
  });

  it("findOpenForTech cannot see another org's running entry", async () => {
    const techBId = await newTech(orgBId, `foreign-${crypto.randomUUID()}@b.test`);
    await admin`
      insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, note, src, status, running)
      values (${orgBId}, ${techBId}, '2026-07-24', 'shop', '08:00', 'Foreign clock', 'clock', 'draft', true)`;

    const orgA = asOrgId(orgAId);
    const open = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      return repo.findOpenForTech(asUserId(techBId));
    });

    expect(open).toBeNull();
  });

  it("the database refuses a second running entry for the same technician", async () => {
    // The whole capture model rests on this: two open segments would double-count paid hours. It is
    // enforced by a partial unique index, not by application code, so it must be proven live.
    const orgA = asOrgId(orgAId);
    const techId = await newTech(orgAId, `double-${crypto.randomUUID()}@a.test`);

    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleTimeEntryRepository(tx, orgA);
        await repo.create(runningEntry(orgAId, techId, "08:00"));
        await repo.create(runningEntry(orgAId, techId, "09:00"));
      });
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });

  it("approveWeek flips draft→approved for specified dates", async () => {
    const orgA = asOrgId(orgAId);
    const techUser = asUserId(techAUserId);

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      // Create two entries on different dates.
      const e1 = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-01",
        kind: "job",
        startTime: "08:00",
        endTime: "12:00",
        minutes: null,
        note: "",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
      const e2 = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-02",
        kind: "job",
        startTime: "08:00",
        endTime: "12:00",
        minutes: null,
        note: "",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
      const count = await repo.approveWeek(techUser, ["2026-07-01", "2026-07-02"], new Date());
      const after1 = await repo.findById(e1.props.id);
      const after2 = await repo.findById(e2.props.id);
      return { count, status1: after1?.props.status, status2: after2?.props.status };
    });
    expect(result.count).toBe(2);
    expect(result.status1).toBe("approved");
    expect(result.status2).toBe("approved");
  });

  it("approveWeek does not flip already-approved entries again", async () => {
    const orgA = asOrgId(orgAId);
    const techUser = asUserId(techAUserId);

    const count = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        techUserId: techAUserId,
        jobId: null,
        workDate: "2026-07-03",
        kind: "job",
        startTime: "08:00",
        endTime: "12:00",
        minutes: null,
        note: "",
        src: "manual",
        status: "draft",
        running: false,
        editedByUserId: null,
      });
      // Approve once.
      await repo.approveWeek(techUser, ["2026-07-03"], new Date());
      // Approve again — the entry is already approved, so count should be 0.
      return repo.approveWeek(techUser, ["2026-07-03"], new Date());
    });
    expect(count).toBe(0);
  });

  it("cannot read another org's entries — by id or in list", async () => {
    // Admin inserts an entry directly under org B.
    const [row] = await admin<{ id: string }[]>`
      with u as (
        insert into users (org_id, auth_user_id, email, role, is_field_crew)
        values (${orgBId}, gen_random_uuid(), 'techb@b.test', 'tech', true) returning id
      )
      insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, note, src, status, running)
      select ${orgBId}, u.id, '2026-07-07', 'job', '08:00', 'Foreign entry', 'manual', 'draft', false
      from u returning id`;
    const foreignId = row!.id;

    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTimeEntryRepository(tx, orgA);
      const byId = await repo.findById(asTimeEntryId(foreignId));
      const listed = await repo.list({}, toPage({ limit: 100 }));
      return { byId, notes: listed.items.map((e) => e.props.note) };
    });

    expect(result.byId).toBeNull();
    expect(result.notes).not.toContain("Foreign entry");
  });

  it("cannot insert an entry stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleTimeEntryRepository(tx, asOrgId(orgBId));
        await repo.create({
          id: crypto.randomUUID(),
          orgId: orgBId,
          techUserId: techAUserId,
          jobId: null,
          workDate: "2026-07-07",
          kind: "job",
          startTime: "08:00",
          endTime: "12:00",
          minutes: null,
          note: "Mallory",
          src: "manual",
          status: "draft",
          running: false,
          editedByUserId: null,
        });
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
