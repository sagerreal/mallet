import { asJobId } from "@mallet/shared/types";
import { jobLines, jobAddons, jobVerifyAnswers, jobPhotos } from "@mallet/shared/db/schema";
import { JobLine, JobAddon, JobVerifyAnswer, JobPhoto } from "../domain/job-execution";

export type JobLineRow = typeof jobLines.$inferSelect;
export type JobAddonRow = typeof jobAddons.$inferSelect;
export type JobVerifyAnswerRow = typeof jobVerifyAnswers.$inferSelect;
export type JobPhotoRow = typeof jobPhotos.$inferSelect;

export const lineToDomain = (row: JobLineRow): JobLine => {
  const r = JobLine.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    description: row.description,
    quantity: row.quantity,
    rateCents: row.rateCents,
    costCents: row.costCents,
    taxable: row.taxable,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_line ${row.id}: ${r.error.message}`);
  return r.value;
};

export const addonToDomain = (row: JobAddonRow): JobAddon => {
  const r = JobAddon.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    description: row.description,
    quantity: row.quantity,
    rateCents: row.rateCents,
    costCents: row.costCents,
    isOptional: row.isOptional,
    invoiceSkip: row.invoiceSkip,
    status: row.status,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_addon ${row.id}: ${r.error.message}`);
  return r.value;
};

export const verifyToDomain = (row: JobVerifyAnswerRow): JobVerifyAnswer => {
  const r = JobVerifyAnswer.create({
    jobId: asJobId(row.jobId),
    itemId: row.itemId,
    state: row.state,
    via: row.via ?? null,
    reason: row.reason ?? null,
  });
  if (!r.ok) throw new Error(`corrupt job_verify_answer ${row.id}: ${r.error.message}`);
  return r.value;
};

export const photoToDomain = (row: JobPhotoRow): JobPhoto => {
  const r = JobPhoto.create({
    id: row.id,
    jobId: asJobId(row.jobId),
    storagePath: row.storagePath,
    caption: row.caption ?? null,
    verifyPass: row.verifyPass,
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt job_photo ${row.id}: ${r.error.message}`);
  return r.value;
};
