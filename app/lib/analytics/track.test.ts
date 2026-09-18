// @vitest-environment jsdom
/**
 * The analytics layer, and the one thing it must never do: send anything when it is not configured.
 *
 * A local checkout, a preview build and this test run all have no key. Any one of them reaching the
 * real project poisons the numbers the product is steered by, so the guard is asserted rather than
 * assumed — and asserted at every entry point, because one unguarded export is all it takes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted because vi.mock's factory is lifted above every const in the file.
const { capture, identifyFn, group, reset, init } = vi.hoisted(() => ({
  capture: vi.fn(),
  identifyFn: vi.fn(),
  group: vi.fn(),
  reset: vi.fn(),
  init: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: { init, capture, identify: identifyFn, group, reset },
}));

import { track, identify, resetAnalytics, ORG_GROUP } from "./track";
import { ANALYTICS_EVENTS } from "./events";
import { startAnalytics, analyticsHost, INGEST_PATH } from "./posthog";

const KEY = "NEXT_PUBLIC_POSTHOG_KEY";
const HOST = "NEXT_PUBLIC_POSTHOG_HOST";

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env[KEY];
  delete process.env[HOST];
});

describe("with no key configured", () => {
  it("sends no event", () => {
    track(ANALYTICS_EVENTS.quoteSent, { lines: 3 });
    expect(capture).not.toHaveBeenCalled();
  });

  it("identifies nobody", () => {
    identify({ userId: "u1", orgId: "o1", role: "owner" });
    expect(identifyFn).not.toHaveBeenCalled();
    expect(group).not.toHaveBeenCalled();
  });

  it("does not reset", () => {
    resetAnalytics();
    expect(reset).not.toHaveBeenCalled();
  });

  it("does not initialise", () => {
    startAnalytics();
    expect(init).not.toHaveBeenCalled();
  });

  it("treats an EMPTY key as no key — a blank Vercel var is the commonest way this breaks", () => {
    process.env[KEY] = "";
    track(ANALYTICS_EVENTS.quoteSent);
    startAnalytics();
    expect(capture).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });
});

describe("with a key configured", () => {
  beforeEach(() => {
    process.env[KEY] = "phc_test";
  });

  it("sends the event and its properties", () => {
    track(ANALYTICS_EVENTS.paymentTaken, { cents: 12_500 });
    expect(capture).toHaveBeenCalledWith("payment_taken", { cents: 12_500 });
  });

  /**
   * The person AND their shop, together. "How many shops ever sent a quote" is the activation
   * question, and it is unanswerable from person events alone — so the group is not optional and
   * not left to each call site to remember.
   */
  it("identifies the person and groups them by shop", () => {
    identify({ userId: "u1", orgId: "o1", role: "tech" });
    expect(identifyFn).toHaveBeenCalledWith("u1", { role: "tech", org_id: "o1" });
    expect(group).toHaveBeenCalledWith(ORG_GROUP, "o1");
  });

  it("sends NO email and NO name — the id is the join key, and it joins where there is an audit trail", () => {
    identify({ userId: "u1", orgId: "o1", role: "owner" });
    const props = identifyFn.mock.calls[0]?.[1] ?? {};
    expect(Object.keys(props).sort()).toEqual(["org_id", "role"]);
  });

  it("resets on sign-out, so a shared van iPad does not inherit the last person", () => {
    resetAnalytics();
    expect(reset).toHaveBeenCalled();
  });
});

describe("configuration", () => {
  /**
   * A FRESH module each time. startAnalytics keeps a module-level `started` flag — React strict
   * mode mounts effects twice and a second init would double every event — so without the reset
   * only the first case in this block would ever see init called.
   */
  const freshInit = async (): Promise<Record<string, unknown>> => {
    vi.resetModules();
    process.env[KEY] = "phc_test";
    const mod = await import("./posthog");
    mod.startAnalytics();
    return (init.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
  };

  it("posts to our OWN origin, so a blocker cannot drop the request by hostname", async () => {
    expect(await freshInit()).toMatchObject({ api_host: INGEST_PATH });
  });

  it("turns autocapture OFF", async () => {
    // Autocapture records the text inside whatever was clicked, and nearly everything clickable
    // here has a customer inside it.
    expect(await freshInit()).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      person_profiles: "identified_only",
    });
  });

  /**
   * REPLAY IS ON, AND MASKED AT THE SOURCE. Masking happens in the browser before transmission, so
   * the unmasked pixels never leave the phone — it is not a display setting somebody can switch off
   * in PostHog later. `maskTextSelector: "*"` rather than a list of selectors: a list is a promise
   * to remember every future component that renders a customer, and that promise gets broken.
   */
  it("records sessions with every value and every character masked", async () => {
    const opts = await freshInit();
    expect(opts).toMatchObject({ disable_session_recording: false });
    expect(opts.session_recording).toMatchObject({
      maskAllInputs: true,
      maskTextSelector: "*",
      recordHeaders: false,
      recordBody: false,
    });
  });

  it("never records network bodies or headers — those are whole customer records", async () => {
    const rec = (await freshInit()).session_recording as Record<string, unknown>;
    expect(rec.recordBody).toBe(false);
    expect(rec.recordHeaders).toBe(false);
  });

  /**
   * THE THREE POSTHOG TURNS ON ITSELF. These are not SDK defaults — they arrive in the project's
   * remote config, and a fresh project shipped `autocaptureExceptions: true` and `heatmaps: true`,
   * which made the bundle download exception-autocapture.js and dead-clicks-autocapture.js.
   * Exception messages here name customers; heatmaps carry the surrounding DOM. Saying no
   * explicitly means a toggle in the PostHog UI cannot re-enable them behind the repository.
   */
  it("refuses the capture features PostHog enables by remote config", async () => {
    expect(await freshInit()).toMatchObject({
      capture_exceptions: false,
      enable_heatmaps: false,
      capture_dead_clicks: false,
    });
  });

  it("initialises only ONCE — strict mode mounts the effect twice", async () => {
    vi.resetModules();
    process.env[KEY] = "phc_test";
    const mod = await import("./posthog");
    mod.startAnalytics();
    mod.startAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("falls back to the US host and takes an override", () => {
    expect(analyticsHost()).toBe("https://us.i.posthog.com");
    process.env[HOST] = "https://eu.i.posthog.com";
    expect(analyticsHost()).toBe("https://eu.i.posthog.com");
  });
});
