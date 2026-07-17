import type { AuthProvider, ApiKeyVerifier, TokenVerifier, SignupStore } from "@mallet/identity";
import type { PaymentLinkGateway } from "@mallet/invoicing";
import type { ConnectGateway } from "@mallet/settings";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { NotificationSender } from "@mallet/notifications";
import type { LlmClient } from "@mallet/ai";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";

// The application's outward dependencies, injected at the composition root. Use-cases receive
// these (never construct adapters themselves), so tests substitute fakes freely.
export interface AppDeps {
  readonly authProvider: AuthProvider;
  // Per-tenant API-key auth for the remote MCP server (static Bearer keys → Principal).
  readonly apiKeyAuthenticator: ApiKeyVerifier;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  // Card payments (Stripe). null when Stripe is unconfigured — card create self-disables.
  readonly paymentLinkGateway: PaymentLinkGateway | null;
  // Stripe Connect (Express) onboarding. null when Stripe is unconfigured — onboarding self-disables
  // (payments.beginOnboarding returns PRECONDITION_FAILED).
  readonly connectGateway: ConnectGateway | null;
  // Direct-to-storage upload URLs for job photos (Supabase Storage). null when the service-role
  // env is unavailable — photo upload self-disables (photoUploadUrl returns PRECONDITION_FAILED).
  readonly photoStorageGateway: PhotoStorageGateway | null;
  // Comms egress (email → Resend, sms → Twilio, per-channel fallback → logging stub). Optional:
  // when omitted (e.g. in tests) callers fall back to the logging stub, so unconfigured comms
  // degrade to a logged no-op rather than an error.
  readonly notificationSender?: NotificationSender;
  // The agent's model client (Anthropic). null when ANTHROPIC_API_KEY is unset — the AI agent
  // self-disables (its tRPC procedure returns PRECONDITION_FAILED).
  readonly llmClient: LlmClient | null;
  // Signup-time collaborators: verify a token WITHOUT requiring an existing principal, and provision
  // an org for a verified-but-unmapped auth user (SECURITY DEFINER seam).
  readonly tokenVerifier: TokenVerifier;
  readonly signupStore: Pick<SignupStore, "createOrgForUser">;
}
