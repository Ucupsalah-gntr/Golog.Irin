import { describe, expect, it } from "vitest";
import { computeMonthlyPivot } from "./monthly-pivot";

describe("computeMonthlyPivot", () => {
  const items = [
    { id: 1, sku: "FAR-001", name: "Alkohol swab", category: "Farmasi", unit: "pcs", minStock: 50 },
    { id: 2, sku: "RT-001", name: "Bolpoin", category: "RT", unit: "pcs", minStock: 5 },
  ];
  const rooms = [
    { id: 10, code: "ICU-GARUDA", name: "Garuda" },
    { id: 11, code: "ICCU", name: "ICCU" },
  ];

  it("mengelompokkan baris per kategori dan menghitung sisa akhir gudang", () => {
    const result = computeMonthlyPivot({
      items,
      rooms,
      openingWarehouse: [
        { itemId: 1, quantity: 900 },
        { itemId: 2, quantity: 12 },
      ],
      movements: [
        { movement: { itemId: 1, roomId: null, movementType: "in", quantity: 100, occurredAt: "2026-01-05" } },
        { movement: { itemId: 1, roomId: 10, movementType: "in", quantity: 100, occurredAt: "2026-01-05" } },
        { movement: { itemId: 1, roomId: 11, movementType: "in", quantity: 100, occurredAt: "2026-01-12" } },
        { movement: { itemId: 2, roomId: 10, movementType: "in", quantity: 2, occurredAt: "2026-01-20" } },
      ],
    });

    expect(result.categories.map((c) => c.category)).toEqual(["Farmasi", "RT"]);

    const farmasi = result.categories.find((c) => c.category === "Farmasi")!.rows[0];
    expect(farmasi.sisaAwal).toBe(900);
    expect(farmasi.masukGudang).toBe(100);
    expect(farmasi.stokTersedia).toBe(1000);
    expect(farmasi.perRoom[10]).toBe(100);
    expect(farmasi.perRoom[11]).toBe(100);
    expect(farmasi.keluarTotal).toBe(200);
    expect(farmasi.sisaAkhir).toBe(800);
    expect(farmasi.mg).toEqual([100, 100, 0, 0]);
    expect(farmasi.isLowStock).toBe(false);

    const rt = result.categories.find((c) => c.category === "RT")!.rows[0];
    expect(rt.stokTersedia).toBe(12);
    expect(rt.sisaAkhir).toBe(10);
    expect(rt.isLowStock).toBe(false);
  });

  it("menandai stok rendah saat sisa akhir turun ke atau di bawah stok minimum", () => {
    const result = computeMonthlyPivot({
      items: [{ id: 3, sku: "FAR-002", name: "Masker N95", category: "Farmasi", unit: "pcs", minStock: 20 }],
      rooms,
      openingWarehouse: [{ itemId: 3, quantity: 30 }],
      movements: [
        { movement: { itemId: 3, roomId: 10, movementType: "in", quantity: 15, occurredAt: "2026-01-03" } },
      ],
    });

    const row = result.categories[0].rows[0];
    expect(row.sisaAkhir).toBe(15);
    expect(row.isLowStock).toBe(true);
  });

  it("memakai kategori 'Lainnya' saat item tidak punya kategori", () => {
    const result = computeMonthlyPivot({
      items: [{ id: 4, sku: "X-1", name: "Barang tanpa kategori", category: null, unit: "pcs", minStock: 0 }],
      rooms: [],
      openingWarehouse: [],
      movements: [],
    });

    expect(result.categories[0].category).toBe("Lainnya");
  });
});
