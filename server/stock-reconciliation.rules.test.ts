import { describe, expect, it } from "vitest";
import { calculateAdjustedStock, calculateStockDifference } from "../shared/stock-reconciliation";

describe("stock reconciliation rules", () => {
  it("calculates a negative difference when physical stock is less", () => {
    expect(calculateStockDifference(135, 130)).toBe(-5);
    expect(calculateAdjustedStock(135, 130)).toBe(130);
  });

  it("calculates a positive difference when physical stock is more", () => {
    expect(calculateStockDifference(80, 84)).toBe(4);
    expect(calculateAdjustedStock(80, 84)).toBe(84);
  });

  it("returns zero when physical stock matches system stock", () => {
    expect(calculateStockDifference(50, 50)).toBe(0);
    expect(calculateAdjustedStock(50, 50)).toBe(50);
  });

  it("rejects invalid quantities", () => {
    expect(() => calculateStockDifference(-1, 3)).toThrow("System quantity is invalid");
    expect(() => calculateStockDifference(3, -1)).toThrow("Physical quantity is invalid");
    expect(() => calculateStockDifference(1.5, 2)).toThrow("System quantity is invalid");
  });
});
