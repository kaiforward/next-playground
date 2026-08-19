import { describe, expect, it } from "vitest";
import { formatDate, formatDuration, formatTimeOfDay, tickToDate } from "@/lib/utils/calendar";
import { TICKS_PER_DAY, TICKS_PER_MONTH, TICKS_PER_YEAR } from "@/lib/constants/calendar";

describe("tickToDate / formatDate", () => {
  it("renders tick 0 as the epoch's first day", () => {
    expect(formatDate(0)).toBe("2350.01.01");
    expect(formatTimeOfDay(0)).toBe("00:00");
  });

  it("steps the clock 6 in-world hours per tick and rolls the day on the 4th", () => {
    expect(formatTimeOfDay(1)).toBe("06:00");
    expect(formatTimeOfDay(2)).toBe("12:00");
    expect(formatTimeOfDay(3)).toBe("18:00");
    expect(tickToDate(TICKS_PER_DAY)).toMatchObject({ day: 2, hour: 0 });
  });

  it("rolls month and year at their boundaries, 1-based and zero-padded", () => {
    // Last tick of the epoch year vs the first of the next.
    expect(formatDate(TICKS_PER_YEAR - 1)).toBe("2350.12.30");
    expect(formatDate(TICKS_PER_YEAR)).toBe("2351.01.01");
    expect(formatDate(TICKS_PER_MONTH)).toBe("2350.02.01");
  });

  it("dates derive from the tick alone — a mid-game tick lands where 1,440 ticks/year puts it", () => {
    // 4,128 ticks = 2 years (2,880) + 10 months (1,200) + 12 days (48) exactly.
    expect(formatDate(4128)).toBe("2352.11.13");
  });
});

describe("formatDuration", () => {
  it("renders sub-day counts as exact hours, without the ≈", () => {
    expect(formatDuration(0)).toBe("0 hours");
    expect(formatDuration(1)).toBe("6 hours");
    expect(formatDuration(3)).toBe("18 hours");
  });

  it("scales days → months → years at the 45-day and 300-day breakpoints", () => {
    expect(formatDuration(4)).toBe("≈1 day");
    expect(formatDuration(12)).toBe("≈3 days");
    expect(formatDuration(44 * TICKS_PER_DAY)).toBe("≈44 days");
    expect(formatDuration(45 * TICKS_PER_DAY)).toBe("≈1.5 months");
    expect(formatDuration(299 * TICKS_PER_DAY)).toBe("≈10 months");
    expect(formatDuration(300 * TICKS_PER_DAY)).toBe("≈0.8 years");
  });

  it("keeps precision only where the figure is small: half-months under 3, tenths of a year under 3", () => {
    expect(formatDuration(75 * TICKS_PER_DAY)).toBe("≈2.5 months");
    expect(formatDuration(160 * TICKS_PER_DAY)).toBe("≈5 months");
    expect(formatDuration(2 * 360 * TICKS_PER_DAY)).toBe("≈2 years");
    expect(formatDuration(12 * 360 * TICKS_PER_DAY)).toBe("≈12 years");
  });
});
