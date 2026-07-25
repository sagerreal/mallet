import type { Brand } from "./brand";
import type { ValidationError } from "./errors";
import { validation } from "./errors";
import type { Result } from "./result";
import { ok, err } from "./result";

// Entity ids — branded strings (UUIDs from the DB). Cast helpers are for trusted sources
// (DB rows, generated uuids); untrusted input is validated where it enters (see Phone).
export type OrgId = Brand<string, "OrgId">;
export type UserId = Brand<string, "UserId">;
export type TechId = Brand<string, "TechId">;
export type LeadId = Brand<string, "LeadId">;
export type CompanyId = Brand<string, "CompanyId">;
export type EstimateId = Brand<string, "EstimateId">;
export type EstimateLineId = Brand<string, "EstimateLineId">;
export type JobId = Brand<string, "JobId">;
export type VisitId = Brand<string, "VisitId">;
export type InvoiceId = Brand<string, "InvoiceId">;
export type TaskId = Brand<string, "TaskId">;
export type TimeEntryId = Brand<string, "TimeEntryId">;
export type MessageId = Brand<string, "MessageId">;
export type ChecklistId = Brand<string, "ChecklistId">;
export type ChecklistItemId = Brand<string, "ChecklistItemId">;
export type ServiceId = Brand<string, "ServiceId">;
export type CategoryId = Brand<string, "CategoryId">;
export type MaterialId = Brand<string, "MaterialId">;
export type QuotingRuleId = Brand<string, "QuotingRuleId">;
export type OutboundCallId = Brand<string, "OutboundCallId">;

export const asOrgId = (v: string): OrgId => v as OrgId;
export const asUserId = (v: string): UserId => v as UserId;
export const asTechId = (v: string): TechId => v as TechId;
export const asLeadId = (v: string): LeadId => v as LeadId;
export const asCompanyId = (v: string): CompanyId => v as CompanyId;
export const asEstimateId = (v: string): EstimateId => v as EstimateId;
export const asEstimateLineId = (v: string): EstimateLineId => v as EstimateLineId;
export const asJobId = (v: string): JobId => v as JobId;
export const asVisitId = (v: string): VisitId => v as VisitId;
export const asInvoiceId = (v: string): InvoiceId => v as InvoiceId;
export const asTaskId = (v: string): TaskId => v as TaskId;
export const asTimeEntryId = (v: string): TimeEntryId => v as TimeEntryId;
export const asMessageId = (v: string): MessageId => v as MessageId;
export const asChecklistId = (v: string): ChecklistId => v as ChecklistId;
export const asChecklistItemId = (v: string): ChecklistItemId => v as ChecklistItemId;
export const asServiceId = (v: string): ServiceId => v as ServiceId;
export const asCategoryId = (v: string): CategoryId => v as CategoryId;
export const asMaterialId = (v: string): MaterialId => v as MaterialId;
export const asQuotingRuleId = (v: string): QuotingRuleId => v as QuotingRuleId;
export const asOutboundCallId = (v: string): OutboundCallId => v as OutboundCallId;

// Phone is a validated value object — E.164 (US). Parsed at the boundary from untrusted input.
export type Phone = Brand<string, "Phone">;

const US_LOCAL_DIGITS = 10;

export const Phone = {
  parse(raw: string): Result<Phone, ValidationError> {
    const digits = raw.replace(/\D/g, "");
    const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (local.length !== US_LOCAL_DIGITS) {
      return err(validation(`invalid US phone number: "${raw}"`, "phone"));
    }
    return ok(`+1${local}` as Phone);
  },
};

// Trusted cast for values already in E.164 (e.g. read back from the DB). Untrusted input must
// go through Phone.parse instead.
export const asPhone = (v: string): Phone => v as Phone;
