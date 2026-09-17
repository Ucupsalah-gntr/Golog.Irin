import { describe, expect, it } from "vitest";
import { canTransitionRequestStatus, validateApprovedQuantity } from "../shared/request-rules";

describe("request workflow rules", () => {
  it("allows only valid request status transitions", () => {
    expect(canTransitionRequestStatus("submitted", "approved")).toBe(true);
    expect(canTransitionRequestStatus("approved", "ready")).toBe(true);
    expect(canTransitionRequestStatus("ready", "delivered")).toBe(false);
    expect(canTransitionRequestStatus("delivered", "received")).toBe(false);
    expect(canTransitionRequestStatus("received", "approved")).toBe(false);
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
