// Public surface for the jobs module — the only sanctioned import seam (architecture rule).
export { createJobRouter } from "./api/job-router";
export { createFieldRouter } from "./api/field-router";
export { createVisitRouter } from "./api/visit-router";
export type { Job, JobStatus, JobProps } from "./domain/job";
export type { JobRepository, JobFilter } from "./domain/job-repository";
export type {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
  AddonStatus,
  VerifyState,
} from "./domain/job-execution";
export { JOB_ADDON_STATUSES, VERIFY_STATES, isAddonStatus, isVerifyState } from "./domain/job-execution";
export type { EstimateReader, EstimateSummary } from "./domain/estimate-reader";
// Exposed so other modules (e.g. invoicing) can read jobs through this seam without touching
// jobs internals.
export { DrizzleJobRepository } from "./infra/drizzle-job-repository";
export { ScheduleJobUseCase } from "./app/schedule-job";
export { CreateJobFromEstimateUseCase } from "./app/create-job-from-estimate";
export { RescheduleJobUseCase } from "./app/reschedule-job";
export { AssignJobUseCase } from "./app/assign-job";
export { StartJobUseCase } from "./app/start-job";
export { CompleteJobUseCase } from "./app/complete-job";
export { CancelJobUseCase } from "./app/cancel-job";
export { CreateManualJobUseCase } from "./app/create-manual-job";
export { UpdateJobUseCase } from "./app/update-job";
export { ArchiveJobUseCase } from "./app/archive-job";
export { ListJobsUseCase } from "./app/list-jobs";
export {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "./app/job-execution-use-cases";
export type { JobWithExecution } from "./app/job-execution-use-cases";
export type { PhotoStorageGateway, SignedUpload, CreateUploadUrlCmd } from "./domain/photo-storage-gateway";
export { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET } from "./infra/supabase-photo-storage-gateway";
