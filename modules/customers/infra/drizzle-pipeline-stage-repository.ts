import { and, asc, eq, isNull } from "drizzle-orm";
import { pipelineStages } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { PipelineStage } from "../domain/pipeline-stage";
import type { PipelineStageRepository } from "../domain/pipeline-stage-repository";

type StageRow = typeof pipelineStages.$inferSelect;

// A row that fails domain invariants is corrupt data, not an expected condition — fail loud.
const toDomain = (row: StageRow): PipelineStage => {
  const r = PipelineStage.create({
    id: row.id,
    orgId: row.orgId as OrgId,
    name: row.name,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
  if (!r.ok) throw new Error(`corrupt pipeline stage ${row.id}: ${r.error.message}`);
  return r.value;
};

export class DrizzlePipelineStageRepository implements PipelineStageRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async list(): Promise<PipelineStage[]> {
    const rows = await this.tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.orgId, this.orgId), isNull(pipelineStages.deletedAt)))
      .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<PipelineStage | null> {
    const rows = await this.tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, id), eq(pipelineStages.orgId, this.orgId), isNull(pipelineStages.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async save(stage: PipelineStage): Promise<void> {
    const p = stage.props;
    await this.tx
      .insert(pipelineStages)
      .values({
        id: p.id,
        orgId: this.orgId, // ALWAYS the constructor org — never the aggregate's word for it
        name: p.name,
        position: p.position,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
      })
      .onConflictDoUpdate({
        target: pipelineStages.id,
        set: { name: p.name, position: p.position, updatedAt: p.updatedAt, deletedAt: p.deletedAt },
        // Upsert guard: without this WHERE, saving a stage whose id exists in ANOTHER org would
        // update that org's row (RLS also blocks it — this is the defense-in-depth twin).
        setWhere: eq(pipelineStages.orgId, this.orgId),
      });
  }
}
