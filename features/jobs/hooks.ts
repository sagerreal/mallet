"use client";
import { api } from "@/lib/trpc/client";

type JobStatus = "scheduled" | "in_progress" | "complete" | "canceled";

const useInvalidateJobs = () => {
  const utils = api.useUtils();
  return () =>
    Promise.all([
      utils.v1.jobs.list.invalidate(),
      utils.v1.jobs.get.invalidate(),
      utils.v1.jobs.listByLead.invalidate(),
    ]);
};

export const useJobs = (status?: JobStatus) => api.v1.jobs.list.useQuery({ limit: 50, status });
export const useJob = (jobId: string) => api.v1.jobs.get.useQuery({ jobId });
export const useCreateJobFromEstimate = () => {
  const i = useInvalidateJobs();
  return api.v1.jobs.createFromEstimate.useMutation({ onSuccess: i });
};
export const useAssignJob = () => {
  const i = useInvalidateJobs();
  return api.v1.jobs.assign.useMutation({ onSuccess: i });
};
export const useRescheduleJob = () => {
  const i = useInvalidateJobs();
  // router procedure is named "schedule" (reschedule existing job by jobId)
  return api.v1.jobs.schedule.useMutation({ onSuccess: i });
};
export const useStartJob = () => {
  const i = useInvalidateJobs();
  return api.v1.jobs.start.useMutation({ onSuccess: i });
};
export const useCompleteJob = () => {
  const i = useInvalidateJobs();
  return api.v1.jobs.complete.useMutation({ onSuccess: i });
};
export const useCancelJob = () => {
  const i = useInvalidateJobs();
  return api.v1.jobs.cancel.useMutation({ onSuccess: i });
};
