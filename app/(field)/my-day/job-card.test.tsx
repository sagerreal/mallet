// @vitest-environment jsdom
/**
 * A card whose text does not fit.
 *
 * At 420px a long job title or customer name ran off the card with no ellipsis, and a note the
 * office typed at length pushed the action circles ten lines down — so the one row a technician
 * standing in a driveway actually presses was off the bottom of the card.
 *
 * The clamps are CSS (app/prototype.css). What is asserted here is the thing the CSS needs and the
 * markup kept getting wrong: the note is not the address. Sharing `.mdc-addr` meant clamping the
 * note clamped the address too, so neither was ever clamped.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCard } from "./job-card";
import type { DayCard } from "./visit-cards";

const card: DayCard = {
  key: "job-1:visit-1",
  jobId: "job-1",
  visitId: "visit-1",
  day: null,
  start: "08:30",
  step: 0,
  startedAt: null,
  completedAt: null,
};

const LONG_NOTE =
  "Gate code 4417 then round the back past the pool equipment, the shutoff is behind the water heater in the garage and the customer says the second bathroom has been backing up since Tuesday.";

const renderCard = (over: Partial<Parameters<typeof JobCard>[0]> = {}) =>
  render(
    <JobCard
      card={card}
      title="Water heater replacement"
      customerName="Dana Alvarez"
      addr="12 Bay Street, Oakland"
      callback={false}
      notes={null}
      isPending={false}
      onOpen={vi.fn()}
      onDirections={vi.fn()}
      onMyWay={null}
      onArrived={null}
      onDone={null}
      money={null}
      onCollect={null}
      onReceipt={null}
      {...over}
    />,
  );

describe("the visit card's text cannot push its own actions off the bottom", () => {
  it("gives the note its own class, so clamping it does not clamp the address", () => {
    renderCard({ notes: LONG_NOTE });
    const note = screen.getByText(LONG_NOTE);
    expect(note.className).toBe("mdc-note");
    expect(screen.getByText("12 Bay Street, Oakland").className).toBe("mdc-addr");
  });

  it("renders no note element at all when there is nothing to say", () => {
    renderCard({ notes: null });
    expect(document.querySelector(".mdc-note")).toBeNull();
  });
});
