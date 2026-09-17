import { describe, expect, it } from "vitest";
import { canReuseRequestDayLock, getJakartaDateKey } from "../shared/request-day-lock";

describe("daily room requester rules", () => {
  it("keeps the same requester eligible for a follow-up request", () => {
    expect(canReuseRequestDayLock(10, 10)).toBe(true);
    expect(canReuseRequestDayLock(10, 11)).toBe(false);
  });

  it("uses the Jakarta calendar date", () => {
    expect(getJakartaDateKey(new Date("2026-09-16T17:00:00.000Z"))).toBe("2026-09-17");
    expect(getJakartaDateKey(new Date("2026-09-17T16:59:59.000Z"))).toBe("2026-09-17");
  });
});
