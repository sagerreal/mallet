import { sql } from "drizzle-orm";
import { db } from "@mallet/shared/db/client";
import { readiness } from "@mallet/shared/observability";

// Readiness probe — can this instance serve traffic? Checks the database is reachable so a load
// balancer can drain the instance while a dependency is down. 503 when not ready.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await readiness(async () => {
    await db.execute(sql`select 1`);
  });
  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
}
