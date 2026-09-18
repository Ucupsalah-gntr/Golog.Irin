import { describe, expect, it } from "vitest";
import { validateItemImport } from "./item-import";

describe("master item import validation", () => {
  it("normalizes aliases and numeric minimum stock", () => {
    const result = validateItemImport([{ Kode: "far-001", "Nama Barang": "Sarung tangan", Satuan: "box", "Stok Minimum": 10 }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ sku: "FAR-001", name: "Sarung tangan", unit: "box", minStock: 10 });
  });

  it("rejects missing required columns", () => {
    const result = validateItemImport([{ SKU: "FAR-001" }]);
    expect(result.errors.map((error) => error.field)).toEqual(expect.arrayContaining(["name", "unit"]));
  });

  it("reports duplicate SKUs and invalid minimum stock", () => {
    const result = validateItemImport([
      { SKU: "FAR-001", Nama: "A", Satuan: "box", Minimum: 2 },
      { SKU: "far-001", Nama: "B", Satuan: "box", Minimum: -1 },
    ]);
    expect(result.duplicateSkus).toEqual(["FAR-001"]);
    expect(result.errors.some((error) => error.field === "sku" && error.message.includes("duplikat"))).toBe(true);
    expect(result.errors.some((error) => error.field === "minStock")).toBe(true);
  });
});
