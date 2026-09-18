import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, gt, sql, count } from "drizzle-orm";
import { toolConfirmations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, UserId } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";

const TOKEN_PREFIX = "mallet_confirm_";

// How long a proposal stays confirmable. The token travels IN-BAND (it must appear in the tool
// result — that's how the host confirms), so it lands in conversation transcripts and host logs; a
// short window bounds what a leaked transcript is worth. Human-in-the-loop confirms in well under a
// minute; anything older should be re-proposed against current state anyway.
export const CONFIRMATION_TTL_MS = 3 * 60 * 1000;

// Cap on outstanding (unconsumed, unexpired) proposals per key — a looping or compromised key can't
// grief storage with unbounded frozen-args rows.
export const MAX_PENDING_PROPOSALS = 20;

// A one-time confirmation token = `mallet_confirm_<48 hex>`. Same show-once discipline as API keys:
// only the SHA-256 hash is stored, and the raw value is never written to server logs.
export const generateConfirmToken = (): { raw: string; hash: string } => {
  const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashConfirmToken(raw) };
};

export const hashConfirmToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

export interface ProposalInput {
  readonly orgId: OrgId;
  readonly tool: string;
  readonly args: Record<string, JsonValue>;
  readonly summary: string;
  // Entity-state snapshot (tool.fingerprint) taken in the SAME tx — re-checked at confirm so the
  // proposal can't execute against a record that changed after the human read the summary.
  readonly fingerprint: string | null;
  readonly createdBy: UserId;
  readonly now: Date;
}

export type ProposalResult = { readonly ok: true; readonly token: string; readonly expiresAt: Date } | { readonly ok: false; readonly error: "pending_limit" };

// Mint a proposal inside the caller's tenant tx. Args are FROZEN here — confirmation executes
// exactly these, so the summary the human reviewed is exactly what runs.
export const createProposal = async (tx: TenantTx, input: ProposalInput): Promise<ProposalResult> => {
  // Serialize proposal-minting per key so the count-then-insert cap can't be raced past by a burst
  // of concurrent proposes (the cap is the storage-griefing bound). A transaction-scoped advisory
  // lock releases at commit/rollback, so it's safe behind the transaction pooler (like the tx-local
  // set_config in withTenant). Keyed on a stable hash of the key id in a private lock namespace.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.createdBy}), 6821)`);
  const [pending] = await tx
    .select({ n: count() })
    .from(toolConfirmations)
    .where(and(eq(toolConfirmations.createdBy, input.createdBy), isNull(toolConfirmations.consumedAt), gt(toolConfirmations.expiresAt, input.now)));
  if ((pending?.n ?? 0) >= MAX_PENDING_PROPOSALS) return { ok: false, error: "pending_limit" };

  const { raw, hash } = generateConfirmToken();
  const expiresAt = new Date(input.now.getTime() + CONFIRMATION_TTL_MS);
  await tx.insert(toolConfirmations).values({
    orgId: input.orgId,
    tokenHash: hash,
    tool: input.tool,
    args: input.args,
    summary: input.summary,
    fingerprint: input.fingerprint,
    createdBy: input.createdBy,
    expiresAt,
  });
  return { ok: true, token: raw, expiresAt };
};

export interface ConsumedProposal {
  readonly args: Record<string, JsonValue>;
  readonly fingerprint: string | null;
}

// Atomically consume a token: single guarded UPDATE (the ATOMIC-GUARD pattern) so two concurrent
// confirms can't both execute — under READ COMMITTED the loser blocks on the row lock, re-evaluates
// `consumed_at is null` against the committed winner, matches zero rows, and gets null. The token is
// bound to the TOOL (a quote_draft token can't confirm invoice_send), to the PROPOSING KEY
// (created_by — a token leaked to a sibling key in the same org is useless), and to the ORG via RLS
// (the tx is tenant-scoped, so a foreign org's token matches nothing). Returns the FROZEN args +
// fingerprint, or null for unknown/expired/consumed/mismatched — indistinguishable by design.
export const consumeProposal = async (
  tx: TenantTx,
  params: { readonly rawToken: string; readonly tool: string; readonly createdBy: UserId; readonly now: Date },
): Promise<ConsumedProposal | null> => {
  const rows = await tx
    .update(toolConfirmations)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(toolConfirmations.tokenHash, hashConfirmToken(params.rawToken)),
        eq(toolConfirmations.tool, params.tool),
        eq(toolConfirmations.createdBy, params.createdBy),
        isNull(toolConfirmations.consumedAt),
        gt(toolConfirmations.expiresAt, params.now),
      ),
    )
    .returning({ args: toolConfirmations.args, fingerprint: toolConfirmations.fingerprint });
  const row = rows[0];
  return row ? { args: row.args as Record<string, JsonValue>, fingerprint: row.fingerprint } : null;
};
