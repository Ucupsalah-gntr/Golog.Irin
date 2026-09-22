import { getJakartaDateKey } from "./request-day-lock";

export type MonthlyPivotItem = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  minStock: number;
};

export type MonthlyPivotRoom = {
  id: number;
  code: string;
  name: string;
};

export type MonthlyPivotMovementRow = {
  movement: {
    itemId: number;
    roomId: number | null;
    movementType: "in" | "out" | "adjustment";
    quantity: number;
    occurredAt: string | Date;
  };
};

export type MonthlyPivotInput = {
  items: MonthlyPivotItem[];
  rooms: MonthlyPivotRoom[];
  openingWarehouse: Array<{ itemId: number; quantity: number }>;
  movements: MonthlyPivotMovementRow[];
};

export type ItemPivotRow = {
  itemId: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  minStock: number;
  sisaAwal: number;
  masukGudang: number;
  penyesuaianGudang: number;
  stokTersedia: number;
  /** Rekap distribusi mingguan (MG1-4), bukan jumlah order ruangan — lihat catatan di bawah. */
  mg: [number, number, number, number];
  perRoom: Record<number, number>;
  keluarTotal: number;
  sisaAkhir: number;
  isLowStock: boolean;
};

export type CategoryPivot = {
  category: string;
  rows: ItemPivotRow[];
};

export type MonthlyPivotResult = {
  categories: CategoryPivot[];
  rooms: MonthlyPivotRoom[];
};

const DEFAULT_CATEGORY = "Lainnya";

function weekIndexForDay(day: number): 0 | 1 | 2 | 3 {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

/**
 * Meringkas payload dari getMonthlyReportData() menjadi baris per barang,
 * dikelompokkan per kategori (RT / Farmasi / Kassa & Laborat, dst) dan
 * dipecah per ruangan. Ini "satu sumber kebenaran" pivot bulanan: dipakai
 * baik oleh tabel Ringkasan di layar maupun (nanti) export Excel, supaya
 * keduanya tidak pernah berbeda angka.
 *
 * Catatan desain yang disengaja: kolom `mg` (MG1-4) di sini adalah REKAP
 * DISTRIBUSI mingguan ke ruangan, bukan jumlah permintaan/order ruangan
 * seperti pada kolom "ORDER" di file Excel lama — di data historis kolom
 * order itu nyaris selalu kosong, sementara distribusi mingguan jauh lebih
 * berguna untuk dipantau kepala gudang. Kalau Anda tetap butuh rekap ORDER
 * asli, itu ada di tabel `requests`/`request_items`, bukan `stock_movements`,
 * dan perlu pivot terpisah.
 */
export function computeMonthlyPivot(input: MonthlyPivotInput): MonthlyPivotResult {
  const openingWarehouseMap = new Map<number, number>();
  for (const row of input.openingWarehouse) {
    openingWarehouseMap.set(Number(row.itemId), Number(row.quantity ?? 0));
  }

  const roomIds = input.rooms.map((room) => Number(room.id));

  const perItem = new Map<number, ItemPivotRow>();
  for (const item of input.items) {
    const itemId = Number(item.id);
    const perRoom: Record<number, number> = {};
    for (const roomId of roomIds) perRoom[roomId] = 0;
    perItem.set(itemId, {
      itemId,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      category: item.category?.trim() || DEFAULT_CATEGORY,
      minStock: item.minStock,
      sisaAwal: Number(openingWarehouseMap.get(itemId) ?? 0),
      masukGudang: 0,
      penyesuaianGudang: 0,
      stokTersedia: 0,
      mg: [0, 0, 0, 0],
      perRoom,
      keluarTotal: 0,
      sisaAkhir: 0,
      isLowStock: false,
    });
  }

  for (const row of input.movements) {
    const movement = row.movement;
    const itemId = Number(movement.itemId);
    const pivotRow = perItem.get(itemId);
    if (!pivotRow) continue;

    const roomId = movement.roomId === null ? null : Number(movement.roomId);
    const day = Number(getJakartaDateKey(new Date(movement.occurredAt)).slice(-2));

    if (roomId === null) {
      // Pergerakan di level Gudang Pusat: restock dari supplier atau penyesuaian umum.
      if (movement.movementType === "in") pivotRow.masukGudang += Math.abs(Number(movement.quantity));
      else if (movement.movementType === "adjustment") pivotRow.penyesuaianGudang += Number(movement.quantity);
      continue;
    }

    // Pergerakan ke ruangan tertentu. Distribusi dicatat sebagai movementType "in"
    // dengan roomId terisi (lihat pasangan entri di routers.ts requests.verify).
    if (movement.movementType !== "in") continue;
    const quantity = Math.abs(Number(movement.quantity));
    pivotRow.mg[weekIndexForDay(day)] += quantity;
    pivotRow.perRoom[roomId] = (pivotRow.perRoom[roomId] ?? 0) + quantity;
    pivotRow.keluarTotal += quantity;
  }

  for (const pivotRow of Array.from(perItem.values())) {
    pivotRow.stokTersedia = pivotRow.sisaAwal + pivotRow.masukGudang + pivotRow.penyesuaianGudang;
    pivotRow.sisaAkhir = pivotRow.stokTersedia - pivotRow.keluarTotal;
    pivotRow.isLowStock = pivotRow.sisaAkhir <= pivotRow.minStock;
  }

  const byCategory = new Map<string, ItemPivotRow[]>();
  for (const pivotRow of Array.from(perItem.values())) {
    const list = byCategory.get(pivotRow.category) ?? [];
    list.push(pivotRow);
    byCategory.set(pivotRow.category, list);
  }

  const categories = Array.from(byCategory.entries())
    .map(([category, rows]) => ({
      category,
      rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return { categories, rooms: input.rooms };
}
