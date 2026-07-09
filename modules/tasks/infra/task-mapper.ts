import { asTaskId, asLeadId, asOrgId } from "@mallet/shared/types";
import { tasks } from "@mallet/shared/db/schema";
import { Task } from "../domain/task";

// The persistence row shape inferred from the schema.
export type TaskRow = typeof tasks.$inferSelect;

// Reconstruct a domain Task from a DB row. Corrupt data throws rather than silently coercing.
export const toDomain = (row: TaskRow): Task => {
  const result = Task.create({
    id: asTaskId(row.id),
    orgId: asOrgId(row.orgId),
    leadId: row.leadId ? asLeadId(row.leadId) : null,
    text: row.text,
    // Drizzle date columns return strings for the `date` type.
    dueDate: row.dueDate ?? null,
    done: row.done,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt task ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
