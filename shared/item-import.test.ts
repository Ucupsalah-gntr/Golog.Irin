import { describe, expect, it } from "vitest";
import { importTemplateCsv, validateItemImport } from "./item-import";

describe("master item import validation", () => {
  it("normalizes aliases and reads every field in the bundled CSV template", () => {
    const result = validateItemImport([{
      SKU: "far-001",
      "Nama Barang": "Sarung tangan",
      Satuan: "box",
      Kategori: "Alat kesehatan",
      "Kode Gudang Sumber": "farmasi",
      "Stok Minimum": 10,
      "Stok Awal": 24,
    }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      sku: "FAR-001",
      name: "Sarung tangan",
      unit: "box",
      category: "Alat kesehatan",
      sourceWarehouseCode: "FARMASI",
      minStock: 10,
      initialStockQty: 24,
    });
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

  it("rejects values that the import API would refuse", () => {
    const result = validateItemImport([{
      SKU: "FAR-001",
      Nama: "A",
      Satuan: "u".repeat(33),
      Kategori: "k".repeat(101),
      "Kode Gudang Sumber": "g".repeat(33),
      Minimum: 0,
    }]);

    expect(result.errors.some((error) => error.field === "name" && error.message.includes("minimal 2"))).toBe(true);
    expect(result.errors.some((error) => error.field === "unit" && error.message.includes("maksimal 32"))).toBe(true);
    expect(result.errors.some((error) => error.field === "category" && error.message.includes("maksimal 100"))).toBe(true);
    expect(result.errors.some((error) => error.field === "sourceWarehouseCode" && error.message.includes("maksimal 32"))).toBe(true);
  });

  it("accepts a minimum stock of zero and trims optional columns", () => {
    const result = validateItemImport([{
      SKU: " far-001 ",
      "Nama Barang": "Sarung tangan",
      Satuan: " box ",
      Kategori: " ",
      "Kode Gudang Sumber": " ",
      "Stok Minimum": 0,
    }]);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      sku: "FAR-001",
      name: "Sarung tangan",
      unit: "box",
      minStock: 0,
      category: undefined,
      sourceWarehouseCode: undefined,
    });
  });



  it("defaults blank opening stock to zero and rejects a positive opening stock without a source warehouse", () => {
    const blank = validateItemImport([{ SKU: "FAR-001", Nama: "Sarung tangan", Satuan: "box", "Stok Awal": "" }]);
    expect(blank.errors).toHaveLength(0);
    expect(blank.rows[0]?.initialStockQty).toBe(0);

    const missingWarehouse = validateItemImport([{ SKU: "FAR-002", Nama: "Masker medis", Satuan: "box", "Stok Awal": 12 }]);
    expect(missingWarehouse.errors.some((error) => error.field === "sourceWarehouseCode")).toBe(true);
  });

  it("rejects files larger than the server's 5,000-row limit", () => {
    const row = { SKU: "FAR-001", Nama: "Barang contoh", Satuan: "box", Minimum: 0 };
    const result = validateItemImport(Array.from({ length: 5001 }, () => row));
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.field).toBe("file");
    expect(result.errors[0]?.message).toContain("batas impor adalah 5.000");
  });

  it("provides a header-only template so example items cannot be imported accidentally", () => {
    const template = importTemplateCsv();
    expect(template).toContain("Kode Gudang Sumber");
    expect(template).toContain("Stok Minimum");
    expect(template).toContain("Stok Awal");
    expect(template).not.toContain("Contoh item");
    expect(template.trim().split(/\r?\n/)).toHaveLength(1);
  });
});
