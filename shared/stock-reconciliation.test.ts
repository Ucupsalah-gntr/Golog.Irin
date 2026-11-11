import { describe, expect, it } from "vitest";
import {
  calculateAdjustedStock,
  calculateStockDifference,
} from "./stock-reconciliation";

describe("stock reconciliation", () => {
  it("calculates positive and negative physical differences", () => {
    expect(calculateStockDifference(80, 84)).toBe(4);
    expect(calculateStockDifference(135, 130)).toBe(-5);
    expect(calculateStockDifference(40, 40)).toBe(0);
  });

  it("uses the physical count as the final balance", () => {
    expect(calculateAdjustedStock(80, 84)).toBe(84);
    expect(calculateAdjustedStock(135, 130)).toBe(130);
  });

  it("rejects invalid system or physical quantities", () => {
    expect(() => calculateStockDifference(-1, 2)).toThrow();
    expect(() => calculateStockDifference(2, -1)).toThrow();
    expect(() => calculateStockDifference(2.5, 3)).toThrow();
    expect(() => calculateStockDifference(2, 3.5)).toThrow();
  });
});
