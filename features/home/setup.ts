// Setup checklist derivation — PURE. Answers "how far along is this shop's setup?" from real
// state, in two tiers:
//   - "live": the shortest required path to the AHA (a working AI Front Desk that answered a
//     real call). Trade+services → office+hours → connect phone → first test call.
//   - "grow": everything crucial-but-not-day-one, deferred until after first value (pricebook,
//     lead marketplaces, website form, field crew).
// Every step is derived (no manual check-offs, so it can't lie), EXCEPT the phone-forwarding
// acknowledgment, which the app cannot sense (carrier-side forwarding) — so it carries an
// explicit `phoneAcked` flag the owner sets.
//
// Design driver (Userpilot benchmark, 188 B2B SaaS: ~19% avg / 10% median checklist
// completion): keep the REQUIRED path tiny and front-load value, so far more owners reach a
// live phone before the deferred "grow" steps ever matter.

export type SetupTier = "live" | "grow";

export type SetupStepKey =
  | "services"
  | "office"
  | "phone"
  | "test-call"
  | "pricebook"
  | "marketplaces"
  | "website-form"
  | "crew";

export interface SetupStep {
  key: SetupStepKey;
  tier: SetupTier;
  label: string;
  /** One short line shown under the label to orient a non-technical owner. Not helper-text noise —
   *  it names the payoff of the step. */
  blurb: string;
  done: boolean;
}

export interface SetupInputs {
  servicesCount: number;
  originAddress: string;
  /** owner acknowledged they forwarded their business line (localStorage — app can't sense it) */
  phoneAcked: boolean;
  /** a lead sourced from the AI Front Desk exists → a real call landed end-to-end (the AHA) */
  hasAiLead: boolean;
  pricebookCount: number;
  /** an Angi or Thumbtack inbound endpoint has been minted */
  hasMarketplace: boolean;
  /** the website request-form endpoint has been minted */
  hasWebsiteForm: boolean;
  hasFieldCrew: boolean;
}

export function deriveSetupSteps(i: SetupInputs): SetupStep[] {
  return [
    { key: "services", tier: "live", label: "Add your services", blurb: "What your AI can book and quote.", done: i.servicesCount > 0 },
    { key: "office", tier: "live", label: "Set your office & hours", blurb: "So it only books jobs you can reach.", done: i.originAddress.trim().length > 0 },
    { key: "phone", tier: "live", label: "Connect your phone", blurb: "Forward your line so the AI answers.", done: i.phoneAcked },
    { key: "test-call", tier: "live", label: "Make a test call", blurb: "Hear it book a job — your front desk is live.", done: i.hasAiLead },
    { key: "pricebook", tier: "grow", label: "Build your pricebook", blurb: "Turns visits into quotes fast.", done: i.pricebookCount > 0 },
    { key: "marketplaces", tier: "grow", label: "Connect lead marketplaces", blurb: "Pull Angi & Thumbtack leads in.", done: i.hasMarketplace },
    { key: "website-form", tier: "grow", label: "Add your website form", blurb: "Turn site visitors into leads.", done: i.hasWebsiteForm },
    { key: "crew", tier: "grow", label: "Add your field crew", blurb: "Book the nearest available tech.", done: i.hasFieldCrew },
  ];
}

export function stepsByTier(steps: readonly SetupStep[], tier: SetupTier): SetupStep[] {
  return steps.filter((s) => s.tier === tier);
}

export function tierComplete(steps: readonly SetupStep[], tier: SetupTier): boolean {
  const t = stepsByTier(steps, tier);
  return t.length > 0 && t.every((s) => s.done);
}

/** The whole card can retire only once BOTH tiers are fully done. */
export function setupComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((s) => s.done);
}

export function doneCount(steps: readonly SetupStep[]): number {
  return steps.filter((s) => s.done).length;
}
