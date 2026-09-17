import { describe, expect, it } from "vitest";
import { availableStock, isLowStock, signedMovement } from "../shared/inventory";

describe("inventory rules", () => {
  it("keeps inbound positive and outbound or adjustments negative", () => {
    expect(signedMovement("in", 12)).toBe(12);
    expect(signedMovement("out", 4)).toBe(-4);
    expect(signedMovement("adjustment", 3)).toBe(-3);
  });

  it("flags stock at or below minimum", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(4, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
  });

  it("never exposes negative available stock", () => {
    expect(availableStock(100, 30)).toBe(70);
    expect(availableStock(10, 12)).toBe(0);
  });

  it("rejects invalid negative quantities", () => {
    expect(() => signedMovement("in", -1)).toThrow("Quantity");
  });
});
