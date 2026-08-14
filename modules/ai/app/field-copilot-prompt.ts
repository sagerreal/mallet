// Field copilot system prompt.
//
// FOUND WORK marker contract (canonical definition — PR3 UI parses this format):
//   When the copilot identifies work beyond the original job scope, it ends its reply with:
//
//     FOUND WORK: {description}
//
//   Rules enforced by the prompt (and asserted in tests):
//   - At most ONE marker per reply.
//   - description is ≤ 80 characters.
//   - description must NOT include prices or dollar amounts when seesPrice === false.
//   - The marker is a standalone line at the end of the response.
//   - The UI strips the marker line and renders it as a one-tap "Add to change order" card
//     (the tap stages a proposed add-on; the office OKs it and the next change order rides it).

// ---------------------------------------------------------------------------
// Prompt input
// ---------------------------------------------------------------------------

export interface BuildFieldPromptOptions {
  /** Whether the tech can see prices (org's techSeesPrice setting). */
  readonly seesPrice: boolean;
  /** Tech's display name — included in the greeting when provided. */
  readonly techName?: string;
  /**
   * Is a specific job in scope for this conversation?
   *
   * The Ask tab is a general chat: a tech opens it between calls, in the van, or before the
   * first job of the day, and asks anything. With no job there is no `get_my_job` and no
   * `get_callback_history` — instructing the model to "call get_my_job first" would send it
   * after a tool that is not in its registry, and telling it the advice is "grounded in THIS
   * job" would make it answer as though it could see one.
   *
   * Defaults true: the in-job conversation is the older caller and its prompt does not change.
   */
  readonly hasJob?: boolean;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the field copilot's system prompt.
 *
 * The prompt is intentionally concise: the job context lives in tool results, not the
 * system prompt (keeping the system prompt byte-stable across tenants for cache reuse).
 *
 * Price guardrail:
 *   When seesPrice === false, the prompt instructs the model to NEVER state, estimate,
 *   or imply prices — mirroring the front-desk price guardrail discipline. The tool
 *   registry enforces redaction on the data side; the prompt enforces it on the
 *   generation side.
 *
 * Safety-first escalation:
 *   Gas and electrical hazards → stop-and-escalate language. No guessing on life-safety
 *   systems. The model cites the job's checklist and scope when answering.
 *
 * Found work marker:
 *   When the tech finds work beyond the job scope, end with:
 *     FOUND WORK: {description ≤ 80 chars}
 *   One per reply max. The PR3 UI parses this line to render the one-tap card.
 *   See top-of-file contract comment for full rules.
 */
export const buildFieldPrompt = ({ seesPrice, techName, hasJob = true }: BuildFieldPromptOptions): string => {
  const who = techName ? `${techName}, a field technician` : "a field technician";
  const greeting = hasJob
    ? `You are the AI copilot assisting ${who} currently on a job.`
    : `You are the AI copilot assisting ${who}. No specific job is open — they are asking a general question.`;

  const priceRule = seesPrice
    ? "You may refer to line rates when they appear in job context."
    : "PRICE RULE (strict): you must NEVER state, estimate, imply, or hint at prices, costs, or dollar amounts in any form. The org has disabled price visibility for techs. This is a hard rule — do not round-trip prices through descriptions, comparisons, or any other form.";

  // The two workflows differ only in which tools exist. Everything below — safety, found work,
  // the price rule, tone — is identical, because none of it depends on a job being open.
  const grounding = hasJob
    ? [
        "Your advice is grounded in THIS job — its scope, checklist, notes, and what the office sold. Call get_my_job first.",
        "",
        "## Workflow",
        "1. Call get_my_job at the start of every conversation to load the job's context.",
        "2. Call get_org_service_context when the tech asks about what services the org provides or what certs are required.",
        "3. Call get_callback_history if the tech mentions a repeat visit, a previous problem, or asks why they are back.",
        "4. Answer using the job's checklist items, scope, and notes. Cite the relevant checklist step or scope line when it applies.",
      ]
    : [
        "Answer from trade knowledge and what you can learn about this shop. There is NO job open, so do not ask which job they mean and do not claim to see a scope, a checklist or a customer — you cannot.",
        "",
        "## Workflow",
        "1. Call get_org_service_context when the question touches what this shop offers, what it charges for, or what certs it requires.",
        "2. Otherwise answer directly from trade knowledge — codes, diagnostics, procedure, materials.",
        "3. If the answer genuinely depends on the specific job, say so in one line and tell them to open the job and ask again there.",
      ];

  return [
    greeting,
    ...grounding,
    "",
    "## Safety — gas and electrical",
    "For any gas leak, gas odor, carbon monoxide concern, or active electrical hazard:",
    "- STOP. Do not attempt diagnosis or repair.",
    "- Tell the tech to evacuate the area if unsafe.",
    "- Instruct: shut off gas at the meter or kill the breaker only if it is safe to do so.",
    "- Escalate: call the utility company and notify the office immediately.",
    "Never provide step-by-step guidance on live gas or live electrical systems.",
    "",
    ...(hasJob
      ? [
          "## Checklist discipline",
          "When a checklist step is present, remind the tech to complete it if relevant to their question.",
          "If this is a callback job (get_callback_history), highlight the steps missed on the original job.",
          "",
        ]
      : []),
    // FOUND WORK stages a proposed add-on against a job. With no job open there is nothing for
    // the office to attach it to, so the marker is withheld rather than emitted and dropped.
    ...(hasJob
      ? [
          "## Found work",
          "When the tech describes work that appears to be outside the original scope:",
          "- Confirm whether it is truly beyond scope using the job's scope and checklist.",
          "- If yes, advise the tech to pause on that item and notify the office.",
          `- End your reply with this exact line (one per reply max, description ≤ 80 chars${seesPrice ? "" : ", no prices"}):`,
          "  FOUND WORK: {short description of the additional work found}",
          "",
        ]
      : []),
    priceRule,
    "",
    "## Tone",
    "Be direct and brief — the tech is on-site and needs fast, actionable answers. No filler phrases.",
    "Speak to the trade: assume basic craft knowledge, do not over-explain standard procedures.",
    "PLAIN TEXT ONLY: replies render on a phone screen with no markdown — never use asterisks, headers, or backticks; use short lines and simple dashes for lists.",
  ].join("\n");
};
