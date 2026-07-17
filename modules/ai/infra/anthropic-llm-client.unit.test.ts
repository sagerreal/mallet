import { describe, it, expect } from "vitest";
import { toMessageParam, toUserContentBlockParam } from "./anthropic-llm-client";
import type { AgentMessage, UserContentBlock } from "../domain/llm-client";

// Unit tests for the neutral AgentMessage → Anthropic MessageParam mapping.
// The live smoke test lives in anthropic-llm-client.int.test.ts (gated on AI_LIVE_TEST).

describe("toUserContentBlockParam", () => {
  it("maps a text block to an Anthropic text block", () => {
    const block: UserContentBlock = { type: "text", text: "hello" };
    const param = toUserContentBlockParam(block);
    expect(param).toEqual({ type: "text", text: "hello" });
  });

  it("maps an image block to the Anthropic base64 image shape", () => {
    const block: UserContentBlock = { type: "image", mediaType: "image/jpeg", dataBase64: "abc123==" };
    const param = toUserContentBlockParam(block);
    expect(param).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "abc123==" },
    });
  });

  it("passes through image/png mediaType unchanged", () => {
    const block: UserContentBlock = { type: "image", mediaType: "image/png", dataBase64: "png==" };
    const param = toUserContentBlockParam(block);
    expect(param).toMatchObject({ source: { media_type: "image/png", data: "png==" } });
  });

  it("passes through image/webp mediaType unchanged", () => {
    const block: UserContentBlock = { type: "image", mediaType: "image/webp", dataBase64: "webp==" };
    const param = toUserContentBlockParam(block);
    expect(param).toMatchObject({ source: { media_type: "image/webp", data: "webp==" } });
  });
});

describe("toMessageParam — user_blocks", () => {
  it("maps a user_blocks message with mixed image+text blocks to the Anthropic content array", () => {
    const msg: AgentMessage = {
      role: "user",
      kind: "user_blocks",
      blocks: [
        { type: "image", mediaType: "image/jpeg", dataBase64: "imgdata==" },
        { type: "text", text: "What is this?" },
      ],
    };
    const param = toMessageParam(msg);
    expect(param.role).toBe("user");
    expect(Array.isArray(param.content)).toBe(true);
    const content = param.content as Array<{ type: string; source?: { media_type: string; data: string; type: string }; text?: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "imgdata==" } });
    expect(content[1]).toEqual({ type: "text", text: "What is this?" });
  });

  it("does not disturb the existing user text branch (bare string content)", () => {
    const msg: AgentMessage = { role: "user", kind: "text", text: "hello" };
    const param = toMessageParam(msg);
    expect(param).toEqual({ role: "user", content: "hello" });
  });

  it("does not disturb the existing tool_results branch", () => {
    const msg: AgentMessage = {
      role: "user",
      kind: "tool_results",
      results: [{ toolUseId: "t1", content: "result", isError: false }],
    };
    const param = toMessageParam(msg);
    expect(param.role).toBe("user");
    expect(Array.isArray(param.content)).toBe(true);
    const content = param.content as Array<{ type: string; tool_use_id: string }>;
    expect(content[0]?.type).toBe("tool_result");
    expect(content[0]?.tool_use_id).toBe("t1");
  });
});
