"use client";

import { api, type RouterOutputs } from "@/lib/trpc/client";

/**
 * features/customers/use-pipeline-stage-mutations.ts
 * The Pipeline board's stage edits — optimistic, narrow-settling.
 *
 * THE EDIT LOOP IS OPTIMISTIC. Every stage edit lands in the board cache on the press and the
 * server settles afterwards — the buttons used to wait a full round trip and then refetch the
 * ENTIRE customers.list namespace (every column, every loaded page, plus the List tab), which
 * is what made Save/move/Delete visibly laggy. On error the snapshot goes back.
 *
 * SETTLING IS NARROW. Renaming or reordering a column does not change which customers are in
 * it, so those refetch nothing. Only edits that actually move customers refetch columns — and
 * only the columns involved.
 */

export type BoardData = RouterOutputs["v1"]["customers"]["pipeline"]["board"];

export function usePipelineStageMutations() {
  const utils = api.useUtils();
  const boardCache = utils.v1.customers.pipeline.board;

  const optimistic = <V,>(apply: (d: BoardData, vars: V) => BoardData) => ({
    onMutate: async (vars: V) => {
      await boardCache.cancel(); // an in-flight board read landing late would clobber the write
      const prev = boardCache.getData();
      boardCache.setData(undefined, (d) => (d ? apply(d, vars) : d));
      return { prev };
    },
    onError: (_e: unknown, _v: V, ctx?: { prev?: BoardData }) => {
      if (ctx?.prev) boardCache.setData(undefined, ctx.prev);
    },
  });

  /** Refetch only the columns whose CONTENTS changed ("none" is the Not staged column's key). */
  const invalidateColumns = (stageIds: ReadonlyArray<string | null>) => {
    const hit = new Set(stageIds.map((s) => s ?? "none"));
    void utils.v1.customers.list.invalidate(undefined, {
      predicate: (q) => {
        const meta = q.queryKey[1] as { input?: { pipelineStage?: string } } | undefined;
        const col = meta?.input?.pipelineStage;
        return col !== undefined && hit.has(col);
      },
    });
  };

  const seed = api.v1.customers.pipeline.seed.useMutation({ onSuccess: () => void boardCache.invalidate() });

  // The response IS the new column, so it goes straight into the cache; no customer moved.
  const createStage = api.v1.customers.pipeline.createStage.useMutation({
    onSuccess: (s) => boardCache.setData(undefined, (d) => (d ? { ...d, stages: [...d.stages, { ...s, count: 0 }] } : d)),
  });

  const renameStage = api.v1.customers.pipeline.renameStage.useMutation(
    optimistic<{ id: string; name: string }>((d, v) => ({
      ...d,
      stages: d.stages.map((s) => (s.id === v.id ? { ...s, name: v.name } : s)),
    })),
  );

  const removeStage = api.v1.customers.pipeline.removeStage.useMutation({
    ...optimistic<{ id: string }>((d, v) => {
      const gone = d.stages.find((s) => s.id === v.id);
      if (!gone) return d;
      return { ...d, stages: d.stages.filter((s) => s.id !== v.id), unstaged: d.unstaged + gone.count };
    }),
    onSuccess: () => {
      void boardCache.invalidate();
      invalidateColumns([null]); // its customers are Not staged now
    },
  });

  const moveStage = api.v1.customers.pipeline.moveStage.useMutation({
    ...optimistic<{ id: string; direction: "up" | "down" }>((d, v) => {
      const i = d.stages.findIndex((s) => s.id === v.id);
      const j = v.direction === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= d.stages.length) return d;
      const stages = [...d.stages];
      [stages[i], stages[j]] = [stages[j]!, stages[i]!];
      return { ...d, stages };
    }),
    // The server answers with the authoritative order (sans counts) — adopt it, keep our counts.
    onSuccess: (ordered) =>
      boardCache.setData(undefined, (d) =>
        d
          ? { ...d, stages: ordered.map((s) => ({ ...s, count: d.stages.find((x) => x.id === s.id)?.count ?? 0 })) }
          : d,
      ),
  });

  return { seed, createStage, renameStage, removeStage, moveStage, boardCache, invalidateColumns };
}
