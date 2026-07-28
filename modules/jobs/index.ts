// Public surface for the jobs module — the only sanctioned import seam (architecture rule).
export { createJobRouter } from "./api/job-router";
export { jobSummaryDTO, toJobSummaryDTO } from "./api/job-dto";
export { createFieldRouter } from "./api/field-router";
export { createVisitRouter } from "./api/visit-router";
export type { Job, JobStatus, JobKind, JobProps } from "./domain/job";
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
// Exposed so the quoting router can wire CreateJobFromEstimateUseCase without reaching into
// jobs infra directly.
export { DrizzleEstimateReader } from "./infra/drizzle-estimate-reader";
export { ScheduleJobUseCase } from "./app/schedule-job";
export { CreateJobFromEstimateUseCase } from "./app/create-job-from-estimate";
export { RescheduleJobUseCase } from "./app/reschedule-job";
export { AssignJobUseCase } from "./app/assign-job";
export { StartJobUseCase } from "./app/start-job";
export { CompleteJobUseCase } from "./app/complete-job";
export { CancelJobUseCase } from "./app/cancel-job";
export { CreateManualJobUseCase } from "./app/create-manual-job";
export type { CreateManualJobCommand } from "./app/create-manual-job";
export { CreateVisitUseCase } from "./app/create-visit";
export type { CreateVisitCommand } from "./app/create-visit";
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
export type { PhotoStorageGateway, SignedUpload, CreateUploadUrlCmd, DownloadContext, DownloadResult } from "./domain/photo-storage-gateway";
export { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET } from "./infra/supabase-photo-storage-gateway";
// Reassigning or re-timing a VISIT — what the dispatch board and a tech's day actually read.
export { PatchVisitScheduleUseCase } from "./app/patch-visit-schedule";
export type { PatchVisitScheduleCommand } from "./app/patch-visit-schedule";
