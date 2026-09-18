import type { OrgId } from "@mallet/shared/types";
import type { OrgSettings } from "@mallet/settings";

// The Vapi assistant configuration returned on assistant-request, shaped per Vapi's
// assistant-request docs. This is a transport DTO (structural, not a domain object): it is
// serialized straight to Vapi and never carries business behaviour. Every field is readonly —
// the builder assembles a fresh value per call and nothing mutates it downstream.

// One entry in the model.tools array. Tools are passed IN as data (open/closed): the builder
// never hardcodes the tool list — A5 supplies take_message, PR B supplies the rest. Parameters
// is an opaque JSON-schema object; we don't model its internals here (that belongs to each tool).
export interface VoiceToolSpec {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

// Vapi's built-in live-transfer tool: destinations are baked into the assistant
// config, so the number NEVER passes through the model. Executed by Vapi itself —
// our webhook tool runner never sees it (nothing to whitelist in run-tool-calls).
export interface TransferDestinationNumber {
  readonly type: "number";
  readonly number: string;
  /** Spoken to the caller as the transfer starts. */
  readonly message?: string;
}

export interface TransferCallToolSpec {
  readonly type: "transferCall";
  readonly destinations: readonly TransferDestinationNumber[];
}

/** Any entry in model.tools — our function tools or Vapi's built-in transfer. */
export type VoiceTool = VoiceToolSpec | TransferCallToolSpec;

// One chat message in the model context. Only the system prompt is set at build time; the
// live turns are appended by Vapi during the call.
export interface VoiceModelMessage {
  readonly role: "system";
  readonly content: string;
}

// The model block Vapi forwards to the LLM provider.
export interface VoiceModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly temperature: number;
  readonly messages: readonly VoiceModelMessage[];
  readonly tools: readonly VoiceTool[];
}

// The spoken-voice block.
export interface VoiceConfig {
  readonly provider: string;
  readonly voiceId: string;
}

// Recording toggle Vapi honours for the artifact plan. recordingEnabled is always true here —
// the compliance greeting states the call is recorded, so we must record.
export interface ArtifactPlan {
  readonly recordingEnabled: true;
}

// The full assistant payload. The decline variant (frontDesk off) still satisfies this shape:
// it simply carries an empty tools array and no system message beyond the greeting.
export interface VapiAssistantDTO {
  readonly firstMessage: string;
  readonly model: VoiceModelConfig;
  readonly voice: VoiceConfig;
  readonly maxDurationSeconds: number;
  readonly artifactPlan: ArtifactPlan;
  readonly endCallFunctionEnabled: true;
}

// Resolved BEFORE the call starts (inside the 7.5s Vapi budget) so the greeting can be
// personalised. `known` gates the caller-context prompt section entirely — an unknown caller
// gets no name/history section at all.
export interface CallerContext {
  readonly known: boolean;
  readonly name: string | null;
  // e.g. "job #142 scheduled Jul 16 (drain clear)" — a single human-readable line, or null.
  readonly openWork: string | null;
}

// Port over the existing settings read path (GetSettings/DrizzleSettingsRepository.getConfig).
// Returns the org's config aggregate (brand fields live on it) or null when no org matches.
// One query — the builder must stay inside the 7.5s Vapi budget (no N+1).
export interface SettingsReader {
  getByOrg(orgId: OrgId): Promise<OrgSettings | null>;
}

// Small new port: given a matched lead, return their display name + a one-line open-work
// summary. MUST be a single query (no N+1). Returns null when the lead has vanished.
export interface LeadSummaryReader {
  summarize(
    leadId: import("@mallet/shared/types").LeadId,
  ): Promise<{ name: string; openWork: string | null } | null>;
}
