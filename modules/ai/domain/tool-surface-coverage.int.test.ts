import { describe, it, expect } from "vitest";
import { buildAgentTools } from "../infra/agent-tools";
import { describeProposal } from "./proposal-summary";
import { SYSTEM_PROMPT } from "./system-prompt";

/**
 * Three lists have to agree about what the assistant can do, and nothing made them:
 *
 *   1. the tools handed to the model,
 *   2. the capability inventory in the system prompt,
 *   3. the renderers that turn a proposed call into the sentence a person approves.
 *
 * They had drifted. `job_complete` — the commonest action in a field-service business — was in
 * (1) only. It was absent from the prompt's write-tool list, and the approval card rendered it
 * through the fallback as `Run job_complete with input {"jobId":"98add6a8-…"}`: the internal tool
 * name and a raw id, which is also what the prompt's own rule forbids showing a person.
 *
 * Twelve tools were in that state. These tests fail the build the next time one is added without
 * its prompt line and its summary, rather than leaving it to be discovered in use.
 */

const mutatingTools = buildAgentTools().filter((t) => t.mutating);

describe("the assistant's three tool lists agree", () => {
  it("has mutating tools to check (guards against an empty-list pass)", () => {
    expect(mutatingTools.length).toBeGreaterThan(15);
  });

  it("every mutating tool is listed in the system prompt", () => {
    const missing = mutatingTools.map((t) => t.name).filter((name) => !SYSTEM_PROMPT.includes(`- ${name} —`));
    expect(missing).toEqual([]);
  });

  it("every mutating tool has a real approval summary, not the JSON fallback", () => {
    // The fallback is `Run <tool> with input <json>`. Anything starting "Run <name>" never got a
    // renderer — that is precisely the card Owen was asked to approve.
    const unrendered = mutatingTools
      .filter((t) => describeProposal(t.name, { id: "x" }).startsWith(`Run ${t.name} `))
      .map((t) => t.name);
    expect(unrendered).toEqual([]);
  });

  it("no approval summary leaks a raw tool name into the sentence a person reads", () => {
    const leaks = mutatingTools.filter((t) => describeProposal(t.name, {}).includes(t.name)).map((t) => t.name);
    expect(leaks).toEqual([]);
  });
});
