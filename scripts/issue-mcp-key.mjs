// Issue a per-tenant MCP API key. The raw key is printed ONCE and never stored (only its SHA-256
// hash goes in api_keys). Usage:
//   node --env-file=.env.local scripts/issue-mcp-key.mjs <orgId> [role=office] [label=mcp]
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";

const orgId = process.argv[2];
const role = process.argv[3] ?? "office";
const label = process.argv[4] ?? "mcp";
if (!orgId) {
  console.error("usage: node --env-file=.env.local scripts/issue-mcp-key.mjs <orgId> [role] [label]");
  process.exit(1);
}

const raw = `mallet_sk_${randomBytes(24).toString("hex")}`;
const hash = createHash("sha256").update(raw).digest("hex");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
try {
  const [row] = await sql`
    insert into api_keys (org_id, hashed_key, role, label)
    values (${orgId}, ${hash}, ${role}, ${label}) returning id`;
  console.log("Issued MCP key — store it now, it is NOT recoverable:\n");
  console.log(`  ${raw}\n`);
  console.log(`api_key id: ${row.id}  org: ${orgId}  role: ${role}  label: ${label}`);
  console.log("\nUse as: Authorization: Bearer <the key above>  →  POST /mcp");
} catch (e) {
  console.error("failed to issue key:", e.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
