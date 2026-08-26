import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { Phone, asOrgId, asLeadId, toPage, isOk } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleLeadRepository } from "./drizzle-lead-repository";

// Live RLS integration: the app (mallet_app, NOBYPASSRLS) goes through the real DrizzleLead
// repository inside withTenant, against the real Supabase DB. Proves idempotency, keyset
// paging, and — most importantly — that one tenant physically cannot read another's rows.
// Skipped when DB credentials are absent (e.g. CI without secrets), where Testcontainers runs.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleLeadRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let foreignLeadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('IntTest A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('IntTest B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, phone_e164)
      values (${orgBId}, 'Foreign Bob', '+15550000000') returning id`;
    foreignLeadId = lead!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // A distinct number per run — these rows persist between runs against the shared DB.
  const freshPhone = () => {
    const parsed = Phone.parse(`617${Math.floor(1000000 + Math.random() * 8999999)}`);
    if (!isOk(parsed)) throw new Error("fixture phone rejected");
    return parsed.value;
  };

  /**
   * findByPhone exists so the update path can NAME the customer already holding a number, instead
   * of letting `leads_org_phone_uidx` raise a bare constraint violation that the user reads as
   * "check your connection".
   */
  // Inserted into org B on purpose: the idempotency test below counts EVERY lead in org A and
  // expects exactly one, so a stray row here would fail a test that has nothing to do with this.
  it("findByPhone finds the live customer holding a number", async () => {
    const orgB = asOrgId(orgBId);
    const phone = freshPhone();
    const found = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgB);
      await repo.ensureCustomer({ name: "Holder", phone, email: null, source: null, companyId: null, role: null, notes: null, address: null });
      return repo.findByPhone(phone);
    });
    expect(found?.props.name).toBe("Holder");
  });

  it("findByPhone returns nothing for a number nobody has", async () => {
    const orgA = asOrgId(orgAId);
    const found = await withTenant(orgA, (tx) =>
      new DrizzleLeadRepository(tx, orgA).findByPhone(freshPhone()),
    );
    expect(found).toBeNull();
  });

  /**
   * The one that matters. This result is rendered straight back as "X already has that number", so
   * a leak here would print ANOTHER SHOP'S CUSTOMER NAME into this shop's UI.
   */
  it("findByPhone will not see another org's customer", async () => {
    const phone = freshPhone();
    await withTenant(asOrgId(orgBId), (tx) =>
      new DrizzleLeadRepository(tx, asOrgId(orgBId)).ensureCustomer({
        name: "Other Shop Customer", phone, email: null, source: null, companyId: null, role: null, notes: null, address: null,
      }),
    );
    const found = await withTenant(asOrgId(orgAId), (tx) =>
      new DrizzleLeadRepository(tx, asOrgId(orgAId)).findByPhone(phone),
    );
    expect(found).toBeNull();
  });

  it("ensureCustomer is idempotent on phone (one row; second call is not 'created')", async () => {
    const parsed = Phone.parse("555-111-2222");
    expect(isOk(parsed)).toBe(true);
    const phone = isOk(parsed) ? parsed.value : null;
    const orgA = asOrgId(orgAId);

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const first = await repo.ensureCustomer({ name: "Alice", phone, email: null, source: "web", companyId: null, role: null, notes: null, address: null });
      const second = await repo.ensureCustomer({
        name: "Alice (again)",
        phone,
        email: null,
        source: "phone",
        companyId: null,
        role: null,
        notes: null,
        address: null,
      });
      const listed = await repo.list(toPage({ limit: 100 }));
      return { first, second, count: listed.items.length };
    });

    expect(result.first.created).toBe(true);
    expect(result.second.created).toBe(false);
    expect(result.first.lead.props.id).toBe(result.second.lead.props.id);
    expect(result.count).toBe(1);
  });

  it("cannot read another org's lead — by id or in a list", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const byId = await repo.findById(asLeadId(foreignLeadId));
      const all = await repo.list(toPage({ limit: 100 }));
      return { byId, names: all.items.map((l) => l.props.name) };
    });

    expect(result.byId).toBeNull();
    expect(result.names).not.toContain("Foreign Bob");
  });

  it("cannot insert a lead stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        // Construct the repo with org B's id while the tx is scoped to org A — the insert's
        // org_id won't match current_org_id(), so the WITH CHECK policy must reject it.
        const repo = new DrizzleLeadRepository(tx, asOrgId(orgBId));
        await repo.ensureCustomer({ name: "Mallory", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TAGS. Two things only the real database can answer: that a text[] column round-trips
  // through the mapper as a list, and that the tag search clause is valid SQL. The search is
  // hand-written `sql` (array_to_string over the column) rather than a drizzle operator, and a
  // rendering mistake there throws at query time — the exact shape of bug a screenshot hides,
  // because the list just comes back empty.
  // -------------------------------------------------------------------------

  it("stores and reads back a tag set", async () => {
    const orgA = asOrgId(orgAId);
    const lead = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const { lead } = await repo.ensureCustomer({
        name: "Tagged Tina", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null,
        tags: ["Google", "Repeat customer"],
      });
      return repo.findById(lead.props.id);
    });
    expect(lead?.props.tags).toEqual(["Google", "Repeat customer"]);
  });

  it("normalises on the way in — blanks dropped, case-duplicates collapsed", async () => {
    const orgA = asOrgId(orgAId);
    const lead = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const { lead } = await repo.ensureCustomer({
        name: "Messy Marvin", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null,
        tags: ["Google", "  ", "google", " Referral "],
      });
      return repo.findById(lead.props.id);
    });
    expect(lead?.props.tags).toEqual(["Google", "Referral"]);
  });

  it("an untagged customer reads back an empty list, never null", async () => {
    const orgA = asOrgId(orgAId);
    const lead = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const { lead } = await repo.ensureCustomer({
        name: "Plain Pat", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null,
      });
      return repo.findById(lead.props.id);
    });
    expect(lead?.props.tags).toEqual([]);
  });

  it("finds a customer by a tag — the search clause is real SQL", async () => {
    const orgA = asOrgId(orgAId);
    const marker = `Zzt${Math.floor(100000 + Math.random() * 899999)}`;
    const names = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      await repo.ensureCustomer({
        name: "Searchable Sam", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null, tags: [marker],
      });
      const page = await repo.list(toPage({ limit: 50 }), { search: marker });
      return page.items.map((l) => l.props.name);
    });
    expect(names).toContain("Searchable Sam");
  });

  /**
   * The separator matters. Joined on a SPACE, tags {"Yard","Sign"} would answer a search for
   * "yard sign" — a match that exists only because two unrelated labels sit next to each other in
   * an array. The join uses a newline, which the search box cannot produce.
   */
  it("does not match ACROSS two adjacent tags", async () => {
    const orgA = asOrgId(orgAId);
    const a = `Aaa${Math.floor(100000 + Math.random() * 899999)}`;
    const b = `Bbb${Math.floor(100000 + Math.random() * 899999)}`;
    const names = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      await repo.ensureCustomer({
        name: "Adjacent Ann", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null, tags: [a, b],
      });
      const page = await repo.list(toPage({ limit: 50 }), { search: `${a} ${b}` });
      return page.items.map((l) => l.props.name);
    });
    expect(names).not.toContain("Adjacent Ann");
  });

  it("a tag search cannot reach another org's customer", async () => {
    const marker = `Xtn${Math.floor(100000 + Math.random() * 899999)}`;
    await withTenant(asOrgId(orgBId), (tx) =>
      new DrizzleLeadRepository(tx, asOrgId(orgBId)).ensureCustomer({
        name: "Other Shop Tagged", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null, tags: [marker],
      }),
    );
    const orgA = asOrgId(orgAId);
    const names = await withTenant(orgA, async (tx) => {
      const page = await new DrizzleLeadRepository(tx, orgA).list(toPage({ limit: 50 }), { search: marker });
      return page.items.map((l) => l.props.name);
    });
    expect(names).not.toContain("Other Shop Tagged");
  });

  it("save() replaces the whole set, so a tag can be removed", async () => {
    const orgA = asOrgId(orgAId);
    const tags = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleLeadRepository(tx, orgA);
      const { lead } = await repo.ensureCustomer({
        name: "Retag Rita", phone: freshPhone(), email: null, source: null,
        companyId: null, role: null, notes: null, address: null,
        tags: ["Google", "Referral"],
      });
      const patched = lead.patch({ tags: ["Referral"] }, new Date());
      if (!isOk(patched)) throw new Error("patch rejected");
      await repo.save(patched.value);
      const reread = await repo.findById(lead.props.id);
      return reread?.props.tags;
    });
    expect(tags).toEqual(["Referral"]);
  });
});
