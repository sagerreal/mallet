import type { z } from "zod";
import type { OrgId, Clock } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { EnsureCustomerUseCase } from "@mallet/customers";
import type { CreateTaskUseCase } from "@mallet/tasks";
import type { CreateManualJobUseCase, CreateVisitUseCase } from "@mallet/jobs";
import type { SendNotificationUseCase } from "@mallet/notifications";
import type { VoiceToolSpec, SettingsReader } from "../../domain/assistant";
import type { AvailabilityReader } from "../../domain/availability";
import type { Geocoder } from "../../domain/geocoder";

// The outcome of one voice tool, serialized into Vapi's `results[].result`. `speak` is the spoken
// confirmation the agent reads back to the caller (never an opaque code — the caller hears it).
// `data` carries structured flags the runner + post-call recorder read (e.g. { emergency: true },
// { topic }); it is never spoken. Every field readonly — the runner freezes a fresh value per call.
export interface VoiceToolResult {
  readonly speak: string;
  readonly data?: Record<string, unknown>;
}

// The use-cases and ports a voice tool handler may need, all built from THIS call's tenant tx (the
// runner constructs them per tool call — see run-tool-calls.ts). `bus` is bound to the tx so a
// tool's emits are durable + atomic with its writes, exactly like a tRPC request. Deliberately a
// small, fixed surface: a voice tool ensures a customer, files an office task, reads the org
// playbook (settings) + open schedule (availability), and emits. Readers are query-only ports so
// check_availability never touches drizzle directly (DI + repository pattern).
export interface VoiceToolDeps {
  readonly ensureCustomer: EnsureCustomerUseCase;
  // book_visit seeds the job and its first visit itself (no client flow follows a voice booking —
  // see CreateManualJobUseCase's comment): create the manual job, then create the visit on it.
  readonly createManualJob: CreateManualJobUseCase;
  readonly createVisit: CreateVisitUseCase;
  readonly createTask: CreateTaskUseCase;
  readonly settings: SettingsReader;
  readonly availability: AvailabilityReader;
  // Free-text-address → point resolver, injected (DI) so the service-area check depends on the port,
  // not a provider. A single shared CensusGeocoder instance is fine (request-independent, own cache).
  // A geocode miss returns null and NEVER throws, so the service-area check degrades to "book
  // normally" (see service-area.ts) rather than blocking a booking on flaky geocoding.
  readonly geocoder: Geocoder;
  // Comms egress (SMS/email) routed through the notification USE-CASE (not the raw sender) so every
  // send writes an observable notifications row (records stub:logged while A2P is blocked — the B3
  // requirement). book_visit fires a one-time transactional booking confirmation through it; a send
  // failure NEVER fails a booking (background-path semantics) — see book-visit.ts.
  readonly sendNotification: SendNotificationUseCase;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

// The execution context for one voice tool call. `tx` is a short tenant transaction opened just for
// this call; `orgId` comes ONLY from the To-number lookup via the verified Principal, never from the
// model-supplied arguments — the prompt-injection guard. `deps` are pre-built from `tx`.
export interface VoiceToolContext {
  readonly tx: TenantTx;
  readonly orgId: OrgId;
  readonly principal: Principal;
  readonly deps: VoiceToolDeps;
}

// A voice tool = the model-facing spec (name/description/JSON-schema parameters — MCP-shaped, fed to
// Vapi via VoiceToolSpec) + the zod `input` that validates the model-supplied arguments at the
// boundary + a `handle` that runs under a tenant tx and returns a SPOKEN result. Deliberately
// parallel to modules/ai `AgentTool` but voice-shaped: there is NO approval gate — a live call
// cannot pause for a human, so the gate is the fixed tool whitelist itself plus per-toolCallId
// idempotency (the ledger). `handle` should return a spoken fallback on an expected failure rather
// than throw; the runner's try/catch is the backstop for unexpected throws.
export interface VoiceTool {
  readonly name: string;
  readonly description: string;
  // JSON schema for VoiceToolSpec.function.parameters (the shape Vapi forwards to the LLM).
  readonly parameters: Record<string, unknown>;
  readonly input: z.ZodType;
  handle(input: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult>;
}

// Project a VoiceTool onto the transport spec the assistant builder puts in `model.tools`.
// Keeps the builder open/closed: it never reaches into a tool's internals, just maps this shape.
export const toVoiceToolSpec = (tool: VoiceTool): VoiceToolSpec => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
});
