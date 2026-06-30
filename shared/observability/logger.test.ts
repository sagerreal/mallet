import { describe, it, expect } from "vitest";
import { createLogger } from "./logger";
import { runWithContext } from "./request-context";

// Capture pino output by giving it a stream that collects each JSON line.
const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(JSON.parse(chunk));
    },
  };
  return { lines, stream };
};

describe("logger", () => {
  it("stamps log lines with the ambient request context", () => {
    const { lines, stream } = capture();
    const logger = createLogger(stream);
    runWithContext({ requestId: "req-1", orgId: "org-1", userId: "user-1" }, () => {
      logger.info("hello");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ request_id: "req-1", org_id: "org-1", user_id: "user-1" });
  });

  it("redacts PII and credentials", () => {
    const { lines, stream } = capture();
    const logger = createLogger(stream);
    runWithContext({ requestId: "req-2" }, () => {
      logger.info({ phone: "+15551234567", email: "a@b.com", token: "secret" }, "lead created");
    });
    expect(lines[0]?.phone).toBe("[redacted]");
    expect(lines[0]?.email).toBe("[redacted]");
    expect(lines[0]?.token).toBe("[redacted]");
  });

  it("omits context fields when outside a request scope", () => {
    const { lines, stream } = capture();
    const logger = createLogger(stream);
    logger.info("no context");
    expect(lines[0]?.request_id).toBeUndefined();
  });
});
