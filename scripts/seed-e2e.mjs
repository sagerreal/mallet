// Seed the E2E org + users. Requires .env.local (service role + DATABASE_URL).
//   node --env-file=.env.local scripts/seed-e2e.mjs
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "e2e-password-1";
const USERS = [
  { email: "owner@e2e.mallet.test", role: "owner" },
  { email: "tech@e2e.mallet.test", role: "tech" },
];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

const ensureAuthUser = async (email) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return created.user.id;
};

try {
  let [org] = await sql`select id from orgs where name = 'E2E Plumbing'`;
  if (!org) [org] = await sql`insert into orgs (name) values ('E2E Plumbing') returning id`;

  for (const u of USERS) {
    const authUserId = await ensureAuthUser(u.email);
    await sql`insert into users (org_id, auth_user_id, email, role)
      values (${org.id}, ${authUserId}, ${u.email}, ${u.role})
      on conflict (auth_user_id) do nothing`;
  }

  const [karen] = await sql`select id from leads where org_id = ${org.id} and name = 'E2E Karen'`;
  if (!karen) await sql`insert into leads (org_id, name, phone_e164) values (${org.id}, 'E2E Karen', '+15550100001')`;

  console.log(`seeded org ${org.id} with ${USERS.length} users`);
} finally {
  await sql.end({ timeout: 5 });
}
