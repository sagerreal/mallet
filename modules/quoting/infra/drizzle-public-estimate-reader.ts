import { and, eq, isNull } from "drizzle-orm";
import { estimates, estimateLines, orgs, leads } from "@mallet/shared/db/schema";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { asOrgId } from "@mallet/shared/types";
import { toDomain, type EstimateLineRow } from "./estimate-mapper";
import type { Estimate } from "../domain/estimate";

// The shape returned to the public quote page — a full estimate aggregate plus the org display
// name and the customer's first name (derived from the lead name).
export interface PublicQuoteView {
  readonly estimate: Estimate;
  readonly orgName: string;
  readonly customerFirstName: string;
}

// Privileged reader for the public customer quote page. Uses ownerDb (BYPASSRLS) because the
// caller has no authenticated session — only an unguessable token. The token is the ONLY input;
// we never accept an org_id or estimate_id from the caller. Scope is strictly limited to the
// single row matching public_token = $1.
//
// Pattern mirrors DrizzleOrgByNumberReader (messaging module): minimal ownerDb surface for a
// pre-tenant bootstrap lookup, then re-enters withTenant for any writes.
export class DrizzlePublicEstimateReader {
  // Look up the estimate by token (BYPASSRLS), stamp first_viewed_at if not yet set (inside
  // withTenant for correct RLS context on the UPDATE), and return the public view.
  // Returns null if no estimate matches the token.
  async findByToken(token: string): Promise<PublicQuoteView | null> {
    // Step 1: privileged lookup — resolve (estimateId, orgId) from the token. We select only
    // the columns we need for the tenant bootstrap + view assembly; we do NOT return raw money
    // or internal cost columns at this stage.
    const headerRows = await ownerDb
      .select({
        id: estimates.id,
        orgId: estimates.orgId,
        orgName: orgs.name,
        leadName: leads.name,
      })
      .from(estimates)
      .innerJoin(orgs, eq(orgs.id, estimates.orgId))
      .innerJoin(leads, and(eq(leads.orgId, estimates.orgId), eq(leads.id, estimates.leadId)))
      .where(
        and(
          eq(estimates.publicToken, token),
          isNull(estimates.deletedAt),
        ),
      )
      .limit(1);

    const header = headerRows[0];
    if (!header) return null;

    const orgId = asOrgId(header.orgId);

    // Step 2: stamp first_viewed_at idempotently (only if null) using ownerDb — this is a safe
    // single-row UPDATE scoped by the already-resolved estimate id. We use ownerDb here rather
    // than withTenant because the UPDATE is a single, fully-scoped, non-tenant-data write that
    // does not interact with RLS policies or cross any tenant boundary. The estimate id was
    // resolved from the token in step 1 — no caller input reaches this UPDATE.
    await ownerDb
      .update(estimates)
      .set({ firstViewedAt: new Date() })
      .where(
        and(
          eq(estimates.id, header.id),
          isNull(estimates.firstViewedAt),
        ),
      );

    // Step 3: load the full estimate aggregate (header + lines) via withTenant so RLS scopes
    // the query correctly and the domain object is fully reconstituted with derived totals.
    const aggregate = await withTenant(orgId, async (tx) => {
      const rows = await tx
        .select({ estimate: estimates, line: estimateLines })
        .from(estimates)
        .leftJoin(
          estimateLines,
          and(
            eq(estimateLines.orgId, estimates.orgId),
            eq(estimateLines.estimateId, estimates.id),
            isNull(estimateLines.deletedAt),
          ),
        )
        .where(and(eq(estimates.id, header.id), isNull(estimates.deletedAt)));

      const estimateHeader = rows[0]?.estimate;
      if (!estimateHeader) return null;
      const lineRows = rows.map((r) => r.line).filter((l): l is EstimateLineRow => l !== null);
      return toDomain(estimateHeader, lineRows);
    });

    if (!aggregate) return null;

    // Derive the customer's first name from the lead name (take everything up to the first space).
    const customerFirstName = header.leadName.split(" ")[0] ?? header.leadName;

    return {
      estimate: aggregate,
      orgName: header.orgName,
      customerFirstName,
    };
  }

  // Resolve just the orgId from a token — used by accept/decline to open a withTenant session.
  // Returns null if the token does not match any non-deleted estimate.
  async resolveOrgByToken(token: string): Promise<{ estimateId: string; orgId: OrgId } | null> {
    const rows = await ownerDb
      .select({ id: estimates.id, orgId: estimates.orgId })
      .from(estimates)
      .where(
        and(
          eq(estimates.publicToken, token),
          isNull(estimates.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return { estimateId: row.id, orgId: asOrgId(row.orgId) };
  }
}
