import type { PipelineStage } from "./pipeline-stage";

/**
 * Persistence port for shop-defined pipeline stages. Org scoping is the adapter's job (it is
 * constructed with the org), so the port never takes an orgId — same contract as LeadRepository.
 */
export interface PipelineStageRepository {
  /** Live stages in board order (position, then age as the tiebreak for legacy equal positions). */
  list(): Promise<PipelineStage[]>;
  /** A LIVE stage by id — soft-deleted stages are not findable, so writes cannot target them. */
  findById(id: string): Promise<PipelineStage | null>;
  /** Upsert by id. Create, rename, move and remove all land here — one write path. */
  save(stage: PipelineStage): Promise<void>;
}
