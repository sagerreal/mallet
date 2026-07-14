// Tunable knobs for the Vapi voice front desk in ONE place (constants over magic values).
// The assistant builder reads these when composing the per-call assistant config; changing a
// value here is the single source of truth — never inline a literal at a call site.

// The LLM backing the voice agent. gpt-4o is the fast/proven default on Vapi today; revisit
// Anthropic once model availability on Vapi is verified. temperature 0.4 keeps the agent on-script
// (it must never improvise prices) while staying natural.
export const VOICE_MODEL = { provider: "openai", model: "gpt-4o", temperature: 0.4 } as const;

// The spoken voice. Vapi-native "Elliot" needs no extra provider key and sounds neutral/clear.
export const VOICE = { provider: "vapi", voiceId: "Elliot" } as const;

// Hard cap on call length — a runaway call burns minutes and money; 15 min covers any real intake.
export const MAX_CALL_MINUTES = 15;

// How many days ahead check_availability offers slots. 5 keeps the two-slot close near-term
// (customers want soon) without walking the whole calendar.
export const SLOT_LOOKAHEAD_DAYS = 5;

// Per-tool webhook budget. Vapi holds the caller while a tool runs; past this it speaks a fallback,
// so 10s bounds dead air on a slow DB while leaving room for the tenant tx to finish.
export const TOOL_TIMEOUT_S = 10;
