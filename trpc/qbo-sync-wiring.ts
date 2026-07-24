import { asUserId, systemClock } from "@mallet/shared/types";
import type { RelayHandlerContext } from "@mallet/shared/outbox";
import { DrizzleTimeEntryRepository } from "@mallet/timesheets";
import {
  DrizzleQboConnectionRepository,
  DrizzleQboEntityLinkRepository,
  DrizzleQboSyncLogRepository,
  EnsureFreshAccessToken,
  HttpQboApiGateway,
  SyncApprovedHours,
  type QboTimeSyncPorts,
  type SyncableTimeEntry,
} from "@mallet/accounting-sync";
import { loadConfig } from "@mallet/shared/config";
import { getAppDeps } from "./di";

// Composition for the QuickBooks time-sync outbox handler. Lives here (not in the module) because
// it wires the accounting-sync module to the TIMESHEETS module — cross-module assembly belongs at
// the composition root, not inside either module.

const MAX_ENTRIES_PER_WEEK = 500; // A week for one tech; far above any real crew's volume.

export const buildQboTimeSyncPorts = (): QboTimeSyncPorts => ({
  loadSyncConfig: async (ctx: RelayHandlerContext) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (!connection) return null;
    return {
      enabled: connection.props.sendApprovedHours,
      defaultItemQboId: connection.props.defaultItemQboId,
    };
  },

  access: async (ctx: RelayHandlerContext) => {
    const deps = getAppDeps();
    if (!deps.qboOauthGateway || !deps.qboSecretBox) {
      // Unconfigured server. Not retryable — waiting won't add credentials.
      return { ok: false, error: { kind: "not_found", message: "QuickBooks is not configured" } } as never;
    }
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const result = await new EnsureFreshAccessToken(
      repo,
      deps.qboOauthGateway,
      deps.qboSecretBox,
      deps.clock ?? systemClock,
    ).exec(ctx.orgId);
    if (!result.ok) return result;
    return { ok: true, value: { accessToken: result.value.accessToken, realmId: result.value.realmId } };
  },

  loadEntries: async (ctx, techUserId, dates) => {
    const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.orgId);
    const sorted = [...dates].sort();
    // The repo filters by RANGE; narrow to the exact approved dates afterwards. Reusing the
    // existing query beats widening the timesheets repository for one caller.
    const page = await repo.list(
      {
        techUserId: asUserId(techUserId),
        fromDate: sorted[0] as string,
        toDate: sorted[sorted.length - 1] as string,
      },
      { cursor: null, limit: MAX_ENTRIES_PER_WEEK },
    );

    const wanted = new Set(dates);
    const entries: SyncableTimeEntry[] = [];
    for (const e of page.items) {
      const p = e.props;
      // Only APPROVED entries are ever pushed — approval is the shop's explicit sign-off, and a
      // draft could still change.
      if (p.status !== "approved") continue;
      if (!wanted.has(p.workDate)) continue;
      entries.push({
        id: p.id,
        techUserId: p.techUserId,
        workDate: p.workDate,
        kind: p.kind,
        startTime: p.startTime,
        endTime: p.endTime,
        note: p.note,
      });
    }
    return entries;
  },

  sync: async (ctx, techUserId, entries, defaultItemQboId, access) => {
    const config = loadConfig();
    const api = new HttpQboApiGateway(config.QBO_ENVIRONMENT);
    const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.orgId);
    const syncLog = new DrizzleQboSyncLogRepository(ctx.tx, ctx.orgId);
    return new SyncApprovedHours(api, links, syncLog, systemClock).exec(
      { techUserId, entries, defaultItemQboId },
      access,
      ctx.orgId,
    );
  },

  markSynced: async (ctx, at) => {
    const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.orgId);
    const connection = await repo.get();
    if (connection) await repo.save(connection.withLastSyncAt(at));
  },
});
