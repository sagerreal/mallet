import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { LlmClient, LlmRequest, AssistantTurn } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";
import { draftChecklist } from "./draft-checklist";

const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 };

const toolUseTurn = (input: unknown): AssistantTurn => ({
  stopReason: "tool_use",
  blocks: [{ type: "tool_use", id: "tu_1", name: "submit_checklist", input }],
  usage,
});
const textTurn = (text: string): AssistantTurn => ({
  stopReason: "end_turn",
  blocks: [{ type: "text", text }],
  usage,
});

class FakeLlm implements LlmClient {
  public captured: LlmRequest | undefined;
  constructor(private readonly turn: AssistantTurn | (() => never)) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.captured = request;
    if (typeof this.turn === "function") return this.turn();
    return this.turn;
  }
}

const SAMPLE = {
  items: [
    { text: "Shut off gas and water, drain the old tank", type: "check" },
    { text: "Photo of the new unit installed and connected", type: "photo" },
    { text: "Pressure-test connections; confirm no leaks", type: "check" },
    { text: "Photo of the T&P discharge line routed to code", type: "photo" },
  ],
};

describe("draftChecklist", () => {
  it("returns items from the submit_checklist tool call", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE));
    const result = await draftChecklist(llm, "Water heater replacement");
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toEqual({ text: "Shut off gas and water, drain the old tank", type: "check" });
    expect(result.items.some((i) => i.type === "photo")).toBe(true);
  });

  it("passes the job type into the prompt + user message", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE));
    await draftChecklist(llm, "Sump pump install");
    expect(llm.captured?.system).toContain("Sump pump install");
    expect(JSON.stringify(llm.captured?.messages)).toContain("Sump pump install");
    // The single submit tool is offered.
    expect(llm.captured?.tools?.[0]?.name).toBe("submit_checklist");
  });

  it("drops an item with an invalid type (schema rejects the whole malformed payload → BAD_GATEWAY)", async () => {
    const llm = new FakeLlm(toolUseTurn({ items: [{ text: "x", type: "signature" }] }));
    await expect(draftChecklist(llm, "Job")).rejects.toBeInstanceOf(TRPCError);
  });

  it("caps at the max — an over-long list is rejected, not silently truncated", async () => {
    const tooMany = { items: Array.from({ length: 20 }, (_, i) => ({ text: `step ${i}`, type: "check" as const })) };
    const llm = new FakeLlm(toolUseTurn(tooMany));
    await expect(draftChecklist(llm, "Job")).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });

  it("falls back to embedded JSON in a text block", async () => {
    const llm = new FakeLlm(textTurn(`Here you go: ${JSON.stringify(SAMPLE)}`));
    const result = await draftChecklist(llm, "Drain cleaning");
    expect(result.items).toHaveLength(4);
  });

  it("throws BAD_GATEWAY when the model returns nothing parseable", async () => {
    const llm = new FakeLlm(textTurn("I'm not sure what you mean."));
    await expect(draftChecklist(llm, "Job")).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });

  it("propagates LlmError (router maps it)", async () => {
    const llm = new FakeLlm(() => {
      throw new LlmError(true, "rate limited");
    });
    await expect(draftChecklist(llm, "Job")).rejects.toBeInstanceOf(LlmError);
  });
});
