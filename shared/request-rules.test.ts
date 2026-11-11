import { describe, expect, it } from "vitest";
import {
  canTransitionRequestStatus,
  validateApprovalStatus,
  validateApprovedQuantity,
} from "./request-rules";

describe("request status transitions", () => {
  it("allows only submitted requests to be decided", () => {
    expect(canTransitionRequestStatus("submitted", "approved")).toBe(true);
    expect(canTransitionRequestStatus("submitted", "partial")).toBe(true);
    expect(canTransitionRequestStatus("submitted", "rejected")).toBe(true);
    expect(canTransitionRequestStatus("approved", "partial")).toBe(false);
    expect(canTransitionRequestStatus("partial", "approved")).toBe(false);
    expect(canTransitionRequestStatus("rejected", "approved")).toBe(false);
  });
});

describe("approved quantities", () => {
  it("rejects quantities above the requested amount", () => {
    expect(() => validateApprovedQuantity(5, 6)).toThrow();
    expect(() => validateApprovedQuantity(5, -1)).toThrow();
    expect(() => validateApprovedQuantity(5, 1.5)).toThrow();
  });

  it("requires every requested quantity for full approval", () => {
    expect(() => validateApprovalStatus("approved", [
      { requestedQty: 5, approvedQty: 5 },
      { requestedQty: 3, approvedQty: 3 },
    ])).not.toThrow();

    expect(() => validateApprovalStatus("approved", [
      { requestedQty: 5, approvedQty: 4 },
    ])).toThrow();
  });

  it("requires a real shortfall for partial approval", () => {
    expect(() => validateApprovalStatus("partial", [
      { requestedQty: 5, approvedQty: 3 },
      { requestedQty: 3, approvedQty: 3 },
    ])).not.toThrow();

    expect(() => validateApprovalStatus("partial", [
      { requestedQty: 5, approvedQty: 5 },
    ])).toThrow();
  });
});
