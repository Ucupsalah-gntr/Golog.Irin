export type ImportItemRow = {
  rowNumber: number;
  sku: string;
  name: string;
  unit: string;
  category?: string;
  sourceWarehouseCode?: string;
  minStock: number;
  initialStockQty: number;
};

export type ImportRowError = {
  rowNumber: number;
  field: string;
  message: string;
};

export type ImportPreview = {
  rows: ImportItemRow[];
  errors: ImportRowError[];
  duplicateSkus: string[];
};

const aliases: Record<string, keyof Omit<ImportItemRow, "rowNumber">> = {
  sku: "sku",
  kode: "sku",
  kodebarang: "sku",
  kbarang: "sku",
  nama: "name",
  namabarang: "name",
  barang: "name",
  unit: "unit",
  satuan: "unit",
  kategori: "category",
  category: "category",
  gudang: "sourceWarehouseCode",
  gudangsumber: "sourceWarehouseCode",
  sumbergudang: "sourceWarehouseCode",
  kodegudang: "sourceWarehouseCode",
  kodegudangsumber: "sourceWarehouseCode",
  minstok: "minStock",
  stokminimum: "minStock",
  minimum: "minStock",
  stokawal: "initialStockQty",
  jumlahstokawal: "initialStockQty",
  saldoawal: "initialStockQty",
  initialstock: "initialStockQty",
  initialstockqty: "initialStockQty",
};

function key(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_\-./]+/g, "");
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function validateItemImport(inputRows: Array<Record<string, unknown>>): ImportPreview {
  const errors: ImportRowError[] = [];
  const rows: ImportItemRow[] = [];
  const seen = new Map<string, number>();
  if (!inputRows.length) return { rows, errors: [{ rowNumber: 1, field: "file", message: "File tidak memiliki baris data." }], duplicateSkus: [] };
  if (inputRows.length > 5000) {
    return {
      rows,
      errors: [{ rowNumber: 5002, field: "file", message: `File berisi ${inputRows.length.toLocaleString("id-ID")} baris data; batas impor adalah 5.000 baris.` }],
      duplicateSkus: [],
    };
  }

  const headers = Object.keys(inputRows[0] ?? {});
  const mappedHeaders = new Map(headers.map((header) => [header, aliases[key(header)]]));
  for (const required of ["sku", "name", "unit"] as const) {
    if (!Array.from(mappedHeaders.values()).includes(required)) errors.push({ rowNumber: 1, field: required, message: `Kolom wajib '${required}' tidak ditemukan.` });
  }
  if (errors.length) return { rows, errors, duplicateSkus: [] };

  inputRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const normalized: Record<string, unknown> = {};
    mappedHeaders.forEach((field, header) => { if (field) normalized[field] = raw[header]; });
    const sku = text(normalized.sku).toUpperCase();
    const name = text(normalized.name);
    const unit = text(normalized.unit);
    const category = text(normalized.category) || undefined;
    const sourceWarehouseCode = text(normalized.sourceWarehouseCode).toUpperCase() || undefined;
    const rawMin = normalized.minStock;
    const minStock = rawMin === undefined || rawMin === "" ? 0 : Number(rawMin);
    const rawInitialStock = normalized.initialStockQty;
    const initialStockQty = rawInitialStock === undefined || rawInitialStock === "" ? 0 : Number(rawInitialStock);

    if (!sku) errors.push({ rowNumber, field: "sku", message: "SKU wajib diisi." });
    else if (sku.length > 64) errors.push({ rowNumber, field: "sku", message: "SKU maksimal 64 karakter." });
    if (!name) errors.push({ rowNumber, field: "name", message: "Nama barang wajib diisi." });
    else if (name.length < 2) errors.push({ rowNumber, field: "name", message: "Nama barang minimal 2 karakter." });
    else if (name.length > 180) errors.push({ rowNumber, field: "name", message: "Nama barang maksimal 180 karakter." });
    if (!unit) errors.push({ rowNumber, field: "unit", message: "Satuan wajib diisi." });
    else if (unit.length > 32) errors.push({ rowNumber, field: "unit", message: "Satuan maksimal 32 karakter." });
    if (category && category.length > 100) errors.push({ rowNumber, field: "category", message: "Kategori maksimal 100 karakter." });
    if (sourceWarehouseCode && sourceWarehouseCode.length > 32) errors.push({ rowNumber, field: "sourceWarehouseCode", message: "Kode gudang sumber maksimal 32 karakter." });
    if (!Number.isInteger(minStock) || minStock < 0) errors.push({ rowNumber, field: "minStock", message: "Stok minimum harus bilangan bulat 0 atau lebih." });
    if (!Number.isInteger(initialStockQty) || initialStockQty < 0) errors.push({ rowNumber, field: "initialStockQty", message: "Stok awal harus bilangan bulat 0 atau lebih." });
    if (initialStockQty > 0 && !sourceWarehouseCode) errors.push({ rowNumber, field: "sourceWarehouseCode", message: "Gudang sumber wajib dipilih jika Stok Awal lebih dari 0." });
    if (sku && seen.has(sku)) errors.push({ rowNumber, field: "sku", message: `SKU duplikat dengan baris ${seen.get(sku)}.` });
    if (sku && !seen.has(sku)) seen.set(sku, rowNumber);
    rows.push({ rowNumber, sku, name, unit, category, sourceWarehouseCode, minStock, initialStockQty });
  });

  const counts = new Map<string, number>();
  rows.forEach((row) => { if (row.sku) counts.set(row.sku, (counts.get(row.sku) ?? 0) + 1); });
  return { rows, errors, duplicateSkus: Array.from(counts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku) };
}

export function importTemplateCsv() {
  // Header-only template avoids accidentally importing a sample item as live inventory.
  return "SKU,Nama Barang,Satuan,Kategori,Kode Gudang Sumber,Stok Minimum,Stok Awal\n";
}
