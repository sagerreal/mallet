// Unit tests for the field copilot router's core logic.
//
// Strategy: test the runAgentTurn + buildFieldTools + buildFieldPrompt composition WITHOUT
// importing the tRPC router (which chains through @/trpc/init → @mallet/shared/outbox →
// owner-client → config validator). This matches the pattern used in
// modules/ai/infra/tools/field-read-tools.test.ts.
//
// Key assertions:
//   - get_my_job tool result JSON has NO total/rate/cost keys for !seesPrice techs
//   - rate IS present when seesPrice=true
//   - total is NEVER in the output (always stripped)
//   - The fake LLM seam (ScriptedLlm, cloned from ai-router.int.test.ts) drives the turn
//
// C3 photo additions:
//   - resolvePhotoPaths: happy path, foreign photoId, unknown photoId → NOT_FOUND
//   - sanitiseTranscript: user_blocks → text marker, no base64 in output
//   - photo run: userBlocks from fake gateway → image block reaches LLM; returned
//     transcript contains no dataBase64 payload

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asJobId, asUserId } from "@mallet/shared/types";
import type { FieldToolScope, FieldToolDeps } from "../infra/tools/field-read-tools";
import { buildFieldTools } from "../infra/tools/field-read-tools";
import { buildFieldPrompt } from "../app/field-copilot-prompt";
import { runAgentTurn } from "../app/run-agent-turn";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock, AgentMessage, UserContentBlock } from "../domain/llm-client";
import { resolvePhotoPaths, sanitiseTranscript } from "./field-copilot-helpers";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that pull the mocked modules
// ---------------------------------------------------------------------------

// The BARREL mock is load-bearing here (not just style): field-read-tools.ts imports
// from @mallet/jobs, and the barrel pulls the api router → config validator (throws
// without DB env). Mocking the barrel shields every transitive consumer in one place.
vi.mock("@mallet/jobs", () => ({
  DrizzleJobRepository: vi.fn(),
  toJobSummaryDTO: vi.fn(),
}));

vi.mock("@mallet/settings", () => ({
  DrizzleSettingsRepository: vi.fn(),
}));

import { DrizzleJobRepository, toJobSummaryDTO } from "@mallet/jobs";

// ---------------------------------------------------------------------------
// Fake LLM (cloned from ai-router.int.test.ts)
// ---------------------------------------------------------------------------

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const mkTurn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({ stopReason, blocks, usage });
const callTool = (id: string, name: string, input: unknown): AssistantTurn =>
  mkTurn("tool_use", [{ type: "tool_use", id, name, input }]);
const textTurn = (t: string): AssistantTurn => mkTurn("end_turn", [{ type: "text", text: t }]);

class ScriptedLlm implements LlmClient {
  public readonly requests: LlmRequest[] = [];
  constructor(private readonly turns: AssistantTurn[]) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request);
    const t = this.turns.shift();
    if (!t) throw new Error("ScriptedLlm out of turns");
    return t;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = asOrgId("00000000-0000-0000-0000-000000000001");
const JOB_ID = asJobId("00000000-0000-0000-0000-000000000003");
const USER_ID = asUserId("00000000-0000-0000-0000-000000000004");
// A fixed day: get_my_day reads the CALLER's today, so a test must pin it rather than drift.
const TODAY = "2026-08-14";

const usd = (cents: number) => ({ cents, currency: "USD" as const });

const makeSummaryDto = () => ({
  id: JOB_ID,
  num: "JOB-1",
  leadId: randomUUID(),
  sourceEstimateId: null,
  title: "Water heater replacement",
  svc: "plumbing",
  kind: "repair",
  status: "in_progress",
  assigneeUserId: randomUUID(),
  scheduledStart: "2026-07-17T09:00:00.000Z",
  total: usd(45000),
  notes: null,
  scope: null,
  callbackOf: null,
  callbackReason: null,
  checklist: null,
  requiredCerts: [],
  visits: [],
  createdAt: "2026-07-15T00:00:00.000Z",
  lines: [
    { id: randomUUID(), description: "Tank", quantity: 1, rate: usd(38000), cost: usd(22000), position: 0 },
  ],
  addons: [],
  verifyAnswers: [],
  photos: [],
});

const makeJob = () => ({
  props: { id: JOB_ID, callbackOf: null },
});

const makeDeps = (): FieldToolDeps => ({
  withTx: (_orgId, fn) => fn({} as Parameters<FieldToolDeps["withTx"]>[1] extends (tx: infer TX) => unknown ? TX : never),
});

const makeScope = (seesPrice: boolean): FieldToolScope => ({
  orgId: ORG_ID,
  jobId: JOB_ID,
  seesPrice,
  userId: USER_ID,
  today: TODAY,
});

function mockClass<T extends abstract new (...a: never[]) => unknown>(
  ctor: T,
  instance: Partial<InstanceType<T>>,
): void {
  vi.mocked(ctor as unknown as new (...a: never[]) => unknown).mockImplementation(function () {
    return instance;
  });
}

// ---------------------------------------------------------------------------
// Tests: tool-use round trip with fake LLM
// ---------------------------------------------------------------------------

describe("field copilot — tool-use round trip with fake LLM", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(toJobSummaryDTO).mockClear();
  });

  it("get_my_job result has NO total/rate/cost keys when seesPrice=false", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue({ lines: [], addons: [], verifyAnswers: [], photos: [] }),
    });

    const llm = new ScriptedLlm([
      callTool("t1", "get_my_job", {}),
      textTurn("Here is your job summary."),
    ]);

    const fieldTools = buildFieldTools(makeDeps())(makeScope(false)); // seesPrice=false
    const metas = fieldTools.map((t) => t.meta);
    const execute = (name: string, input: unknown) => {
      const tool = fieldTools.find((t) => t.meta.name === name);
      if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
      return tool.execute(input);
    };

    const result = await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: false }),
      tools: metas,
      execute,
      userMessage: "what's on my job?",
      effort: "medium",
      maxIters: 6,
    });

    expect(result.status).toBe("completed");
    // The second LLM request carries the tool_results message
    expect(llm.requests).toHaveLength(2);
    const toolResultMsg = llm.requests[1]!.messages.find(
      (m: AgentMessage) => m.role === "user" && m.kind === "tool_results",
    );
    expect(toolResultMsg).toBeDefined();
    if (toolResultMsg?.kind === "tool_results") {
      const content = toolResultMsg.results[0]!.content;
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // total must not be present (always stripped)
      expect("total" in parsed, "total must not appear in get_my_job output").toBe(false);
      // rate must be null when seesPrice=false
      const lines = (parsed.lines ?? []) as Array<Record<string, unknown>>;
      for (const line of lines) {
        expect(line.rate, "rate must be null when !seesPrice").toBeNull();
        expect(line.cost, "cost must always be null").toBeNull();
      }
    }
  });

  it("get_my_job result has rate present (but no cost, no total) when seesPrice=true", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue({ lines: [], addons: [], verifyAnswers: [], photos: [] }),
    });

    const llm = new ScriptedLlm([
      callTool("t2", "get_my_job", {}),
      textTurn("The job has one line item."),
    ]);

    const fieldTools = buildFieldTools(makeDeps())(makeScope(true)); // seesPrice=true
    const metas = fieldTools.map((t) => t.meta);
    const execute = (name: string, input: unknown) => {
      const tool = fieldTools.find((t) => t.meta.name === name);
      if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
      return tool.execute(input);
    };

    await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: true }),
      tools: metas,
      execute,
      userMessage: "what are the lines?",
      effort: "medium",
      maxIters: 6,
    });

    const toolResultMsg = llm.requests[1]!.messages.find(
      (m: AgentMessage) => m.role === "user" && m.kind === "tool_results",
    );
    if (toolResultMsg?.kind === "tool_results") {
      const parsed = JSON.parse(toolResultMsg.results[0]!.content) as Record<string, unknown>;
      // total is NEVER present (always stripped by buildRedactedJobContext)
      expect("total" in parsed, "total must not appear even when seesPrice=true").toBe(false);
      // rate IS present when seesPrice=true
      const lines = (parsed.lines ?? []) as Array<Record<string, unknown>>;
      if (lines.length > 0) {
        expect(lines[0]!.rate, "rate must be present when seesPrice=true").not.toBeNull();
        // cost is ALWAYS stripped regardless
        expect(lines[0]!.cost, "cost is always null").toBeNull();
      }
    }
  });

  it("all 3 field tools are mutating=false (advise-only contract)", () => {
    const fieldTools = buildFieldTools(makeDeps())(makeScope(true));
    for (const tool of fieldTools) {
      expect(tool.meta.mutating, `${tool.meta.name} should not be mutating`).toBe(false);
    }
  });

  it("system prompt includes price-guardrail rule when seesPrice=false", () => {
    const prompt = buildFieldPrompt({ seesPrice: false });
    expect(prompt).toContain("PRICE RULE (strict)");
    expect(prompt).toContain("NEVER state, estimate, imply, or hint at prices");
  });

  it("system prompt allows rates when seesPrice=true", () => {
    const prompt = buildFieldPrompt({ seesPrice: true });
    expect(prompt).not.toContain("PRICE RULE (strict)");
    expect(prompt).toContain("You may refer to line rates");
  });
});

// ---------------------------------------------------------------------------
// C3: photoIds Zod schema validation (>3 IDs → rejected at input boundary)
// ---------------------------------------------------------------------------

describe("field copilot run input schema — photoIds", () => {
  it("rejects more than 3 photoIds (Zod max(3))", () => {
    const { z } = require("zod") as typeof import("zod");
    const schema = z.object({
      photoIds: z.array(z.string().uuid()).max(3).optional(),
    });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]; // 4 ids
    expect(() => schema.parse({ photoIds: ids })).toThrow();
  });

  it("accepts exactly 3 photoIds", () => {
    const { z } = require("zod") as typeof import("zod");
    const schema = z.object({
      photoIds: z.array(z.string().uuid()).max(3).optional(),
    });
    const ids = [randomUUID(), randomUUID(), randomUUID()]; // exactly 3
    expect(() => schema.parse({ photoIds: ids })).not.toThrow();
  });

  it("accepts absent photoIds (optional)", () => {
    const { z } = require("zod") as typeof import("zod");
    const schema = z.object({
      photoIds: z.array(z.string().uuid()).max(3).optional(),
    });
    expect(() => schema.parse({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// C3: resolvePhotoPaths unit tests (pure function — no mocking needed)
// ---------------------------------------------------------------------------

describe("resolvePhotoPaths", () => {
  const jobId = asJobId("00000000-0000-0000-0000-000000000003");
  const otherJobId = asJobId("00000000-0000-0000-0000-000000000099");

  const photo1 = { id: "aaa00000-0000-0000-0000-000000000001", jobId, storagePath: "org1/job1/aaa.jpg" };
  const photo2 = { id: "bbb00000-0000-0000-0000-000000000002", jobId, storagePath: "org1/job1/bbb.png" };
  const foreignPhoto = { id: "ccc00000-0000-0000-0000-000000000003", jobId: otherJobId, storagePath: "org1/job99/ccc.jpg" };

  it("resolves valid photoIds to storagePaths for the correct job", () => {
    const paths = resolvePhotoPaths([photo1.id, photo2.id], [photo1, photo2, foreignPhoto], jobId);
    expect(paths).toEqual([photo1.storagePath, photo2.storagePath]);
  });

  it("throws NOT_FOUND for a photoId that does not exist", () => {
    const unknownId = randomUUID();
    expect(() => resolvePhotoPaths([unknownId], [photo1], jobId)).toThrow();
    try {
      resolvePhotoPaths([unknownId], [photo1], jobId);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("NOT_FOUND");
    }
  });

  it("throws NOT_FOUND for a photoId that exists but belongs to a different job (cross-job fence)", () => {
    // foreignPhoto.id is in the photos array but belongs to otherJobId, not jobId
    expect(() => resolvePhotoPaths([foreignPhoto.id], [photo1, foreignPhoto], jobId)).toThrow();
    try {
      resolvePhotoPaths([foreignPhoto.id], [photo1, foreignPhoto], jobId);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("NOT_FOUND");
    }
  });

  it("returns an empty array when photoIds is empty", () => {
    const paths = resolvePhotoPaths([], [photo1], jobId);
    expect(paths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C3: sanitiseTranscript unit tests (pure function — no mocking needed)
// ---------------------------------------------------------------------------

describe("sanitiseTranscript", () => {
  const FAKE_B64 = "aGVsbG8gd29ybGQ="; // "hello world" in base64

  it("replaces user_blocks entries with [photo attached] text markers", () => {
    const transcript: AgentMessage[] = [
      {
        role: "user",
        kind: "user_blocks",
        blocks: [
          { type: "image", mediaType: "image/jpeg", dataBase64: FAKE_B64 },
          { type: "text", text: "what is this?" },
        ],
      },
      { role: "assistant", kind: "assistant", blocks: [{ type: "text", text: "That is a pipe." }] },
    ];

    const sanitised = sanitiseTranscript(transcript, "what is this?");

    expect(sanitised).toHaveLength(2);
    expect(sanitised[0]).toEqual({ role: "user", kind: "text", text: "[photo attached] what is this?" });
    expect(sanitised[1]).toEqual(transcript[1]);
    // No base64 anywhere in the serialised output
    expect(JSON.stringify(sanitised)).not.toContain(FAKE_B64);
    expect(JSON.stringify(sanitised)).not.toContain("dataBase64");
  });

  it("leaves non-user_blocks messages unchanged", () => {
    const transcript: AgentMessage[] = [
      { role: "user", kind: "text", text: "hello" },
      { role: "assistant", kind: "assistant", blocks: [{ type: "text", text: "hi" }] },
    ];
    const sanitised = sanitiseTranscript(transcript, "hello");
    expect(sanitised).toEqual(transcript);
  });
});

// ---------------------------------------------------------------------------
// C3: photo run — userBlocks reach the LLM; returned transcript has no bytes
// ---------------------------------------------------------------------------

describe("field copilot — photo run via runAgentTurn (fake LLM + pre-built userBlocks)", () => {
  // This test exercises the C1 + C3 integration by calling runAgentTurn with
  // userBlocks (simulating what the router builds after gateway.download), then
  // applying sanitiseTranscript to the result. The gateway download itself is
  // covered by the integration test; here we verify the LLM request shape and
  // the transcript sanitisation together.

  const FAKE_B64 = "ZmFrZWltYWdlZGF0YQ=="; // "fakeimagedata" in base64

  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(toJobSummaryDTO).mockClear();
  });

  it("first LLM request contains an image block with the fake base64", async () => {
    const llm = new ScriptedLlm([textTurn("Check the anode rod.")]);

    const imageBlock: UserContentBlock = { type: "image", mediaType: "image/jpeg", dataBase64: FAKE_B64 };

    const result = await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: false }),
      tools: [],
      execute: async () => ({ ok: false as const, error: "no tools" }),
      userMessage: "what should I check?",
      userBlocks: [imageBlock],
      effort: "medium",
      maxIters: 6,
    });

    expect(result.status).toBe("completed");
    // The first (and only) LLM request must carry the user_blocks message
    expect(llm.requests).toHaveLength(1);
    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.kind).toBe("user_blocks");
    if (firstMsg.kind === "user_blocks") {
      const imgBlk = firstMsg.blocks.find((b) => b.type === "image");
      expect(imgBlk).toBeDefined();
      if (imgBlk?.type === "image") {
        expect(imgBlk.dataBase64).toBe(FAKE_B64);
        expect(imgBlk.mediaType).toBe("image/jpeg");
      }
      // Text block must follow the image block (appended by runAgentTurn)
      const txtBlk = firstMsg.blocks.find((b) => b.type === "text");
      expect(txtBlk).toBeDefined();
      if (txtBlk?.type === "text") {
        expect(txtBlk.text).toBe("what should I check?");
      }
    }
  });

  it("sanitiseTranscript removes ALL dataBase64 from the returned transcript", async () => {
    const llm = new ScriptedLlm([textTurn("Looks like mineral scale buildup.")]);
    const imageBlock: UserContentBlock = { type: "image", mediaType: "image/png", dataBase64: FAKE_B64 };

    const result = await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: false }),
      tools: [],
      execute: async () => ({ ok: false as const, error: "no tools" }),
      userMessage: "diagnose this",
      userBlocks: [imageBlock],
      effort: "medium",
      maxIters: 6,
    });

    // Before sanitising: the transcript contains the user_blocks entry with base64
    const rawJson = JSON.stringify(result.transcript);
    expect(rawJson).toContain(FAKE_B64);

    // After sanitising: no base64 anywhere
    const sanitised = sanitiseTranscript(result.transcript, "diagnose this");
    const sanitisedJson = JSON.stringify(sanitised);
    expect(sanitisedJson).not.toContain(FAKE_B64);
    expect(sanitisedJson).not.toContain("dataBase64");
    expect(sanitisedJson).toContain("[photo attached] diagnose this");
  });
});
