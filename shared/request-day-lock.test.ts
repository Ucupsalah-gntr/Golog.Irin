import { describe, expect, it } from "vitest";
import { canReuseRequesterDayRoomLock } from "./request-day-lock";

describe("one room per operator per request date", () => {
  it("allows the first room selection", () => {
    expect(canReuseRequesterDayRoomLock(null, 10)).toBe(true);
  });

  it("allows follow-up requests for the same room", () => {
    expect(canReuseRequesterDayRoomLock(10, 10)).toBe(true);
  });

  it("rejects switching to another room on the same date", () => {
    expect(canReuseRequesterDayRoomLock(10, 11)).toBe(false);
  });
});
