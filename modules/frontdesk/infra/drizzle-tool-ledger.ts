import { and, eq } from "drizzle-orm";
import { frontdeskToolInvocations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { ToolInvocationLedger } from "../domain/call-record";

// Idempotency ledger for voice tool calls. Constructed with a tenant-scoped transaction, so RLS
// scopes every statement to the current org; the explicit eq(this.orgId) is defense-in-depth on
// top of RLS. Vapi retries tool webhooks: a replayed tool_call_id must return the stored result
// and never re-execute — save() is insert-with-DO-NOTHING (PK is (org_id, tool_call_id)), so the
// second write is a no-op and the first result stands.
export class DrizzleToolInvocationLedger implements ToolInvocationLedger {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async find(vapiCallId: string, toolCallId: string): Promise<{ result: unknown } | null> {
    const rows = await this.tx
      .select({ result: frontdeskToolInvocations.result })
      .from(frontdeskToolInvocations)
      .where(
        and(
          eq(frontdeskToolInvocations.orgId, this.orgId),
          eq(frontdeskToolInvocations.vapiCallId, vapiCallId),
          eq(frontdeskToolInvocations.toolCallId, toolCallId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? { result: row.result } : null;
  }

  async save(input: {
    orgId: OrgId;
    vapiCallId: string;
    toolCallId: string;
    tool: string;
    result: unknown;
  }): Promise<void> {
    await this.tx
      .insert(frontdeskToolInvocations)
      .values({
        orgId: this.orgId,
        vapiCallId: input.vapiCallId,
        toolCallId: input.toolCallId,
        tool: input.tool,
        result: input.result,
      })
      .onConflictDoNothing({
        target: [frontdeskToolInvocations.orgId, frontdeskToolInvocations.toolCallId],
      });
  }
}
