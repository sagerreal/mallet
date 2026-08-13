import type { AuthProvider, ApiKeyVerifier, TokenVerifier, SignupStore } from "@mallet/identity";
import type { PaymentLinkGateway, TerminalGateway, CardChargeGateway } from "@mallet/invoicing";
import type { ConnectGateway } from "@mallet/settings";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { NotificationSender } from "@mallet/notifications";
import type { LlmClient } from "@mallet/ai";
import type { A2pGateway, NumberProvisioner, VoiceRegistrar } from "@mallet/a2p";
import type { CallOriginator, VoiceTokenIssuer } from "@mallet/calls";
import type { QboOauthGateway } from "@mallet/accounting-sync";
import type { SecretBox } from "@mallet/platform/crypto/secret-box";
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
  // Stripe Terminal / Tap to Pay (phone-as-reader). Optional-nullable like voiceTokenIssuer:
  // absent in tests, null when Stripe is unconfigured — every v1.terminal procedure then answers
  // PRECONDITION_FAILED rather than half-working.
  readonly terminalGateway?: TerminalGateway | null;
  // Off-session charge of a saved card (charge card on file). Optional-nullable like
  // voiceTokenIssuer: absent in tests, null when Stripe is unconfigured — both chargeOnFile
  // procedures then answer PRECONDITION_FAILED rather than half-working.
  readonly cardChargeGateway?: CardChargeGateway | null;
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
  // A2P 10DLC registration (Twilio TrustHub + Messaging). Optional: when omitted (e.g. in tests,
  // or when TWILIO_PRIMARY_PROFILE_SID/account creds are unset) callers fall back to
  // LoggingA2pGateway, so registration self-disables to a logged stub rather than an error.
  readonly a2pGateway?: A2pGateway;
  /** Buys a new shop its business line at signup. Absent → the org is created without one and the
   *  Front Desk header shows its "Getting your number" state. */
  readonly numberProvisioner?: NumberProvisioner;
  /** Connects a newly bought number to the AI front desk. Absent → it will not answer calls. */
  readonly voiceRegistrar?: VoiceRegistrar;
  // Outbound voice origination (Twilio). null when the Twilio voice config is incomplete —
  // calls.place then returns PRECONDITION_FAILED. There is deliberately NO logging-stub
  // fallback: a call the office believes was placed but never happened is the exact bug this
  // feature exists to fix, so it must fail loudly rather than degrade.
  readonly callOriginator?: CallOriginator | null;
  // Mints the short-lived credential the BROWSER softphone authenticates with. null when the
  // Twilio API key / TwiML app config is incomplete — calling then falls back to the phone bridge
  // rather than failing, because the bridge is a complete feature on its own.
  readonly voiceTokenIssuer?: VoiceTokenIssuer | null;
  // The agent's model client (Anthropic). null when ANTHROPIC_API_KEY is unset — the AI agent
  // self-disables (its tRPC procedure returns PRECONDITION_FAILED).
  readonly llmClient: LlmClient | null;
  // Signup-time collaborators: verify a token WITHOUT requiring an existing principal, and provision
  // an org for a verified-but-unmapped auth user (SECURITY DEFINER seam).
  readonly tokenVerifier: TokenVerifier;
  readonly signupStore: Pick<SignupStore, "createOrgForUser">;
  // The self-serve signup gate. `signupsOpen` mirrors SIGNUPS_OPEN (absent = CLOSED: Mallet is
  // invite-only); `inviteGate` answers "does this email hold a pending invite?" — the one
  // authorization that still provisions while signups are closed. Both optional so the many
  // router-test stubs that never touch identity.signup don't have to carry them — the router
  // treats absence as closed, the safe direction.
  readonly signupsOpen?: boolean;
  readonly inviteGate?: Pick<SignupStore, "hasPendingInvite">;
  // QuickBooks Online OAuth. null when QBO_CLIENT_ID/SECRET/REDIRECT_URI are unset — the Settings
  // card renders "not configured" and the connect routes 503 rather than half-working.
  readonly qboOauthGateway?: QboOauthGateway | null;
  // Seals the QBO tokens at rest. null when QBO_TOKEN_ENCRYPTION_KEY is unset or malformed —
  // connecting then fail-closes, because storing a live refresh token in plaintext is not an
  // acceptable degradation (unlike comms, which safely degrade to a logging stub).
  readonly qboSecretBox?: SecretBox | null;
}
