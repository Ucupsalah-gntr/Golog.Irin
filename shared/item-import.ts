export type ImportItemRow = {
  rowNumber: number;
  sku: string;
  name: string;
  unit: string;
  category?: string;
  sourceWarehouseCode?: string;
  minStock: number;
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
  minstok: "minStock",
  stokminimum: "minStock",
  minimum: "minStock",
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

    if (!sku) errors.push({ rowNumber, field: "sku", message: "SKU wajib diisi." });
    else if (sku.length > 64) errors.push({ rowNumber, field: "sku", message: "SKU maksimal 64 karakter." });
    if (!name) errors.push({ rowNumber, field: "name", message: "Nama barang wajib diisi." });
    else if (name.length > 180) errors.push({ rowNumber, field: "name", message: "Nama barang maksimal 180 karakter." });
    if (!unit) errors.push({ rowNumber, field: "unit", message: "Satuan wajib diisi." });
    if (!Number.isInteger(minStock) || minStock < 0) errors.push({ rowNumber, field: "minStock", message: "Stok minimum harus bilangan bulat 0 atau lebih." });
    if (sku && seen.has(sku)) errors.push({ rowNumber, field: "sku", message: `SKU duplikat dengan baris ${seen.get(sku)}.` });
    if (sku && !seen.has(sku)) seen.set(sku, rowNumber);
    rows.push({ rowNumber, sku, name, unit, category, sourceWarehouseCode, minStock });
  });

  const counts = new Map<string, number>();
  rows.forEach((row) => { if (row.sku) counts.set(row.sku, (counts.get(row.sku) ?? 0) + 1); });
  return { rows, errors, duplicateSkus: Array.from(counts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku) };
}

export function importTemplateCsv() {
  return "SKU,Nama Barang,Satuan,Kategori,Kode Gudang Sumber,Stok Minimum\nFAR-001,Contoh item,box,Alat kesehatan,FARMASI,10\n";
}
