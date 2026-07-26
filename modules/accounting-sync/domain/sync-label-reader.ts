/**
 * Names for the records the sync log points at.
 *
 * The log stores `(entity_type, mallet_id)` — a UUID. That is right for the log, which must stay
 * stable if a record is renamed, and useless on screen: nobody reconciling payroll can act on
 * "43cdb525-… failed". This port resolves those ids to something a shop recognises.
 *
 * A port rather than a join because the sync log lives in accounting-sync and the records it names
 * live in other modules. Reaching across would couple the modules and put a timesheets query
 * inside an accounting use-case.
 */
export interface SyncLabelReader {
  /**
   * Labels for the given ids of one entity type, e.g. "Owen Duggan · Jul 25".
   *
   * Ids with no label are simply absent from the map — a deleted record must not remove its own
   * failure from the screen, so the caller falls back rather than dropping the row.
   */
  labelsFor(entityType: string, malletIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
