// @vitest-environment jsdom
/**
 * lib/haptics.test.ts
 *
 * Haptics is the clearest single difference between "a web page in an app icon"
 * and an app. There were zero haptic call sites before this.
 *
 * The port has three hard requirements, all tested here:
 *   1. it must be SILENT on the web — a browser has no haptics, and that is an
 *      absent capability, not a failure. This is the one place the no-silent-fail
 *      rule does not apply, so it is stated explicitly rather than left implied.
 *   2. it must never throw. The plugin rejects when the user has System Haptics
 *      off, or on a device without a Taptic Engine. A dead buzz must not break
 *      the write that triggered it.
 *   3. it must send the exact strings the native plugin expects. @capacitor/haptics
 *      declares ImpactStyle as "LIGHT"/"MEDIUM"/"HEAVY" and NotificationType as
 *      "SUCCESS"/"WARNING"/"ERROR". We call through window.Capacitor.Plugins
 *      directly (no @capacitor/core dependency in the web bundle), so nothing
 *      type-checks these for us — this test is the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { haptics } from "./haptics";

const impact = vi.fn(() => Promise.resolve());
const notification = vi.fn(() => Promise.resolve());

const installBridge = () => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    Plugins: { Haptics: { impact, notification } },
  };
};
const removeBridge = () => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
};

describe("haptics", () => {
  beforeEach(() => {
    impact.mockClear();
    notification.mockClear();
    installBridge();
  });
  afterEach(removeBridge);

  it("sends a LIGHT impact for a selection", () => {
    haptics.tap();
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("sends a MEDIUM impact when something was written", () => {
    haptics.commit();
    expect(impact).toHaveBeenCalledWith({ style: "MEDIUM" });
  });

  it("sends a SUCCESS notification for a completed task", () => {
    haptics.success();
    expect(notification).toHaveBeenCalledWith({ type: "SUCCESS" });
  });

  it("sends a WARNING notification when something needs attention", () => {
    haptics.warn();
    expect(notification).toHaveBeenCalledWith({ type: "WARNING" });
  });

  it("is silent on the web, where there is no bridge at all", () => {
    removeBridge();
    expect(() => {
      haptics.tap();
      haptics.commit();
      haptics.success();
      haptics.warn();
    }).not.toThrow();
    expect(impact).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });

  it("survives a bridge present but missing the Haptics plugin", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: {} };
    expect(() => haptics.commit()).not.toThrow();
  });

  it("swallows a rejecting plugin — System Haptics off must not break the write", async () => {
    impact.mockImplementationOnce(() => Promise.reject(new Error("haptics unavailable")));
    expect(() => haptics.commit()).not.toThrow();
    // let the rejected promise settle; an unhandled rejection would fail the run
    await new Promise((r) => setTimeout(r, 0));
  });
});
