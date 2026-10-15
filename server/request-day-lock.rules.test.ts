import { describe, expect, it } from "vitest";
import { canReuseRequestDayLock, getJakartaDateKey, addJakartaDays, isRequestDateWithinWindow } from "../shared/request-day-lock";

describe("daily room requester rules", () => {
  it("keeps the same requester eligible for a follow-up request", () => {
    expect(canReuseRequestDayLock(10, 10)).toBe(true);
    expect(canReuseRequestDayLock(10, 11)).toBe(false);
  });

  it("allows requests only from today through H+7", () => {
    expect(isRequestDateWithinWindow("2026-10-01", "2026-10-01")).toBe(true);
    expect(isRequestDateWithinWindow("2026-10-08", "2026-10-01")).toBe(true);
    expect(isRequestDateWithinWindow("2026-10-09", "2026-10-01")).toBe(false);
    expect(addJakartaDays("2026-10-01", 7)).toBe("2026-10-08");
  });

  it("uses the Jakarta calendar date", () => {
    expect(getJakartaDateKey(new Date("2026-09-16T17:00:00.000Z"))).toBe("2026-09-17");
    expect(getJakartaDateKey(new Date("2026-09-17T16:59:59.000Z"))).toBe("2026-09-17");
  });

  it("rejects impossible dates even when their string sorts inside the allowed window", () => {
    expect(isRequestDateWithinWindow("2026-10-32", "2026-10-25")).toBe(false);
    expect(isRequestDateWithinWindow("2026-02-29", "2026-02-27")).toBe(false);
    expect(() => addJakartaDays("2026-10-32", 1)).toThrow("Invalid Jakarta date");
  });

  it("accepts a real leap day", () => {
    expect(isRequestDateWithinWindow("2028-02-29", "2028-02-28")).toBe(true);
  });
});
