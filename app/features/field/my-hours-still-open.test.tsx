// @vitest-environment jsdom
/**
 * The banner for a day left running. It exists because an open day cannot be approved, so the
 * omission has to stay loud — but it must never close the day by itself: hours nobody confirmed are
 * exactly the record that loses a wage claim.
 *
 * The case pinned hardest here is the one that made it look broken: with nothing to suggest, the
 * banner opened with a RED SENTENCE accusing the technician of an empty field he had not touched.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StillOpenBanner } from "./my-hours-still-open";
import type { MyHoursEntry } from "./my-hours-derive";

const OPEN: MyHoursEntry = {
  id: "open-1",
  techUserId: "11111111-1111-1111-1111-111111111111",
  jobId: null,
  workDate: "2026-07-01",
  kind: "shop",
  startTime: "09:52",
  endTime: null,
  minutes: null,
  note: "",
  src: "clock",
  status: "draft",
  running: true,
  approvedAt: null,
  createdAt: "2026-07-01T16:52:00.000Z",
};

const banner = (over: { suggestedEnd?: string | null; error?: string | null } = {}) => {
  const onEnd = vi.fn();
  render(
    <StillOpenBanner
      entry={OPEN}
      suggestedEnd={over.suggestedEnd ?? null}
      saving={false}
      error={over.error ?? null}
      onEnd={onEnd}
    />,
  );
  return { onEnd };
};

const EMPTY_FIELD_PROBLEM = "Set both a start and an end time.";

describe("with nothing to suggest", () => {
  it("opens the picker, so it never states a problem it offers no way to fix", () => {
    banner({ suggestedEnd: null });
    expect(screen.getByLabelText("End time")).toBeTruthy();
    expect(screen.getByText(/set the time yourself/i)).toBeTruthy();
  });

  it("does NOT accuse him of an empty field he has not touched", () => {
    banner({ suggestedEnd: null });
    expect(screen.queryByText(EMPTY_FIELD_PROBLEM)).toBeNull();
  });

  it("still refuses to submit nothing — the button carries that, not a red sentence", () => {
    banner({ suggestedEnd: null });
    expect(screen.getByRole("button", { name: "End my day" }).hasAttribute("disabled")).toBe(true);
  });

  it("speaks up once there IS something to correct", () => {
    banner({ suggestedEnd: null });
    // An end before the start is a real mistake, and it gets said out loud.
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "07:00" } });
    expect(screen.getByText("The end time has to be after the start time.")).toBeTruthy();
  });

  it("goes quiet again when he clears the field rather than leaving the accusation up", () => {
    banner({ suggestedEnd: null });
    const field = screen.getByLabelText("End time");
    fireEvent.change(field, { target: { value: "07:00" } });
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.queryByText(EMPTY_FIELD_PROBLEM)).toBeNull();
    expect(screen.queryByText("The end time has to be after the start time.")).toBeNull();
  });

  it("ends the day at the time he typed", () => {
    const { onEnd } = banner({ suggestedEnd: null });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "17:30" } });
    fireEvent.click(screen.getByRole("button", { name: "End my day" }));
    expect(onEnd).toHaveBeenCalledWith("17:30");
  });
});

describe("with a suggestion", () => {
  it("takes one tap to accept it, and names the time so he is not accepting blind", () => {
    const { onEnd } = banner({ suggestedEnd: "16:12" });
    fireEvent.click(screen.getByRole("button", { name: "End at 4:12p" }));
    expect(onEnd).toHaveBeenCalledWith("16:12");
  });

  it("keeps the picker out of the way until he asks for a different time", () => {
    banner({ suggestedEnd: "16:12" });
    expect(screen.queryByLabelText("End time")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use a different time" }));
    expect(screen.getByLabelText("End time")).toBeTruthy();
  });

  it("never closes the day on its own — nothing is submitted until he taps", () => {
    const { onEnd } = banner({ suggestedEnd: "16:12" });
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("a refusal from the server", () => {
  it("is shown verbatim rather than translated into something vaguer", () => {
    banner({ suggestedEnd: "16:12", error: "These hours are approved. Reopen the entry before changing it." });
    expect(
      screen.getByText("These hours are approved. Reopen the entry before changing it."),
    ).toBeTruthy();
  });
});
