import { describe, expect, it } from "vitest";
import { canTransitionRequestStatus, validateApprovedQuantity } from "../shared/request-rules";

describe("request workflow rules", () => {
  it("allows only valid request status transitions", () => {
    expect(canTransitionRequestStatus("submitted", "approved")).toBe(true);
    expect(canTransitionRequestStatus("submitted", "partial")).toBe(true);
    expect(canTransitionRequestStatus("submitted", "rejected")).toBe(true);
    expect(canTransitionRequestStatus("submitted", "ready")).toBe(false);
    expect(canTransitionRequestStatus("approved", "ready")).toBe(false);
    expect(canTransitionRequestStatus("partial", "ready")).toBe(false);
    expect(canTransitionRequestStatus("approved", "rejected")).toBe(false);
  });

  it("rejects an approved quantity greater than requested quantity", () => {
    expect(() => validateApprovedQuantity(5, 5)).not.toThrow();
    expect(() => validateApprovedQuantity(5, 4)).not.toThrow();
    expect(() => validateApprovedQuantity(5, 6)).toThrow("cannot exceed");
  });

  it("rejects invalid quantities", () => {
    expect(() => validateApprovedQuantity(5, -1)).toThrow("invalid");
    expect(() => validateApprovedQuantity(-1, 0)).toThrow("invalid");
  });
});
