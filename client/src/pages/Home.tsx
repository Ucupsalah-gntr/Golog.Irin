import { type FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { importTemplateCsv, validateItemImport, type ImportPreview } from "@shared/item-import";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase, usernameToAuthEmail } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileDown,
  Hospital,
  LogOut,
  Menu,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  ClipboardType,
  Upload,
  Truck,
  Users,
  X,
  Eye,
  EyeOff,
} from "lucide-react";

const nav = [
  { key: "overview", label: "Ringkasan", icon: BarChart3, adminOnly: false },
  { key: "requests", label: "Permintaan", icon: ClipboardList, adminOnly: false },
  { key: "stock", label: "Stok barang", icon: Boxes, adminOnly: false },
  { key: "inbound", label: "Barang masuk", icon: ArrowDownToLine, adminOnly: true },
  { key: "adjustments", label: "Penyesuaian", icon: SlidersHorizontal, adminOnly: true },
  { key: "stocktake", label: "Stock Opname", icon: ClipboardType, adminOnly: true },
  { key: "reports", label: "Laporan", icon: FileDown, adminOnly: true },
] as const;

type NavKey = (typeof nav)[number]["key"];
type Line = { itemId: number; requestedQty: number };

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("id-ID").format(Number(value ?? 0));
}
function formatDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function statusLabel(status: string) {
  return ({ submitted: "Diajukan", approved: "Disetujui", partial: "Sebagian", rejected: "Ditolak", ready: "Siap diambil", delivered: "Diserahkan", received: "Diterima", cancelled: "Dibatalkan", draft: "Draft" } as Record<string, string>)[status] ?? status;
}
function statusTone(status: string) {
  if (["approved", "received", "ready"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["rejected", "cancelled"].includes(status)) return "bg-rose-100 text-rose-700 border-rose-200";
  if (["delivered", "partial"].includes(status)) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-sky-100 text-sky-700 border-sky-200";
}

function downloadExcel(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header, index) => {
    const maxLength = Math.max(
      String(header).length,
      ...rows.map((row) => String(row[index] ?? "").length),
    );
    return { wch: Math.min(Math.max(maxLength + 2, 10), 36) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Stok");
  XLSX.writeFile(workbook, filename);
}

export default function Home() {
  const { user, loading, isAuthenticated, logout, error: authError } = useAuth();
  const [active, setActive] = useState<NavKey>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [requestLines, setRequestLines] = useState<Line[]>([{ itemId: 0, requestedQty: 1 }]);
  const utils = trpc.useUtils();
  const catalog = trpc.catalog.all.useQuery(undefined, { enabled: isAuthenticated });
  const dashboard = trpc.dashboard.summary.useQuery({ roomId: selectedRoom }, { enabled: isAuthenticated });
  const requests = trpc.requests.list.useQuery({}, { enabled: isAuthenticated });
  const todayRoomLocks = trpc.requests.todayLocks.useQuery(undefined, { enabled: isAuthenticated });
  const adjustments = trpc.adjustments.list.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const report = trpc.reports.movements.useQuery({}, { enabled: isAuthenticated && user?.role === "admin" && active === "reports" });
  const createRequest = trpc.requests.create.useMutation({
    onSuccess: () => {
      toast.success("Permintaan berhasil diajukan");
      requests.refetch();
      todayRoomLocks.refetch();
      setRequestLines([{ itemId: 0, requestedQty: 1 }]);
    },
  });
  const verifyRequest = trpc.requests.verify.useMutation({
    onSuccess: () => {
      toast.success("Permintaan disetujui dan stok dipindahkan ke ruangan");
      requests.refetch();
      dashboard.refetch();
      utils.catalog.all.invalidate();
    },
  });
  const createInbound = trpc.inbound.create.useMutation({ onSuccess: () => { toast.success("Barang masuk tersimpan"); dashboard.refetch(); utils.catalog.all.invalidate(); } });
  const createAdjustment = trpc.adjustments.applyAdjustment.useMutation({ onSuccess: () => { toast.success("Penyesuaian stok diterapkan"); dashboard.refetch(); adjustments.refetch(); } });
  const createItem = trpc.catalog.createItem.useMutation({ onSuccess: () => { toast.success("Master barang dibuat"); utils.catalog.all.invalidate(); } });
  const importItems = trpc.catalog.importItems.useMutation({ onSuccess: (result) => { toast.success(`Impor selesai: ${result.created} baru, ${result.updated} diperbarui`); utils.catalog.all.invalidate(); setActive("stock"); } });

  const rooms = catalog.data?.rooms ?? [];
  const items = catalog.data?.items ?? [];
  const warehouses = catalog.data?.warehouses ?? [];
  const stock = dashboard.data?.stock ?? [];
  const isAdmin = user?.role === "admin";
  const visibleNav = nav.filter((item) => !item.adminOnly || isAdmin);
  const selectedRoomName = rooms.find((room) => room.id === selectedRoom)?.name;

  const requestTotal = useMemo(() => requestLines.reduce((sum, line) => sum + Number(line.requestedQty || 0), 0), [requestLines]);

  useEffect(() => {
    if (!isAdmin && ["inbound", "adjustments", "stocktake", "reports"].includes(active)) {
      setActive("overview");
    }
  }, [active, isAdmin]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#f4f7f6]"><div className="text-center"><Activity className="mx-auto mb-3 animate-pulse text-teal-600" /><p className="text-sm text-slate-500">Menyiapkan ruang kerja…</p></div></div>;
  if (!isAuthenticated) return <LoginScreen />;

  function refreshAll() {
    dashboard.refetch();
    requests.refetch();
    todayRoomLocks.refetch();
    catalog.refetch();
    if (isAdmin) adjustments.refetch();
    if (isAdmin && active === "reports") report.refetch();
  }
  function go(key: NavKey) { setActive(key); setMobileOpen(false); }

  return (
    <div className="min-h-screen bg-[#f4f7f6] text-slate-900">
      <div className="flex min-h-screen">
        <aside className={`${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200 bg-[#102a2b] text-white transition-transform lg:static`}>
          <div className="flex h-full flex-col px-5 py-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-6"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#c9f3d7] text-[#102a2b]"><Hospital size={22} /></div><div><p className="font-semibold tracking-tight">Gudang IR</p><p className="text-xs text-teal-100/70">Rawat Intensif</p></div></div><button className="lg:hidden" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
            <div className="mt-7 rounded-2xl bg-white/10 p-4"><p className="text-[11px] uppercase tracking-[0.18em] text-teal-100/60">Sesi aktif</p><p className="mt-1 truncate font-medium">{user?.name || user?.email || "Pengguna"}</p><div className="mt-2 flex items-center gap-2 text-xs text-teal-100/70"><ShieldCheck size={14} />{isAdmin ? "Kepala gudang" : "Petugas ruangan"}</div></div>
            <nav className="mt-8 space-y-1">{visibleNav.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => go(item.key)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${active === item.key ? "bg-[#c9f3d7] font-semibold text-[#102a2b]" : "text-teal-50/70 hover:bg-white/10 hover:text-white"}`}><Icon size={18} />{item.label}</button>; })}</nav>
            <div className="mt-auto border-t border-white/10 pt-5"><button onClick={() => logout()} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-teal-50/70 hover:bg-white/10 hover:text-white"><LogOut size={18} />Keluar</button></div>
          </div>
        </aside>
        {mobileOpen && <button aria-label="Tutup menu" className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200/80 bg-[#f4f7f6]/90 px-5 backdrop-blur md:px-8"><div className="flex items-center gap-3"><button className="rounded-xl p-2 hover:bg-white lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Instalasi Rawat Intensif</p><h1 className="text-xl font-semibold tracking-tight">{visibleNav.find((x) => x.key === active)?.label}</h1></div></div><div className="flex items-center gap-2"><button title="Refresh" onClick={refreshAll} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:text-teal-700"><RefreshCw size={17} /></button><div className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-right sm:block"><p className="text-xs font-semibold">{user?.name || "Akun aktif"}</p><p className="text-[11px] text-slate-500">{isAdmin ? "Kepala gudang" : "Petugas"}</p></div></div></header>
          <div className="mx-auto max-w-[1500px] space-y-6 p-5 md:p-8">
            {active === "overview" && <Overview dashboard={dashboard.data} isAdmin={isAdmin} onGo={go} />}
            {active === "stock" && <StockView stock={stock} isAdmin={isAdmin} items={items} warehouses={warehouses} onCreateItem={(input: any) => createItem.mutate(input)} busy={createItem.isPending} onImport={(rows: any[]) => importItems.mutate({ rows })} importBusy={importItems.isPending} />}
            {active === "inbound" && <InboundView items={items} warehouses={warehouses} onSubmit={(input: any) => createInbound.mutate(input)} busy={createInbound.isPending} />}
            {active === "requests" && <RequestsView requests={requests.data ?? []} rooms={rooms} items={items} isAdmin={isAdmin} currentUserId={user?.id} todayRoomLocks={todayRoomLocks.data ?? []} selectedRoom={selectedRoom} selectedRoomName={selectedRoomName} setSelectedRoom={setSelectedRoom} lines={requestLines} setLines={setRequestLines} total={requestTotal} onCreate={(input: any) => createRequest.mutate(input)} onVerify={(input: any) => verifyRequest.mutate(input)} busy={createRequest.isPending || verifyRequest.isPending} />}
            {active === "adjustments" && <AdjustmentsView adjustments={adjustments.data ?? []} items={items} rooms={rooms} onSubmit={(input: any) => createAdjustment.mutate(input)} busy={createAdjustment.isPending} />}\n            {active === "stocktake" && <StockOpnameView stock={stock} items={items} rooms={rooms} onSubmit={(input: any) => createAdjustment.mutate(input)} busy={createAdjustment.isPending} />}
            {active === "reports" && <ReportsView report={report.data ?? []} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function LoginScreen({ initialError = "" }: { initialError?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(initialError);
  const [starting, setStarting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    const cleanUsername = username.trim().toLowerCase();

    if (!cleanUsername || !password) {
      setLoginError("Username dan password wajib diisi.");
      return;
    }

    const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
    const supabaseKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

    if (!supabaseUrl || !supabaseKey) {
      setLoginError("Konfigurasi Supabase belum dipasang di Vercel.");
      return;
    }

    setStarting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameToAuthEmail(cleanUsername),
        password,
      });

      if (error) {
        throw new Error("Username atau password tidak benar.");
      }
    } catch (error) {
      console.error("[Login] Supabase sign-in failed", error);
      setLoginError(error instanceof Error ? error.message : "Login gagal. Silakan coba lagi.");
      setStarting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4faf8] text-[#102a2b]">
      <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-[#dff5e8]" />
      <div className="absolute -left-28 bottom-[-10rem] h-96 w-96 rounded-full bg-[#dceff6]" />
      <div className="relative mx-auto grid min-h-screen max-w-[1500px] items-center gap-10 px-6 py-8 lg:grid-cols-[1.08fr_.92fr] lg:px-12 xl:px-16">
        <section className="flex min-h-[720px] flex-col justify-between py-5 lg:py-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#c9f3d7] text-[#08785e] shadow-sm">
                <Hospital size={28} />
              </div>
              <div>
                <p className="text-xl font-bold tracking-tight">Gudang IR</p>
                <p className="text-sm text-slate-500">Rawat Intensif</p>
              </div>
            </div>

            <div className="mt-16 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#dff5eb] px-4 py-2 text-xs font-bold text-[#08785e]">
                <ShieldCheck size={15} />
                Sistem Manajemen Gudang
              </div>
              <h1 className="mt-6 text-5xl font-bold leading-[1.04] tracking-[-0.045em] text-[#122b4a] md:text-6xl xl:text-7xl">
                Satu alur untuk
                <span className="block text-[#07966f]">stok yang selalu siap.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-500 md:text-lg">
                Kelola barang masuk, permintaan ruangan, distribusi, dan penyesuaian stok dengan histori yang jelas.
              </p>
            </div>

            <div className="mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
              {[
                { icon: Boxes, title: "Manajemen Stok", text: "Pantau stok dan cegah kekurangan." },
                { icon: ClipboardList, title: "Transaksi Lengkap", text: "Setiap pergerakan tercatat." },
                { icon: ShieldCheck, title: "Audit & Riwayat", text: "Transparan dan mudah ditelusuri." },
              ].map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                    <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[#e0f7eb] text-[#078d69]">
                      <Icon size={19} />
                    </div>
                    <p className="text-sm font-bold text-[#17304c]">{feature.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{feature.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative mt-10 hidden h-48 overflow-hidden rounded-[2rem] border border-white bg-gradient-to-b from-[#eaf7fb] to-[#dcecf1] shadow-sm md:block">
            <div className="absolute inset-x-0 bottom-0 h-14 bg-[#c8e1e8]" />
            <div className="absolute bottom-12 left-8 h-24 w-44 rounded-lg border-4 border-[#496c7c]">
              <div className="absolute left-0 right-0 top-8 border-t-4 border-[#496c7c]" />
              <div className="absolute left-0 right-0 top-16 border-t-4 border-[#496c7c]" />
              <div className="absolute left-5 top-[-2px] h-10 w-10 rounded-md bg-[#d89b61]" />
              <div className="absolute left-20 top-[38px] h-8 w-12 rounded-md bg-[#e7ae72]" />
              <div className="absolute right-4 top-[67px] h-10 w-14 rounded-md bg-[#d89b61]" />
            </div>
            <div className="absolute bottom-10 left-[39%] h-28 w-28 rounded-full bg-[#75c69d]/35" />
            <div className="absolute bottom-8 left-[47%] h-24 w-12 rounded-t-[2rem] bg-[#1d5960]" />
            <div className="absolute bottom-5 left-[44%] h-10 w-24 rounded-full bg-[#123e48]/20" />
            <div className="absolute bottom-11 right-12 h-24 w-36 rounded-2xl bg-white/60 p-4">
              <div className="h-3 w-20 rounded bg-[#d89b61]" />
              <div className="mt-3 h-3 w-28 rounded bg-[#e7ae72]" />
              <div className="mt-3 h-3 w-16 rounded bg-[#d89b61]" />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:pl-4">
          <Card className="w-full max-w-xl border-0 bg-white p-3 shadow-[0_24px_70px_rgba(24,64,65,0.12)]">
            <CardContent className="rounded-[1.5rem] bg-[#f8faf9] p-7 sm:p-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#c9f3d7] text-[#078d69]">
                <Hospital size={30} />
              </div>
              <div className="mt-7 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#078d69]">Ruang kerja</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#122b4a] sm:text-4xl">Selamat Datang</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
                  Masuk menggunakan username dan password akun Gudang IR.
                </p>
              </div>

              <form onSubmit={handleLogin} className="mt-8 space-y-5">
                <div>
                  <Label htmlFor="golog-username" className="text-sm font-semibold text-[#17304c]">Username</Label>
                  <Input
                    id="golog-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="contoh: kepala.gudang"
                    className="mt-2 h-12 rounded-xl border-slate-200 bg-white"
                    disabled={starting}
                  />
                </div>

                <div>
                  <Label htmlFor="golog-password" className="text-sm font-semibold text-[#17304c]">Password</Label>
                  <div className="relative mt-2">
                    <Input
                      id="golog-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="Masukkan password"
                      className="h-12 rounded-xl border-slate-200 bg-white pr-12"
                      disabled={starting}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      title={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                      disabled={starting}
                      className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400 hover:text-[#078d69] disabled:opacity-50"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700">
                    {loginError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={starting}
                  className="h-14 w-full rounded-2xl bg-[#07966f] text-base font-bold text-white shadow-lg shadow-[#07966f]/20 hover:bg-[#067d5e]"
                >
                  {starting ? "Memeriksa akun…" : "Masuk"}
                </Button>
              </form>

              <div className="mt-6 rounded-2xl border border-[#dce9e5] bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f8ef] text-[#078d69]">
                    <ShieldCheck size={19} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#17304c]">Akses berbasis akun</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Hak akses ditentukan oleh peran dan ruangan yang ditetapkan pada akun Anda.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                <span>Akses terbatas</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <p className="mt-4 text-center text-xs leading-5 text-slate-400">
                Gunakan akun yang telah didaftarkan oleh pengelola Gudang IR.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function Overview({ dashboard, isAdmin, onGo }: { dashboard: any; isAdmin: boolean; onGo: (key: NavKey) => void }) {
  const stats = dashboard?.stats ?? { items: 0, lowStock: 0, pending: 0, todayIn: 0 };
  const roomName = dashboard?.roomName;
  const cards = isAdmin
    ? [
        { label: "Jenis barang aktif", value: stats.items, hint: "Master item terdaftar", icon: Boxes, tint: "bg-teal-50 text-teal-700" },
        { label: "Stok perlu perhatian", value: stats.lowStock, hint: "Di bawah batas minimum", icon: Activity, tint: "bg-amber-50 text-amber-700" },
        { label: "Permintaan menunggu", value: stats.pending, hint: "Perlu verifikasi Anda", icon: ClipboardCheck, tint: "bg-sky-50 text-sky-700" },
        { label: "Masuk hari ini", value: stats.todayIn, hint: "Unit masuk Gudang Pusat", icon: ArrowDownToLine, tint: "bg-emerald-50 text-emerald-700" },
      ]
    : [
        { label: "Jenis barang di ruangan", value: stats.items, hint: roomName ? roomName : "Belum ada ruangan aktif", icon: Boxes, tint: "bg-teal-50 text-teal-700" },
        { label: "Stok perlu perhatian", value: stats.lowStock, hint: "Stok ruangan di bawah minimum", icon: Activity, tint: "bg-amber-50 text-amber-700" },
        { label: "Permintaan diajukan", value: stats.pending, hint: "Masih menunggu verifikasi", icon: ClipboardCheck, tint: "bg-sky-50 text-sky-700" },
        { label: "Masuk hari ini", value: stats.todayIn, hint: "Unit masuk ke ruangan", icon: ArrowDownToLine, tint: "bg-emerald-50 text-emerald-700" },
      ];

  return <>
    {!isAdmin && (
      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Ruangan aktif</p>
            <p className="mt-1 text-lg font-semibold">{roomName || "Belum ditentukan"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {roomName ? "Ringkasan dan stok di bawah ini mengikuti ruangan aktif Anda." : "Ajukan permintaan pertama hari ini untuk menetapkan ruangan yang Anda layani."}
            </p>
          </div>
          <Button variant="outline" onClick={() => onGo("requests")}>Buat permintaan</Button>
        </CardContent>
      </Card>
    )}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((item) => {
        const Icon = item.icon;
        return <Card key={item.label} className="border-slate-200/80 shadow-sm"><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(item.value)}</p><p className="mt-1 text-xs text-slate-400">{item.hint}</p></div><div className={`rounded-2xl p-3 ${item.tint}`}><Icon size={20} /></div></CardContent></Card>;
      })}
    </div>
    <div className="grid gap-6">
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>{isAdmin ? "Aktivitas Gudang Pusat" : "Aktivitas ruangan"}</CardTitle><p className="mt-1 text-sm text-slate-500">{isAdmin ? "Pergerakan terakhir di Gudang Pusat." : roomName ? `Pergerakan terakhir di ${roomName}.` : "Belum ada ruangan aktif."}</p></div>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => onGo("reports")}><FileDown size={15} className="mr-2" />Laporan</Button>}
        </CardHeader>
        <CardContent><div className="divide-y divide-slate-100">{(dashboard?.recent ?? []).length ? dashboard.recent.map((row: any) => <div key={row.movement.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className={`rounded-xl p-2 ${row.movement.quantity >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{row.movement.quantity >= 0 ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{row.item?.name ?? "Item"}</p><p className="text-xs text-slate-400">{row.movement.movementType === "in" ? "Barang masuk" : row.movement.movementType === "out" ? "Keluar gudang" : "Penyesuaian"} · {formatDate(row.movement.occurredAt)}</p></div></div><p className={`shrink-0 text-sm font-semibold ${row.movement.quantity >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{row.movement.quantity >= 0 ? "+" : ""}{formatNumber(row.movement.quantity)}</p></div>) : <EmptyState title="Belum ada aktivitas" text={isAdmin ? "Catat barang masuk untuk memulai kartu stok." : roomName ? "Belum ada barang masuk ke ruangan." : "Belum ada ruangan aktif."} />}</div></CardContent>
      </Card>
    </div>
  </>;
}
function StockView({ stock, isAdmin, items, warehouses, onCreateItem, busy, onImport, importBusy }: any) {
  const [show, setShow] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", unit: "box", category: "", sourceWarehouseId: "", minStock: "0" });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");

  async function handleImportFile(file: File) {
    setFileName(file.name);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("Sheet pertama tidak ditemukan.");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      setPreview(validateItemImport(rows));
    } catch (error) {
      setPreview({ rows: [], errors: [{ rowNumber: 1, field: "file", message: error instanceof Error ? error.message : "File Excel tidak dapat dibaca." }], duplicateSkus: [] });
    }
  }

  function downloadTemplate() {
    const blob = new Blob([importTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "template-master-barang.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  const canImport = Boolean(preview && preview.rows.length && preview.errors.length === 0);
  return <Card className="border-slate-200/80 shadow-sm">
    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div><CardTitle>{isAdmin ? "Stok Gudang Pusat" : "Stok Ruangan"}</CardTitle><p className="mt-1 text-sm text-slate-500">{isAdmin ? "Saldo bersih stok yang tersedia di Gudang Pusat." : "Saldo stok yang saat ini tercatat di ruangan Anda."}</p></div>
      {isAdmin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowImport(!showImport)}><Upload size={16} className="mr-2" />Impor Excel</Button><Button onClick={() => setShow(!show)}><PackagePlus size={16} className="mr-2" />Tambah barang</Button></div>}
    </CardHeader>
    <CardContent>
      {showImport && isAdmin && <div className="mb-6 rounded-2xl border border-teal-100 bg-teal-50/60 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="font-semibold">Impor master barang</p><p className="text-xs leading-5 text-slate-500">Upload .xlsx, .xls, atau .csv. Data divalidasi dulu sebelum disimpan.</p></div><Button variant="outline" size="sm" onClick={downloadTemplate}>Unduh template CSV</Button></div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])} />{fileName && <span className="text-xs text-slate-500">{fileName}</span>}</div>
        {preview && <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-400">Baris terbaca</p><p className="mt-1 text-lg font-semibold">{preview.rows.length}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-400">Error</p><p className="mt-1 text-lg font-semibold">{preview.errors.length}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-400">SKU duplikat</p><p className="mt-1 text-lg font-semibold">{preview.duplicateSkus.length}</p></div></div>
          {preview.errors.length > 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{preview.errors.slice(0, 8).map((error, i) => <p key={i}>Baris {error.rowNumber} · {error.field}: {error.message}</p>)}{preview.errors.length > 8 && <p className="mt-1">+ {preview.errors.length - 8} error lainnya.</p>}</div>}
          {canImport && <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-emerald-700">Semua {preview.rows.length} baris lolos validasi dan siap diimpor.</p><Button disabled={importBusy} onClick={() => onImport(preview.rows)}>{importBusy ? "Mengimpor…" : "Impor ke master barang"}</Button></div>}
        </div>}
      </div>}
      {show && <div className="mb-6 grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-3"><Field label="SKU"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="FAR-001" /></Field><Field label="Nama barang"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sarung tangan" /></Field><Field label="Satuan"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field><Field label="Kategori"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Alat kesehatan" /></Field><Field label="Batas minimum"><Input type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></Field><div className="flex items-end"><Button disabled={busy || !form.sku || !form.name} onClick={() => onCreateItem({ ...form, minStock: Number(form.minStock), sourceWarehouseId: form.sourceWarehouseId ? Number(form.sourceWarehouseId) : null })}>Simpan master barang</Button></div></div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-3 py-3">Barang</th><th className="px-3 py-3">Kategori</th><th className="px-3 py-3">Stok</th><th className="px-3 py-3">Minimum</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{stock.map((row: any) => <tr key={row.itemId}><td className="px-3 py-4"><p className="font-medium">{row.name}</p><p className="text-xs text-slate-400">{row.sku} · per {row.unit}</p></td><td className="px-3 py-4 text-slate-500">{row.category || "Umum"}</td><td className="px-3 py-4 text-lg font-semibold">{formatNumber(row.movementQty)} <span className="text-xs font-normal text-slate-400">{row.unit}</span></td><td className="px-3 py-4 text-slate-500">{formatNumber(row.minStock)}</td><td className="px-3 py-4"><Badge className={Number(row.movementQty) <= row.minStock ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{Number(row.movementQty) <= row.minStock ? "Perlu cek" : "Aman"}</Badge></td></tr>)}{!stock.length && <tr><td colSpan={5}><EmptyState title="Master barang masih kosong" text={isAdmin ? "Tambahkan master barang terlebih dahulu." : "Belum ada data stok."} /></td></tr>}</tbody></table></div>
    </CardContent>
  </Card>;
}

function InboundView({ items, warehouses, onSubmit, busy }: any) { const [form, setForm] = useState({ itemId: "", quantity: "", sourceWarehouseId: "", notes: "", occurredAt: new Date().toISOString().slice(0, 10) }); return <Card className="max-w-3xl border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Catat barang masuk</CardTitle><p className="mt-1 text-sm text-slate-500">Penerimaan dari Gudang Farmasi, Gudang RT, CSSD, atau Laboratorium.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2"><Field label="Barang"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></Field><Field label="Sumber gudang"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.sourceWarehouseId} onChange={(e) => setForm({ ...form, sourceWarehouseId: e.target.value })}><option value="">Pilih gudang sumber</option>{warehouses.filter((w: any) => w.kind === "source").map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="Jumlah"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" /></Field><Field label="Tanggal kejadian"><Input type="date" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></Field><div className="md:col-span-2"><Field label="Catatan"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Nomor dokumen, nota, atau keterangan penerimaan" /></Field></div></div><Button className="mt-6" disabled={busy || !form.itemId || !form.quantity || !form.sourceWarehouseId} onClick={() => onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), sourceWarehouseId: Number(form.sourceWarehouseId), occurredAt: new Date(form.occurredAt) })}><ArrowDownToLine size={16} className="mr-2" />Simpan barang masuk</Button></CardContent></Card> }

function RequestsView({ requests, rooms, items, isAdmin, currentUserId, todayRoomLocks, selectedRoom, selectedRoomName, setSelectedRoom, lines, setLines, total, onCreate, onVerify, busy }: any) {
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? requests : requests.filter((row: any) => row.request.status === filter);
  const getRoomLock = (roomId: number) => todayRoomLocks.find((lock: any) => lock.roomId === roomId);
  const selectedLock = selectedRoom ? getRoomLock(selectedRoom) : null;
  const selectedLockedByOther = Boolean(selectedLock && selectedLock.requesterId !== currentUserId);

  return <div className="grid gap-6 xl:grid-cols-[.85fr_1.5fr]">
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader><CardTitle>{isAdmin ? "Verifikasi permintaan" : "Buat permintaan"}</CardTitle><p className="mt-1 text-sm text-slate-500">{isAdmin ? "Periksa jumlah lalu setujui untuk langsung memindahkan stok Gudang Pusat ke ruangan." : "Pilih ruangan yang sedang Anda layani hari ini. Stok Gudang Pusat ditampilkan sebelum mengajukan."}</p></CardHeader>
      <CardContent>{!isAdmin && <>
        <Field label="Ruangan yang dilayani *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedRoom ?? ""} onChange={(e) => setSelectedRoom(Number(e.target.value) || null)}><option value="">Pilih ruangan sebelum lanjut</option>{rooms.map((room: any) => { const lock = getRoomLock(room.id); const lockedByOther = Boolean(lock && lock.requesterId !== currentUserId); return <option key={room.id} value={room.id} disabled={lockedByOther}>{room.name}{lock ? lock.requesterId === currentUserId ? " — Anda" : ` — ${lock.requesterName || "petugas lain"}` : " — belum ada PIC"} </option>; })}</select></Field>
        <div className={`mt-4 rounded-xl p-3 text-sm ${selectedLockedByOther ? "bg-rose-50 text-rose-800" : selectedLock ? "bg-emerald-50 text-emerald-800" : "bg-teal-50 text-teal-800"}`}>{selectedLock ? selectedLock.requesterId === currentUserId ? <>Anda adalah PIC request <strong>{selectedRoomName}</strong> hari ini. Anda dapat membuat request susulan.</> : <>Ruangan <strong>{selectedRoomName}</strong> sudah memiliki PIC request hari ini: <strong>{selectedLock.requesterName || "petugas lain"}</strong>.</> : <>Permintaan akan menjadi request pertama untuk <strong>{selectedRoomName || "ruangan yang dipilih"}</strong> hari ini.</>}</div>
        <div className="mt-5"><Field label="Prioritas"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="normal">Normal</option><option value="mendesak">Mendesak</option><option value="darurat">Darurat</option></select></Field></div>
        <div className="mt-5 space-y-3">
          {lines.map((line: Line, index: number) => {
            const selectedItem = items.find((item: any) => Number(item.id) === Number(line.itemId));
            const warehouseQty = Number(selectedItem?.warehouseStockQty ?? 0);
            const exceeds = Boolean(selectedItem && Number(line.requestedQty) > warehouseQty);
            return <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="grid grid-cols-[1fr_90px_auto] gap-2">
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={line.itemId || ""} onChange={(e) => setLines(lines.map((x: Line, i: number) => i === index ? { ...x, itemId: Number(e.target.value) } : x))}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <Input type="number" min="1" value={line.requestedQty} onChange={(e) => setLines(lines.map((x: Line, i: number) => i === index ? { ...x, requestedQty: Number(e.target.value) } : x))} />
                <button type="button" className="rounded-lg px-2 text-slate-400 hover:bg-white" onClick={() => setLines(lines.filter((_: Line, i: number) => i !== index))}>×</button>
              </div>
              {selectedItem && <div className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${exceeds ? "bg-amber-50 text-amber-800" : "bg-white text-slate-500"}`}><span>Stok Gudang Pusat: <strong className={exceeds ? "text-amber-900" : "text-slate-700"}>{formatNumber(warehouseQty)} {selectedItem.unit}</strong></span>{exceeds && <span>Permintaan melebihi stok tersedia.</span>}</div>}
            </div>;
          })}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { itemId: 0, requestedQty: 1 }])}>+ Tambah item</Button>
        </div>
        <div className="mt-5"><Field label="Catatan"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Keperluan atau keterangan permintaan" /></Field></div>
        <Button className="mt-5 w-full" disabled={busy || !selectedRoom || selectedLockedByOther || lines.some((x: Line) => !x.itemId || x.requestedQty < 1)} onClick={() => onCreate({ roomId: selectedRoom, priority, notes, lines })}><Truck size={16} className="mr-2" />Ajukan {total} unit</Button>
      </>}</CardContent>
    </Card>

    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Daftar permintaan</CardTitle><p className="mt-1 text-sm text-slate-500">{isAdmin ? "Semua ruangan · verifikasi dan distribusi otomatis" : "Riwayat permintaan yang Anda buat"}</p></div><select className="h-9 rounded-lg border border-input bg-background px-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Semua status</option><option value="submitted">Diajukan</option><option value="approved">Disetujui</option><option value="partial">Sebagian</option><option value="rejected">Ditolak</option></select></CardHeader>
      <CardContent><div className="space-y-3">{filtered.map((row: any) => <div key={row.request.id} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="font-semibold">{row.request.requestNo}</span><Badge className={statusTone(row.request.status)}>{statusLabel(row.request.status)}</Badge></div><p className="mt-1 text-sm text-slate-500">{row.room?.name || "Ruangan"} · {formatDate(row.request.createdAt)} · <span className="capitalize">{row.request.priority}</span></p></div>
          {isAdmin && row.request.status === "submitted" && <div className="flex gap-2"><Button size="sm" onClick={() => onVerify({ requestId: row.request.id, status: "approved", lines: row.lines.map((line: any) => ({ lineId: line.line.id, approvedQty: line.line.requestedQty })) })}>Setujui & pindahkan stok</Button><Button size="sm" variant="outline" onClick={() => onVerify({ requestId: row.request.id, status: "rejected" })}>Tolak</Button></div>}
        </div>
        <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm">{row.lines.map((line: any) => <div key={line.line.id} className="flex justify-between gap-4"><span>{line.item?.name || "Item"}</span><span className="font-medium">{line.line.requestedQty} diminta · {line.line.approvedQty} dipindahkan</span></div>)}</div>
      </div>)}{!filtered.length && <EmptyState title="Belum ada permintaan" text={isAdmin ? "Permintaan dari ruangan akan muncul di sini." : "Buat permintaan pertama untuk memulai."} />}</div></CardContent>
    </Card>
  </div>;
}
function StockOpnameView({ stock, items, onSubmit, busy }: any) {
  const [form, setForm] = useState({ itemId: "", physicalQty: "", reason: "", incidentDate: new Date().toISOString().slice(0, 10) });
  const selected = stock.find((row: any) => Number(row.itemId) === Number(form.itemId));
  const systemQty = selected ? Number(selected.movementQty) : null;
  const physicalQty = form.physicalQty === "" ? null : Number(form.physicalQty);
  const difference = systemQty === null || physicalQty === null || !Number.isFinite(physicalQty) ? null : physicalQty - systemQty;
  const canSubmit = Boolean(selected && physicalQty !== null && Number.isInteger(physicalQty) && physicalQty >= 0 && difference !== null && difference !== 0 && form.reason.trim().length >= 10);

  function submit() {
    if (!canSubmit || difference === null || physicalQty === null) return;
    onSubmit({ itemId: Number(form.itemId), roomId: null, adjustmentType: difference > 0 ? "add" : "subtract", quantity: Math.abs(difference), physicalQty, reasonType: "stocktake", reason: form.reason.trim(), incidentDate: new Date(form.incidentDate) });
  }

  return <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
    <Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Stock Opname Gudang Pusat</CardTitle><p className="mt-1 text-sm text-slate-500">Hanya untuk pencocokan stok fisik Gudang Pusat oleh admin/kepala gudang.</p></CardHeader><CardContent className="space-y-4">
      <Field label="Barang *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value, physicalQty: "" })}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></Field>
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Stok sistem</p><p className="mt-1 text-2xl font-semibold">{systemQty === null ? "—" : formatNumber(systemQty)}</p></div><Field label="Stok fisik *"><Input type="number" min="0" step="1" value={form.physicalQty} onChange={(e) => setForm({ ...form, physicalQty: e.target.value })} placeholder="Contoh 130" /></Field><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Selisih</p><p className={`mt-1 text-2xl font-semibold ${difference === null ? "text-slate-400" : difference > 0 ? "text-emerald-700" : difference < 0 ? "text-rose-700" : "text-sky-700"}`}>{difference === null ? "—" : difference > 0 ? `+${formatNumber(difference)}` : formatNumber(difference)}</p></div></div>
      <Field label="Catatan opname *"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Contoh: opname akhir bulan, dihitung ulang bersama petugas..." /></Field>
      <Button className="w-full" disabled={busy || !canSubmit} onClick={submit}><ClipboardCheck size={16} className="mr-2" />Terapkan hasil opname</Button>
      <p className="text-xs leading-5 text-slate-400">Ruangan tidak dihitung melalui fitur ini. Mekanisme stock opname ruangan tetap dilakukan manual di luar Golog.Irin.</p>
    </CardContent></Card>
    <Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Contoh perhitungan</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <div className="rounded-xl border border-slate-200 p-4"><p className="font-medium">135 → 130</p><p className="mt-1 text-slate-500">Selisih otomatis <strong>−5</strong>.</p></div>
      <div className="rounded-xl border border-slate-200 p-4"><p className="font-medium">80 → 84</p><p className="mt-1 text-slate-500">Selisih otomatis <strong>+4</strong>.</p></div>
      <div className="rounded-xl border border-slate-200 p-4"><p className="font-medium">Lokasi</p><p className="mt-1 text-slate-500">Stock opname Golog.Irin hanya mencatat Gudang Pusat.</p></div>
    </CardContent></Card>
  </div>;
}
function AdjustmentsView({ adjustments, items, rooms, onSubmit, busy }: any) { const [form, setForm] = useState({ itemId: "", roomId: "", adjustmentType: "subtract", quantity: "", physicalQty: "", reasonType: "holiday_pickup", reason: "", incidentDate: new Date().toISOString().slice(0, 10) }); return <div className="grid gap-6 xl:grid-cols-[.9fr_1.4fr]"><Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Penyesuaian stok</CardTitle><p className="mt-1 text-sm text-slate-500">Untuk selisih fisik, pengambilan hari libur, rusak, atau darurat.</p></CardHeader><CardContent><div className="grid gap-4"><Field label="Barang *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Jenis"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.adjustmentType} onChange={(e) => setForm({ ...form, adjustmentType: e.target.value })}><option value="subtract">Pengurangan</option><option value="add">Penambahan</option></select></Field><Field label="Jumlah"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field></div><Field label="Ruangan terkait"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}><option value="">Tidak ada / umum</option>{rooms.map((room: any) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field><Field label="Stok fisik setelah kejadian"><Input type="number" min="0" value={form.physicalQty} onChange={(e) => setForm({ ...form, physicalQty: e.target.value })} /></Field><Field label="Jenis kejadian"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.reasonType} onChange={(e) => setForm({ ...form, reasonType: e.target.value })}><option value="holiday_pickup">Pengambilan hari libur</option><option value="forgotten_entry">Lupa tercatat</option><option value="emergency">Pengeluaran darurat</option><option value="damaged">Barang rusak</option><option value="expired">Kedaluwarsa</option><option value="stocktake">Stock opname</option><option value="other">Lainnya</option></select></Field><Field label="Tanggal kejadian"><Input type="date" value={form.incidentDate} onChange={(e) => setForm({ ...form, incidentDate: e.target.value })} /></Field><Field label="Alasan wajib (minimal 10 karakter)"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Contoh: 10 box diambil ICU Garuda saat hari libur…" /></Field><Button disabled={busy || !form.itemId || !form.quantity || !form.physicalQty || form.reason.length < 10} onClick={() => onSubmit({ ...form, itemId: Number(form.itemId), roomId: form.roomId ? Number(form.roomId) : null, quantity: Number(form.quantity), physicalQty: Number(form.physicalQty), incidentDate: new Date(form.incidentDate) })}><ClipboardCheck size={16} className="mr-2" />Terapkan penyesuaian</Button><p className="text-xs leading-5 text-slate-400">Penyesuaian langsung menerapkan stok dan mencatat self-verification kepala gudang.</p></div></CardContent></Card><Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Riwayat penyesuaian</CardTitle></CardHeader><CardContent><div className="space-y-3">{adjustments.map((row: any) => <div key={row.adjustment.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{row.adjustment.adjustmentNo}</p><p className="mt-1 text-sm text-slate-500">{row.item?.name} · {row.room?.name || "umum"}</p></div><Badge className="border-violet-200 bg-violet-50 text-violet-700">Self-verified</Badge></div><p className="mt-3 text-sm">{row.adjustment.reason}</p><p className="mt-2 text-xs text-slate-400">{formatDate(row.adjustment.incidentDate)} · {row.adjustment.adjustmentType === "add" ? "+" : "−"}{row.adjustment.quantity} unit</p></div>)}{!adjustments.length && <EmptyState title="Belum ada penyesuaian" text="Setiap koreksi stok akan tercatat di sini." />}</div></CardContent></Card></div> }

function ReportsView({ report }: any) { const rows = report.map((row: any) => [formatDate(row.movement.occurredAt), row.item?.sku || "", row.item?.name || "", row.item?.unit || "", row.warehouse?.name || (row.movement.movementType === "out" ? "Gudang Logistik" : ""), row.room?.name || "", row.movement.quantity, row.movement.movementType]); return <Card className="border-slate-200/80 shadow-sm"><CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><CardTitle>Laporan pergerakan stok</CardTitle><p className="mt-1 text-sm text-slate-500">Unduh histori pergerakan stok dalam format Excel (.xlsx).</p></div><Button onClick={() => downloadExcel(`laporan-stok-${new Date().toISOString().slice(0, 10)}.xlsx`, ["Tanggal", "SKU", "Barang", "Satuan", "Gudang Sumber", "Ruangan", "Jumlah", "Jenis"], rows)} disabled={!rows.length}><FileDown size={16} className="mr-2" />Export Excel</Button></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400"><tr>{["Tanggal", "Barang", "Gudang / ruangan", "Jumlah", "Jenis"].map((h) => <th className="px-3 py-3" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{report.map((row: any) => <tr key={row.movement.id}><td className="px-3 py-4">{formatDate(row.movement.occurredAt)}</td><td className="px-3 py-4"><p className="font-medium">{row.item?.name || "—"}</p><p className="text-xs text-slate-400">{row.item?.sku || ""}</p></td><td className="px-3 py-4 text-slate-500">{row.room?.name || row.warehouse?.name || "Gudang Logistik"}</td><td className={`px-3 py-4 font-semibold ${row.movement.quantity < 0 ? "text-rose-700" : "text-emerald-700"}`}>{row.movement.quantity > 0 ? "+" : ""}{formatNumber(row.movement.quantity)}</td><td className="px-3 py-4 text-slate-500">{row.movement.movementType === "in" ? "Masuk" : row.movement.movementType === "out" ? "Keluar" : "Penyesuaian"}</td></tr>)}{!report.length && <tr><td colSpan={5}><EmptyState title="Belum ada transaksi" text="Laporan akan terisi setelah barang masuk, distribusi otomatis, atau penyesuaian dicatat." /></td></tr>}</tbody></table></div></CardContent></Card> }

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label className="text-xs font-semibold text-slate-600">{label}</Label>{children}</div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="grid place-items-center px-5 py-14 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><ClipboardList size={20} /></div><p className="mt-4 font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p></div>; }




