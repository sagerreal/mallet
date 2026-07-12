import { describe, it, expect } from "vitest";
import { mergeSources, DEFAULT_SOURCES } from "./merge-sources";

describe("mergeSources", () => {
  it("returns defaults when custom list is empty", () => {
    const result = mergeSources(DEFAULT_SOURCES, []);
    expect(result.map((r) => r.label)).toEqual([...DEFAULT_SOURCES]);
  });

  it("appends a custom source that does not match any default", () => {
    const result = mergeSources(DEFAULT_SOURCES, [
      { id: "1", label: "Instagram" },
    ]);
    const labels = result.map((r) => r.label);
    expect(labels.at(-1)).toBe("Instagram");
    expect(labels.length).toBe(DEFAULT_SOURCES.length + 1);
  });

  it("does not duplicate a custom source that matches a default case-insensitively", () => {
    const result = mergeSources(DEFAULT_SOURCES, [
      { id: "2", label: "google" },
    ]);
    const googleCount = result.filter((r) => r.label.toLowerCase() === "google").length;
    expect(googleCount).toBe(1);
    expect(result.length).toBe(DEFAULT_SOURCES.length);
  });

  it("defaults always appear first", () => {
    const result = mergeSources(DEFAULT_SOURCES, [
      { id: "3", label: "Custom One" },
    ]);
    const labels = result.map((r) => r.label);
    DEFAULT_SOURCES.forEach((d, i) => {
      expect(labels[i]).toBe(d);
    });
  });

  it("handles multiple custom extras in insertion order", () => {
    const result = mergeSources(DEFAULT_SOURCES, [
      { id: "4", label: "Direct Mail" },
      { id: "5", label: "Radio" },
    ]);
    const labels = result.map((r) => r.label);
    expect(labels.at(-2)).toBe("Direct Mail");
    expect(labels.at(-1)).toBe("Radio");
  });
});
