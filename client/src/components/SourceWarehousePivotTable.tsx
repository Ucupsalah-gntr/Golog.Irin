import { useMemo, useState } from "react";
import { ChevronRight, PackageSearch } from "lucide-react";
import { computeMonthlyPivot, type ItemPivotRow, type MonthlyPivotResult } from "@shared/monthly-pivot";

type SourceWarehousePivotTableProps = {
  report: {
    items: Array<{
      id: number;
      sku: string;
      name: string;
      category: string | null;
      unit: string;
      minStock: number;
      sourceWarehouseId?: number | null;
      sourceWarehouseName?: string | null;
      sourceWarehouseCode?: string | null;
    }>;
    rooms: Array<{
      id: number;
      code: string;
      name: string;
    }>;
    openingWarehouse: Array<{ itemId: number; quantity: number }>;
    movements: Array<{
      movement: {
        itemId: number;
        roomId: number | null;
        movementType: "in" | "out" | "adjustment";
        quantity: number;
        occurredAt: string | Date;
      };
    }>;
  };
};

type WarehouseGroup = {
  key: string;
  name: string;
  code: string;
  rows: Array<ItemPivotRow & { sourceWarehouseName: string; sourceWarehouseCode: string }>;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID").format(Number(value ?? 0));
}

function numberTone(value: number) {
  return value === 0 ? "text-slate-300" : "text-slate-700";
}

export default function SourceWarehousePivotTable({ report }: SourceWarehousePivotTableProps) {
  const pivot = useMemo<MonthlyPivotResult>(() => computeMonthlyPivot(report), [report]);
  const [activeWarehouse, setActiveWarehouse] = useState("");

  const itemById = useMemo(
    () => new Map(report.items.map((item) => [Number(item.id), item])),
    [report.items],
  );

  const groups = useMemo<WarehouseGroup[]>(() => {
    const byWarehouse = new Map<string, WarehouseGroup>();
    for (const row of pivot.categories.flatMap((category) => category.rows)) {
      const item = itemById.get(Number(row.itemId));
      const key = item?.sourceWarehouseId == null ? "unassigned" : String(item.sourceWarehouseId);
      const name = item?.sourceWarehouseName?.trim() || "Belum ditetapkan";
      const code = item?.sourceWarehouseCode?.trim() || "";
      const group = byWarehouse.get(key) ?? { key, name, code, rows: [] };
      group.rows.push({ ...row, sourceWarehouseName: name, sourceWarehouseCode: code });
      byWarehouse.set(key, group);
    }
    return Array.from(byWarehouse.values())
      .map((group) => ({ ...group, rows: group.rows.sort((a, b) => a.name.localeCompare(b.name, "id")) }))
      .sort((a, b) => {
        if (a.key === "unassigned") return 1;
        if (b.key === "unassigned") return -1;
        return a.name.localeCompare(b.name, "id");
      });
  }, [pivot.categories, itemById]);

  const active = useMemo(
    () => groups.find((group) => group.key === activeWarehouse) ?? groups[0] ?? null,
    [groups, activeWarehouse],
  );

  if (!groups.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex min-h-60 flex-col items-center justify-center px-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-slate-50 text-slate-400">
            <PackageSearch size={21} />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-700">Belum ada master barang</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
            Tambahkan barang aktif dan tetapkan gudang sumber untuk merangkum stok per gudang.
          </p>
        </div>
      </div>
    );
  }

  const totalLow = groups.reduce((sum, group) => sum + group.rows.filter((row) => row.isLowStock).length, 0);
  const activeLow = active?.rows.filter((row) => row.isLowStock).length ?? 0;

  function renderRow(row: WarehouseGroup["rows"][number], index: number) {
    const identityBg = row.isLowStock ? "bg-rose-50" : "bg-white";
    const sourceLabel = row.sourceWarehouseCode
      ? `${row.sourceWarehouseName} · ${row.sourceWarehouseCode}`
      : row.sourceWarehouseName;

    return (
      <tr key={row.itemId} className={row.isLowStock ? "bg-rose-50/70" : "bg-white"}>
        <td className={`sticky left-0 z-[3] w-12 min-w-12 border-b border-r border-slate-100 px-2 py-2.5 text-center text-xs ${identityBg}`}>
          {index + 1}
        </td>
        <td className={`sticky left-12 z-[3] min-w-[260px] border-b border-r border-slate-100 px-3 py-2.5 ${identityBg}`}>
          <div className="flex min-w-0 items-center gap-2">
            {row.isLowStock && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Di bawah atau sama dengan stok minimum" />}
            <div className="min-w-0">
              <p className={`truncate text-sm font-medium ${row.isLowStock ? "text-rose-900" : "text-slate-800"}`}>{row.name}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{row.sku} · {sourceLabel}</p>
            </div>
          </div>
        </td>
        <td className="min-w-[72px] border-b border-slate-100 px-3 py-2.5 text-center text-xs text-slate-500">{row.unit}</td>
        <td className={`min-w-[88px] border-b border-slate-100 px-3 py-2.5 text-right text-xs ${numberTone(row.sisaAwal)}`}>{formatNumber(row.sisaAwal)}</td>
        {row.mg.map((value, mgIndex) => (
          <td key={`mg-${mgIndex}`} className={`min-w-[64px] border-b border-slate-100 px-3 py-2.5 text-right text-xs ${numberTone(value)}`}>{formatNumber(value)}</td>
        ))}
        {pivot.rooms.map((room) => {
          const value = row.perRoom[room.id] ?? 0;
          return (
            <td key={room.id} className={`min-w-[76px] border-b border-slate-100 px-3 py-2.5 text-right text-xs ${numberTone(value)}`}>
              {formatNumber(value)}
            </td>
          );
        })}
        <td className="min-w-[82px] border-b border-slate-100 px-3 py-2.5 text-right text-xs font-medium text-slate-700">{formatNumber(row.keluarTotal)}</td>
        <td className={`sticky right-0 z-[2] min-w-[96px] border-b border-l border-slate-100 px-3 py-2.5 text-right text-sm font-semibold shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)] ${row.isLowStock ? "bg-rose-50 text-rose-700" : "bg-white text-slate-900"}`}>{formatNumber(row.sisaAkhir)}</td>
      </tr>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Rekap BMHP</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-800">Ringkasan stok & distribusi per gudang sumber</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Pilih gudang sumber untuk melihat saldo awal, distribusi mingguan, distribusi per ruangan, dan sisa akhir barang.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{groups.length} gudang sumber</span>
            <span>·</span>
            <span>{pivot.rooms.length} ruangan</span>
            {totalLow > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-rose-600">{totalLow} stok rendah</span>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {groups.map((group) => {
            const selected = group.key === active?.key;
            const low = group.rows.filter((row) => row.isLowStock).length;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => setActiveWarehouse(group.key)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${selected
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
              >
                {group.name}
                {group.code && <span className={`ml-1 ${selected ? "text-white/60" : "text-slate-400"}`}>· {group.code}</span>}
                <span className={`ml-2 rounded-md px-1.5 py-0.5 text-[10px] ${selected ? "bg-white/10 text-white/80" : "bg-slate-100 text-slate-400"}`}>
                  {group.rows.length}
                </span>
                {low > 0 && <span className={`ml-1.5 text-[10px] ${selected ? "text-rose-200" : "text-rose-500"}`}>· {low} rendah</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
        <table className="min-w-max border-collapse text-[12px] leading-4">
          <thead>
            <tr>
              <th className="sticky left-0 z-[4] w-12 min-w-12 border-b border-r border-slate-200 bg-white px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">No</th>
              <th className="sticky left-12 z-[4] min-w-[260px] border-b border-r border-slate-200 bg-white px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Nama barang · Gudang sumber</th>
              <th className="min-w-[72px] border-b border-slate-200 bg-white px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Satuan</th>
              <th className="min-w-[88px] border-b border-slate-200 bg-white px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sisa des</th>
              {["MG1", "MG2", "MG3", "MG4"].map((header) => (
                <th key={header} className="min-w-[64px] border-b border-slate-200 bg-white px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">{header}</th>
              ))}
              {pivot.rooms.map((room) => (
                <th key={room.id} title={room.code} className="min-w-[76px] border-b border-slate-200 bg-white px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">{room.name}</th>
              ))}
              <th className="min-w-[82px] border-b border-slate-200 bg-white px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Keluar</th>
              <th className="sticky right-0 z-[3] min-w-[96px] border-b border-l border-slate-200 bg-white px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400 shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)]">Sisa akhir</th>
            </tr>
          </thead>
          <tbody>
            {active?.rows.map(renderRow)}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-slate-100">
        {active?.rows.map((row, index) => {
          const identityBg = row.isLowStock ? "bg-rose-50/60" : "bg-white";
          const sourceLabel = row.sourceWarehouseCode
            ? `${row.sourceWarehouseName} · ${row.sourceWarehouseCode}`
            : row.sourceWarehouseName;
          return (
            <article key={row.itemId} className={`p-4 ${identityBg}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-slate-400">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold leading-5 ${row.isLowStock ? "text-rose-900" : "text-slate-800"}`}>{row.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{row.sku} · {row.unit}</p>
                      <p className="mt-1 text-[11px] font-medium text-teal-700">Gudang sumber: {sourceLabel}</p>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Sisa akhir</p>
                  <p className={`mt-0.5 text-lg font-bold ${row.isLowStock ? "text-rose-600" : "text-slate-900"}`}>{formatNumber(row.sisaAkhir)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Sisa awal</p>
                  <p className={`mt-0.5 text-sm font-semibold ${numberTone(row.sisaAwal)}`}>{formatNumber(row.sisaAwal)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Keluar</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-700">{formatNumber(row.keluarTotal)}</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Distribusi mingguan</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {row.mg.map((value, mgIndex) => (
                    <div key={mgIndex} className="rounded-md bg-slate-50 px-1.5 py-1.5 text-center">
                      <p className="text-[9px] font-medium text-slate-400">MG{mgIndex + 1}</p>
                      <p className={`mt-0.5 text-xs font-semibold ${numberTone(value)}`}>{formatNumber(value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {pivot.rooms.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Distribusi per ruangan</p>
                  <div className="mt-2 space-y-1.5">
                    {pivot.rooms.map((room) => (
                      <div key={room.id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate text-slate-500">{room.name}</span>
                        <span className={`shrink-0 font-semibold ${numberTone(row.perRoom[room.id] ?? 0)}`}>{formatNumber(row.perRoom[room.id] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {row.isLowStock && (
                <div className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-[11px] font-medium text-rose-700">
                  Stok berada di bawah atau sama dengan batas minimum.
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-400 sm:px-5">
        <span>
          Menampilkan {active?.rows.length ?? 0} barang · {activeLow} perlu perhatian.
        </span>
        <span className="hidden md:inline-flex items-center gap-1">
          Geser tabel ke samping untuk melihat seluruh ruangan <ChevronRight size={13} />
        </span>
        <span className="md:hidden">
          Tampilan mobile dioptimalkan sebagai kartu per barang.
        </span>
      </div>
    </section>
  );
}
