export interface QboEntityLink {
  readonly entityType: "employee" | "customer" | "service_item";
  readonly malletId: string;
  readonly qboId: string;
  readonly qboEntityKind: "Employee" | "Vendor" | null;
  readonly displayName: string | null;
}

export interface QboEntityLinkRepository {
  listByType(entityType: QboEntityLink["entityType"]): Promise<readonly QboEntityLink[]>;
  find(entityType: QboEntityLink["entityType"], malletId: string): Promise<QboEntityLink | null>;
  /** Upsert on (org, entityType, malletId) — re-matching a person replaces the old link. */
  save(link: QboEntityLink): Promise<void>;
  remove(entityType: QboEntityLink["entityType"], malletId: string): Promise<void>;
}

export type SyncOutcome = "succeeded" | "failed" | "skipped";

export interface QboSyncLogEntry {
  readonly entityType: string;
  readonly malletId: string;
  readonly qboId: string | null;
  readonly status: SyncOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly attemptedAt: Date;
}

export interface QboSyncLogRepository {
  /**
   * The Mallet ids (of `entityType`) already pushed SUCCESSFULLY. The outbox is at-least-once, so
   * this is what stops a redelivered event from duplicating hours on a real paycheck.
   */
  succeededIds(entityType: string, malletIds: readonly string[]): Promise<ReadonlySet<string>>;
  record(entry: QboSyncLogEntry): Promise<void>;
  /** Most recent attempts, for the sync log UI. */
  recent(limit: number): Promise<readonly QboSyncLogEntry[]>;
}
