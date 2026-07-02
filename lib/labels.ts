// lib/labels.ts — status → badge tone, one map per domain (mirrors the backend enums).
import type { BadgeTone } from "@/components/ui/badge";

export const LEAD_STAGE_TONE: Record<string, BadgeTone> = { new: "blue", contacted: "amber", quote_sent: "amber", won: "green", lost: "red" };
export const ESTIMATE_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "blue", accepted: "green", declined: "red" };
export const JOB_STATUS_TONE: Record<string, BadgeTone> = { scheduled: "blue", in_progress: "amber", complete: "green", canceled: "neutral" };
export const INVOICE_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "blue", partial: "amber", paid: "green", void: "neutral" };
