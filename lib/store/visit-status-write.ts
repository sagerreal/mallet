/**
 * lib/store/visit-status-write.ts
 * Where a visit-status write goes, and nothing else — the store slice keeps the optimistic /
 * reconcile / rollback mechanics, this file only picks the endpoint.
 *
 * Two APIs write the same rows for different callers:
 *   • v1.field.*  — anyRole, gated by "is this job assigned to you", and a tech's tap here also
 *                   moves their clock (travel → on site → back to shop).
 *   • v1.visits.* — ownerOrOffice. The dispatcher's surface; drives no clock, because the person
 *                   at the desk did not do the work.
 * Both return the same refreshed jobDTO, so the caller's reconcile path is identical either way.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { STORE_VISIT_STATUS, storeStatusToBackend, type JobDTO } from "@/lib/store/dto-mapper";

/**
 * Which API a visit write is made against. The store holds no identity of its own, so the caller
 * supplies this — the tech job modal already resolves the role for its own rendering.
 */
export type VisitWriteSurface = "field" | "office";

/** The two status changes the field API accepts (its zod enum) — the tech's two step buttons. */
type FieldWritableStatus = "in_progress" | "complete";

const FIELD_WRITABLE_STATUSES: readonly FieldWritableStatus[] = ["in_progress", "complete"];

const isFieldWritable = (status: string): status is FieldWritableStatus =>
  (FIELD_WRITABLE_STATUSES as readonly string[]).includes(status);

/**
 * Fire the write and return the refreshed job.
 *
 * "enroute" is not a status — it is the enroute_at stamp on a still-pending visit, so it has its
 * own endpoint on both surfaces. Everything else maps to the backend status enum.
 *
 * A field caller asking for a status the field API cannot write (↩ Reopen, cancel — office
 * corrections with no field endpoint) falls through to the office endpoint, where a tech's token
 * is refused. That is deliberate: the write fails visibly and rolls back, rather than resolving
 * as a success that changed nothing.
 */
export function persistVisitStatus(
  surface: VisitWriteSurface,
  jobId: string,
  visitId: string,
  status: string,
): Promise<JobDTO> {
  const onField = surface === "field";

  if (status === STORE_VISIT_STATUS.ENROUTE) {
    return onField
      ? trpcVanilla.v1.field.setVisitEnroute.mutate({ jobId, visitId })
      : trpcVanilla.v1.visits.setVisitEnroute.mutate({ jobId, visitId });
  }

  const backendStatus = storeStatusToBackend(status);
  if (onField && isFieldWritable(backendStatus)) {
    return trpcVanilla.v1.field.setVisitStatus.mutate({ jobId, visitId, status: backendStatus });
  }
  return trpcVanilla.v1.visits.setVisitStatus.mutate({ jobId, visitId, status: backendStatus });
}

/**
 * The name of the write for a failure toast. "On my way" and a status change are different
 * endpoints, and a toast that names the wrong one sends the office looking in the wrong place.
 */
export const visitWriteName = (status: string): string =>
  status === STORE_VISIT_STATUS.ENROUTE ? "setVisitEnroute" : "setVisitStatus";
