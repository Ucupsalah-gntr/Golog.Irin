import { type FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { computeMonthlyPivot } from "@shared/monthly-pivot";
import { importTemplateCsv, validateItemImport, type ImportPreview } from "@shared/item-import";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase, usernameToAuthEmail } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CategoryPivotTable from "@/components/CategoryPivotTable";
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
  Bell,
  ChevronRight,
  History,
  Search,
  Settings2,
} from "lucide-react";

const nav = [
  { key: "overview", label: "Ringkasan", icon: BarChart3, adminOnly: false },
  { key: "requests", label: "Permintaan", icon: ClipboardList, adminOnly: false },
  { key: "stock", label: "Stok barang", icon: Boxes, adminOnly: false },
  { key: "inbound", label: "Barang masuk", icon: ArrowDownToLine, adminOnly: true },
  { key: "adjustments", label: "Penyesuaian", icon: SlidersHorizontal, adminOnly: true },
  { key: "stocktake", label: "Stock Opname", icon: ClipboardType, adminOnly: true },
  { key: "room-demand", label: "Pola Ruangan", icon: Activity, adminOnly: true },
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
function getJakartaDateKeyClient(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(value);
}
function getJakartaMonthKeyClient(value = new Date()) {
  return getJakartaDateKeyClient(value).slice(0, 7);
}
function getReportDay(value: unknown) {
  return Number(getJakartaDateKeyClient(new Date(String(value))).slice(-2));
}
function statusLabel(status: string) {
  return ({ submitted: "Diajukan", approved: "Disetujui", partial: "Sebagian", rejected: "Ditolak" } as Record<string, string>)[status] ?? status;
}
function statusTone(status: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "rejected") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "partial") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-sky-100 text-sky-700 border-sky-200";
}

type AppNotification = {
  key: string;
  title: string;
  message: string;
  meta: string;
  kind: "approval" | "low-stock" | "status";
  nav: NavKey;
  requestId?: number;
  itemId?: number;
  actionLabel: string;
};

function notificationKindIcon(kind: AppNotification["kind"]) {
  if (kind === "low-stock") return <Activity size={18} />;
  if (kind === "status") return <ClipboardCheck size={18} />;
  return <ClipboardList size={18} />;
}

type ExcelCell = string | number;
function downloadWorkbook(filename: string, sheets: Array<{ name: string; rows: ExcelCell[][] }>) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const columnCount = Math.max(...sheet.rows.map((row) => row.length), 1);
    worksheet["!cols"] = Array.from({ length: columnCount }, (_, index) => {
      const maxLength = Math.max(
        ...sheet.rows.map((row) => String(row[index] ?? "").length),
      );
      return { wch: Math.min(Math.max(maxLength + 2, index === 0 ? 8 : 12), 36) };
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }

  XLSX.writeFile(workbook, filename);
}

export default function Home() {
  const { user, loading, isAuthenticated, logout, error: authError } = useAuth();
  const [active, setActive] = useState<NavKey>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [requestLines, setRequestLines] = useState<Line[]>([{ itemId: 0, requestedQty: 1 }]);
  const [reportMonth, setReportMonth] = useState(getJakartaMonthKeyClient());
  const [roomDemandDays, setRoomDemandDays] = useState<7 | 30 | 90>(30);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [readNotificationKeys, setReadNotificationKeys] = useState<string[]>([]);
  const [notificationTarget, setNotificationTarget] = useState<{ nav: NavKey; requestId?: number; itemId?: number } | null>(null);
  const utils = trpc.useUtils();
  const catalog = trpc.catalog.all.useQuery(undefined, { enabled: isAuthenticated });
  const currentUser = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated });
  const roomAccess = trpc.system.users.myRooms.useQuery(undefined, { enabled: isAuthenticated && user?.role !== "admin" });
  const dashboard = trpc.dashboard.summary.useQuery({ roomId: selectedRoom }, { enabled: isAuthenticated });
  const requests = trpc.requests.list.useQuery({}, { enabled: isAuthenticated });
  const todayRoomLocks = trpc.requests.todayLocks.useQuery(undefined, { enabled: isAuthenticated });
  const adjustments = trpc.adjustments.list.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const monthlyReport = trpc.reports.monthly.useQuery(
    { month: reportMonth },
    { enabled: isAuthenticated && user?.role === "admin" && (active === "reports" || active === "overview") },
  );
  const roomDemand = trpc.analytics.roomDemand.useQuery(
    { days: roomDemandDays },
    { enabled: isAuthenticated && user?.role === "admin" && active === "room-demand" },
  );
  const createRequest = trpc.requests.create.useMutation({
    onSuccess: () => {
      toast.success("Permintaan berhasil diajukan");
      requests.refetch();
      todayRoomLocks.refetch();
      utils.requests.locks.invalidate();
      setRequestLines([{ itemId: 0, requestedQty: 1 }]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Permintaan gagal diajukan.");
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
  const createBulkStocktake = trpc.adjustments.applyBulkStocktake.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Stock opname selesai: ${result.checked} diperiksa, ${result.adjusted} disesuaikan, ${result.noDifference} tanpa selisih.`,
      );
      dashboard.refetch();
      adjustments.refetch();
      utils.catalog.all.invalidate();
    },
  });
  const createItem = trpc.catalog.createItem.useMutation({ onSuccess: () => { toast.success("Master barang dibuat"); utils.catalog.all.invalidate(); } });
  const importItems = trpc.catalog.importItems.useMutation({ onSuccess: (result) => { toast.success(`Impor selesai: ${result.created} baru, ${result.updated} diperbarui`); utils.catalog.all.invalidate(); setActive("stock"); } });

  const rooms = catalog.data?.rooms ?? [];
  const items = catalog.data?.items ?? [];
  const warehouses = catalog.data?.warehouses ?? [];
  const stock = dashboard.data?.stock ?? [];
  const isAdmin = user?.role === "admin";
  const visibleNav = nav.filter((item) => !item.adminOnly || isAdmin);
  const accessibleRooms = roomAccess.data?.map((row: any) => row.room) ?? [];
  const roomAccessErrorMessage = roomAccess.error?.message || "Akses ruangan gagal dimuat.";
  const effectiveRooms = isAdmin ? rooms : accessibleRooms;
  const selectedRoomName = effectiveRooms.find((room: any) => room.id === selectedRoom)?.name;

  const notificationStorageKey = user?.id ? `gologirin-notifications-read:${user.id}` : null;

  useEffect(() => {
    if (!notificationStorageKey) {
      setReadNotificationKeys([]);
      return;
    }
    try {
      const saved = window.localStorage.getItem(notificationStorageKey);
      const parsed = saved ? JSON.parse(saved) : [];
      setReadNotificationKeys(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
    } catch {
      setReadNotificationKeys([]);
    }
  }, [notificationStorageKey]);

  const notifications = useMemo<AppNotification[]>(() => {
    const rows: AppNotification[] = [];

    if (isAdmin) {
      for (const row of requests.data ?? []) {
        if (row?.request?.status !== "submitted") continue;
        rows.push({
          key: `admin:approval:${row.request.id}:submitted`,
          title: "Permintaan menunggu approval",
          message: `${row.room?.name || "Ruangan"} · ${row.request.requestNo}`,
          meta: `${row.lines?.length || 0} item · ${row.request.priority}`,
          kind: "approval",
          nav: "requests",
          requestId: Number(row.request.id),
          actionLabel: "Buka permintaan",
        });
      }

      for (const row of stock) {
        const qty = Number(row?.movementQty ?? 0);
        const minimum = Number(row?.minStock ?? row?.minStock ?? 0);
        if (qty > minimum) continue;
        const itemId = Number(row?.itemId ?? row?.itemId ?? 0);
        const name = row?.name ?? row?.name ?? "Barang";
        rows.push({
          key: `admin:low-stock:${itemId}`,
          title: "Stok perlu dicek",
          message: name,
          meta: `Stok ${formatNumber(qty)} · minimum ${formatNumber(minimum)}`,
          kind: "low-stock",
          nav: "stock",
          itemId,
          actionLabel: "Buka stok",
        });
      }
    } else {
      for (const row of requests.data ?? []) {
        const status = row?.request?.status;
        if (!status) continue;
        const title =
          status === "submitted"
            ? "Permintaan sedang diproses"
            : status === "approved"
              ? "Permintaan disetujui"
              : status === "partial"
                ? "Permintaan disetujui sebagian"
                : status === "rejected"
                  ? "Permintaan ditolak"
                  : `Status permintaan: ${statusLabel(status)}`;
        rows.push({
          key: `user:request:${row.request.id}:${status}:${row.request.updatedAt || row.request.createdAt}`,
          title,
          message: `${row.request.requestNo} · ${row.room?.name || selectedRoomName || "Ruangan"}`,
          meta: `${row.lines?.length || 0} item · ${formatDate(row.request.updatedAt || row.request.createdAt)}`,
          kind: status === "rejected" ? "status" : "approval",
          nav: "requests",
          requestId: Number(row.request.id),
          actionLabel: "Buka permintaan",
        });
      }

      for (const row of stock) {
        const qty = Number(row?.movementQty ?? 0);
        const minimum = Number(row?.minStock ?? row?.minStock ?? 0);
        if (qty > minimum) continue;
        const itemId = Number(row?.itemId ?? row?.itemId ?? 0);
        rows.push({
          key: `user:low-stock:${itemId}`,
          title: "Stok ruangan perlu dicek",
          message: row?.name ?? row?.name ?? "Barang",
          meta: `Stok ${formatNumber(qty)} · minimum ${formatNumber(minimum)}`,
          kind: "low-stock",
          nav: "stock",
          itemId,
          actionLabel: "Buka stok ruangan",
        });
      }
    }

    return rows.slice(0, 20);
  }, [isAdmin, requests.data, stock, selectedRoomName]);

  const unreadNotificationCount = notifications.filter((item) => !readNotificationKeys.includes(item.key)).length;

  function persistReadNotificationKeys(next: string[]) {
    setReadNotificationKeys(next);
    if (notificationStorageKey) {
      try {
        window.localStorage.setItem(notificationStorageKey, JSON.stringify(next.slice(-200)));
      } catch {
        // Notification read state is a convenience; ignore storage failures.
      }
    }
  }

  function markNotificationRead(key: string) {
    if (readNotificationKeys.includes(key)) return;
    persistReadNotificationKeys([...readNotificationKeys, key]);
  }

  function markAllNotificationsRead() {
    persistReadNotificationKeys(Array.from(new Set([...readNotificationKeys, ...notifications.map((item) => item.key)])));
  }

  function openNotification(item: AppNotification) {
    markNotificationRead(item.key);
    setNotificationTarget({ nav: item.nav, requestId: item.requestId, itemId: item.itemId });
    setNotificationOpen(false);
    go(item.nav);
  }

  const requestTotal = useMemo(() => requestLines.reduce((sum, line) => sum + Number(line.requestedQty || 0), 0), [requestLines]);

  useEffect(() => {
    if (!isAdmin && ["inbound", "adjustments", "stocktake", "reports"].includes(active)) {
      setActive("overview");
    }
  }, [active, isAdmin]);

  useEffect(() => {
    if (isAdmin || !roomAccess.data) return;
    const accessIds = accessibleRooms.map((room: any) => Number(room.id));
    if (!accessIds.length) {
      if (selectedRoom !== null) setSelectedRoom(null);
      return;
    }
    const stored = window.sessionStorage.getItem(`gologirin-active-room:${user?.id ?? "unknown"}`);
    const storedId = stored ? Number(stored) : null;
    const nextRoomId = storedId && accessIds.includes(storedId)
      ? storedId
      : dashboard.data?.roomId && accessIds.includes(Number(dashboard.data.roomId))
        ? Number(dashboard.data.roomId)
        : accessIds[0];
    if (nextRoomId !== selectedRoom) setSelectedRoom(nextRoomId);
  }, [dashboard.data?.roomId, isAdmin, roomAccess.data, user?.id, selectedRoom, accessibleRooms.map((room: any) => room.id).join(",")]);

  useEffect(() => {
    if (!isAdmin && user?.id && selectedRoom !== null) {
      window.sessionStorage.setItem(`gologirin-active-room:${user.id}`, String(selectedRoom));
    }
  }, [isAdmin, selectedRoom, user?.id]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#f4f7f6]"><div className="text-center"><Activity className="mx-auto mb-3 animate-pulse text-teal-600" /><p className="text-sm text-slate-500">Menyiapkan ruang kerja…</p></div></div>;
  if (!isAuthenticated) return <LoginScreen />;

  function refreshAll() {
    dashboard.refetch();
    requests.refetch();
    todayRoomLocks.refetch();
    catalog.refetch();
    if (isAdmin) adjustments.refetch();
    if (isAdmin && active === "reports") monthlyReport.refetch();
    if (isAdmin && active === "room-demand") roomDemand.refetch();
  }
  function go(key: NavKey) { setActive(key); setMobileOpen(false); }

  return (
    <div className={`golog-app golog-theme-${active} min-h-screen text-[#07304A]`}>
      <div className="flex min-h-screen">
        <aside className={`${mobileOpen ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0 pointer-events-none"} fixed left-3 right-3 top-[76px] z-40 max-h-[calc(100vh-92px)] overflow-y-auto rounded-2xl border border-white/10 golog-sidebar text-white shadow-2xl transition-all duration-200 md:pointer-events-auto md:inset-y-0 md:left-0 md:right-auto md:top-0 md:z-30 md:max-h-none md:w-72 md:translate-y-0 md:overflow-y-auto md:rounded-none md:border-0 md:opacity-100 md:shadow-none`}>
          <div className="flex min-h-full flex-col px-5 py-5 md:h-full md:py-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-6"><div className="flex items-center gap-3"><div className="golog-brand-mark grid h-11 w-11 place-items-center rounded-2xl"><Hospital size={22} /></div><div><p className="golog-display text-lg not-italic text-[#FFFFFF]">Golog.Irin</p><p className="text-xs text-[#BAE4F0]/75">Rawat Intensif</p></div></div><button className="md:hidden" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
            <div className="mt-7 rounded-xl border border-[#BAE4F0]/15 bg-black/10 p-4"><p className="text-[11px] uppercase tracking-[0.18em] text-[#BAE4F0]/60">Sesi aktif</p><p className="mt-1 truncate font-medium">{user?.name || user?.email || "Pengguna"}</p><div className="mt-2 flex items-center gap-2 text-xs text-[#BAE4F0]/70"><ShieldCheck size={14} />{isAdmin ? "Kepala gudang" : "Petugas ruangan"}</div></div>
            <nav className="mt-8 space-y-1">{visibleNav.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => go(item.key)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${active === item.key ? "golog-nav-active font-semibold" : "text-[#f5ecd5]/70 hover:bg-white/10 hover:text-white"}`}><Icon size={18} />{item.label}</button>; })}</nav>
            <div className="mt-auto border-t border-white/10 pt-5"><button onClick={() => logout()} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-teal-50/70 hover:bg-white/10 hover:text-white"><LogOut size={18} />Keluar</button></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 md:ml-72">
          <header className={`sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200/80 golog-topbar px-5 backdrop-blur md:px-8 ${active === "overview" ? "hidden md:flex" : ""}`}><div className="flex items-center gap-3"><button className="rounded-xl p-2 hover:bg-white md:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Instalasi Rawat Intensif</p><h1 className="text-xl font-semibold tracking-tight">{visibleNav.find((x) => x.key === active)?.label}</h1></div></div><div className="flex items-center gap-2">{!isAdmin && accessibleRooms.length > 0 && <select aria-label="Ruangan aktif" value={selectedRoom ?? ""} onChange={(event) => { const nextRoomId = Number(event.target.value); if (accessibleRooms.some((room: any) => Number(room.id) === nextRoomId)) setSelectedRoom(nextRoomId); }} className="hidden h-10 max-w-[180px] rounded-xl border border-[#9CCED8] bg-[#FFFFFF] px-3 text-sm font-semibold text-[#07304A] outline-none sm:block">{accessibleRooms.map((room: any) => <option key={room.id} value={room.id}>{room.name}</option>)}</select>}<button
              type="button"
              title="Notifikasi"
              aria-label="Notifikasi"
              onClick={() => setNotificationOpen(true)}
              className="relative rounded-xl border border-[#9CCED8] bg-[#FFFFFF] p-2.5 text-[#07304A] hover:bg-[#DCEEF2]"
            >
              <Bell size={17} />
              {unreadNotificationCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#FF6500] ring-2 ring-[#FFFFFF]" />}
            </button><button title="Refresh" onClick={refreshAll} className="rounded-xl border border-[#9CCED8] bg-[#FFFFFF] p-2.5 text-slate-500 hover:text-teal-700"><RefreshCw size={17} /></button><div className="hidden rounded-xl border border-[#9CCED8] bg-[#FFFFFF] px-3 py-2 text-right sm:block"><p className="text-xs font-semibold">{user?.name || "Akun aktif"}</p><p className="text-[11px] text-slate-500">{isAdmin ? "Kepala gudang" : "Petugas"}</p></div></div></header>
          <div className={`golog-page mx-auto max-w-[1500px] space-y-6 ${active === "overview" ? "p-0 pb-28 md:p-8 md:pb-8" : "p-5 md:p-8"}`}>
            {active === "overview" && <Overview dashboard={dashboard.data} isAdmin={isAdmin} onGo={go} report={isAdmin ? monthlyReport.data : null} requests={requests.data ?? []} userName={user?.name || user?.username || "Kepala Gudang"} unreadNotificationCount={unreadNotificationCount} onOpenNotifications={() => setNotificationOpen(true)} />}
            {active === "stock" && <StockView stock={stock} isAdmin={isAdmin} items={items} warehouses={warehouses} onCreateItem={(input: any) => createItem.mutate(input)} busy={createItem.isPending} onImport={(rows: any[]) => importItems.mutate({ rows })} importBusy={importItems.isPending} focusItemId={notificationTarget?.nav === "stock" ? notificationTarget.itemId : undefined} />}
            {active === "inbound" && <InboundView items={items} warehouses={warehouses} onSubmit={(input: any) => createInbound.mutate(input)} busy={createInbound.isPending} />}
            {active === "requests" && <RequestsView requests={requests.data ?? []} rooms={rooms} items={items} warehouses={warehouses} isAdmin={isAdmin} currentUserId={currentUser.data?.id} todayRoomLocks={todayRoomLocks.data ?? []} selectedRoom={selectedRoom} selectedRoomName={selectedRoomName} setSelectedRoom={setSelectedRoom} accessibleRooms={accessibleRooms} roomAccessLoading={roomAccess.isLoading} roomAccessError={roomAccessErrorMessage} onRetryRoomAccess={() => roomAccess.refetch()} lines={requestLines} setLines={setRequestLines} total={requestTotal} onCreate={(input: any) => createRequest.mutateAsync(input)} onVerify={(input: any) => verifyRequest.mutate(input)} busy={createRequest.isPending || verifyRequest.isPending} focusRequestId={notificationTarget?.nav === "requests" ? notificationTarget.requestId : undefined} />}
            {active === "adjustments" && <AdjustmentsView adjustments={adjustments.data ?? []} items={items} rooms={rooms} onSubmit={(input: any) => createAdjustment.mutate(input)} busy={createAdjustment.isPending} />}
            {active === "stocktake" && <StockOpnameView stock={stock} items={items} onSubmit={(input: any) => createBulkStocktake.mutate(input)} busy={createBulkStocktake.isPending} />}
            {active === "reports" && <ReportsView report={monthlyReport.data} month={reportMonth} onMonthChange={setReportMonth} />}
            {active === "room-demand" && isAdmin && <RoomDemandView data={roomDemand.data} items={items} days={roomDemandDays} onDaysChange={setRoomDemandDays} />}
          </div>
        </main>
      </div>
      <NotificationCenter
        open={notificationOpen}
        notifications={notifications}
        unreadCount={unreadNotificationCount}
        readNotificationKeys={readNotificationKeys}
        onClose={() => setNotificationOpen(false)}
        onMarkAllRead={markAllNotificationsRead}
        onOpen={openNotification}
      />
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
    <div className="relative min-h-screen overflow-hidden golog-app golog-theme-login text-[#07304A]">
      <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-[#dff5e8]" />
      <div className="absolute -left-28 bottom-[-10rem] h-96 w-96 rounded-full bg-[#dceff6]" />
      <div className="relative mx-auto grid min-h-screen max-w-[1200px] items-center gap-8 px-6 py-7 lg:grid-cols-[1.05fr_.95fr] lg:px-10 xl:px-12">
        <section className="flex flex-col justify-between py-4 lg:py-7">
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

            <div className="mt-12 max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#dff5eb] px-4 py-2 text-xs font-bold text-[#08785e]">
                <ShieldCheck size={15} />
                Sistem Manajemen Gudang
              </div>
              <h1 className="mt-6 text-4xl font-bold leading-[1.06] tracking-[-0.04em] text-[#07304A] md:text-5xl xl:text-6xl">
                Satu alur untuk
                <span className="block text-[#07966f]">stok yang selalu siap.</span>
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-6 text-slate-500 md:text-base">
                Kelola barang masuk, permintaan ruangan, distribusi, dan penyesuaian stok dengan histori yang jelas.
              </p>
            </div>

            <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                { icon: Boxes, title: "Manajemen Stok", text: "Pantau stok dan cegah kekurangan." },
                { icon: ClipboardList, title: "Transaksi Lengkap", text: "Setiap pergerakan tercatat." },
                { icon: ShieldCheck, title: "Audit & Riwayat", text: "Transparan dan mudah ditelusuri." },
              ].map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="rounded-2xl border border-white/80 bg-white/70 p-3.5 shadow-sm backdrop-blur">
                    <div className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl bg-[#e0f7eb] text-[#0091B9]">
                      <Icon size={19} />
                    </div>
                    <p className="text-[13px] font-bold text-[#07304A]">{feature.title}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{feature.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative mt-10 hidden h-40 overflow-hidden rounded-[1.7rem] border border-white bg-gradient-to-b from-[#eaf7fb] to-[#dcecf1] shadow-sm md:block">
            <div className="absolute inset-x-0 bottom-0 h-14 bg-[#c8e1e8]" />
            <div className="absolute bottom-12 left-8 h-24 w-44 rounded-lg border-4 border-[#315563]">
              <div className="absolute left-0 right-0 top-8 border-t-4 border-[#315563]" />
              <div className="absolute left-0 right-0 top-16 border-t-4 border-[#315563]" />
              <div className="absolute left-5 top-[-2px] h-10 w-10 rounded-md bg-[#FFB45C]" />
              <div className="absolute left-20 top-[38px] h-8 w-12 rounded-md bg-[#FFB45C]" />
              <div className="absolute right-4 top-[67px] h-10 w-14 rounded-md bg-[#FFB45C]" />
            </div>
            <div className="absolute bottom-10 left-[39%] h-28 w-28 rounded-full bg-[#75c69d]/35" />
            <div className="absolute bottom-8 left-[47%] h-24 w-12 rounded-t-[2rem] bg-[#1d5960]" />
            <div className="absolute bottom-5 left-[44%] h-10 w-24 rounded-full bg-[#123e48]/20" />
            <div className="absolute bottom-11 right-12 h-24 w-36 rounded-2xl bg-white/60 p-4">
              <div className="h-3 w-20 rounded bg-[#FFB45C]" />
              <div className="mt-3 h-3 w-28 rounded bg-[#FFB45C]" />
              <div className="mt-3 h-3 w-16 rounded bg-[#FFB45C]" />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:pl-4">
          <Card className="w-full max-w-md border-0 golog-panel p-2.5">
            <CardContent className="rounded-[1.35rem] golog-panel-soft p-6 sm:p-8">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#BAE4F0] text-[#07304A]">
                <Hospital size={26} />
              </div>
              <div className="mt-6 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0091B9]">Ruang kerja</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#07304A]">Selamat Datang</h2>
                <p className="mx-auto mt-2.5 max-w-sm text-[13px] leading-5 text-slate-500">
                  Masuk menggunakan username dan password akun Gudang IR.
                </p>
              </div>

              <form onSubmit={handleLogin} className="mt-7 space-y-4">
                <div>
                  <Label htmlFor="golog-username" className="text-sm font-semibold text-[#07304A]">Username</Label>
                  <Input
                    id="golog-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="contoh: kepala.gudang"
                    className="mt-2 h-11 rounded-xl border-[#9CCED8] bg-[#FFFFFF]"
                    disabled={starting}
                  />
                </div>

                <div>
                  <Label htmlFor="golog-password" className="text-sm font-semibold text-[#07304A]">Password</Label>
                  <div className="relative mt-2">
                    <Input
                      id="golog-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="Masukkan password"
                      className="h-11 rounded-xl border-[#9CCED8] bg-[#FFFFFF] pr-11"
                      disabled={starting}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      title={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                      disabled={starting}
                      className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-[#0091B9] disabled:opacity-50"
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
                  className="h-12 w-full rounded-2xl bg-[#0091B9] text-base font-bold text-[#FFFFFF] shadow-lg shadow-[#0091B9]/20 hover:bg-[#004E9B]"
                >
                  {starting ? "Memeriksa akun…" : "Masuk"}
                </Button>
              </form>

              <div className="mt-6 rounded-2xl border border-[#9CCED8] bg-[#FFFFFF] p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f8ef] text-[#0091B9]">
                    <ShieldCheck size={19} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#07304A]">Akses berbasis akun</p>
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

function NotificationCenter({
  open,
  notifications,
  unreadCount,
  readNotificationKeys,
  onClose,
  onMarkAllRead,
  onOpen,
}: {
  open: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  readNotificationKeys: string[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpen: (item: AppNotification) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Notifikasi">
      <button
        type="button"
        aria-label="Tutup notifikasi"
        onClick={onClose}
        className="absolute inset-0 bg-[#07304A]/25 backdrop-blur-[2px]"
      />
      <section className="absolute right-3 top-3 w-[min(420px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border-2 border-[#9CCED8] bg-[#FFFFFF] shadow-[0_20px_50px_rgba(90,71,56,0.25)] md:right-6 md:top-6">
        <div className="flex items-start justify-between border-b border-[#9CCED8]/60 px-5 py-4">
          <div>
            <p className="golog-kicker">Pusat Notifikasi</p>
            <h2 className="mt-1 text-xl font-semibold text-[#07304A]">Notifikasi</h2>
            <p className="mt-1 text-xs text-[#315563]">{unreadCount} belum dibaca</p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button type="button" onClick={onMarkAllRead} className="rounded-lg border border-[#9CCED8] px-2.5 py-1.5 text-[11px] font-semibold text-[#07304A] hover:bg-[#DCEEF2]">
                Tandai semua
              </button>
            )}
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-[#07304A] hover:bg-[#DCEEF2]" aria-label="Tutup">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-3">
          {notifications.length ? (
            <div className="space-y-2">
              {notifications.map((item) => {
                const unread = !readNotificationKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onOpen(item)}
                    className={"flex w-full items-start gap-3 rounded-xl border p-3 text-left transition " + (unread ? "border-[#FFD500] bg-[#E6F4F7]" : "border-[#B8D5DE] bg-[#FFFFFF] hover:bg-[#F4FAFC]")}
                  >
                    <div className={"mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl " + (item.kind === "low-stock" ? "bg-[#f0d3ca] text-[#b56557]" : item.kind === "status" ? "bg-[#e3d6b1] text-[#6f5d48]" : "bg-[#BAE4F0] text-[#004E9B]")}>
                      {notificationKindIcon(item.kind)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#07304A]">{item.title}</p>
                        {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#FF6500]" />}
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-[#315563]">{item.message}</p>
                      <p className="mt-1 text-[11px] text-[#55727C]">{item.meta}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#004E9B]">{item.actionLabel}<ChevronRight size={14} /></div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <Bell className="mx-auto text-[#0091B9]" size={26} />
              <p className="mt-3 text-sm font-semibold text-[#07304A]">Tidak ada notifikasi</p>
              <p className="mt-1 text-xs text-[#55727C]">Semua aktivitas penting sedang tertangani.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}



function RoomDemandView({
  data,
  items,
  days,
  onDaysChange,
}: {
  data: any;
  items: any[];
  days: 7 | 30 | 90;
  onDaysChange: (value: 7 | 30 | 90) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="golog-kicker">Analitik ruangan</p>
          <h1 className="golog-display text-3xl tracking-tight text-[#07304A]">Pola Permintaan Ruangan</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#315563]">
            Satu barang langsung terlihat di beberapa ruangan. Angka menunjukkan rata-rata distribusi pada hari saat ruangan menerima barang dalam periode yang dipilih.
          </p>
        </div>
        <div className="flex shrink-0 rounded-xl border border-[#9CCED8] bg-[#FFFFFF] p-1">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onDaysChange(value as 7 | 30 | 90)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${days === value ? "bg-[#07304A] text-white" : "text-[#315563] hover:bg-[#F4FAFC]"}`}
            >
              {value === 7 ? "1 minggu" : value + " hari"}
            </button>
          ))}
        </div>
      </div>

      <RoomDemandPanel data={data} items={items} />
    </div>
  );
}

function RoomDemandPanel({
  data,
  items,
}: {
  data: any;
  items: any[];
}) {
  const [search, setSearch] = useState("");
  const [selectedSourceWarehouseId, setSelectedSourceWarehouseId] = useState<number | "all">("all");

  const roomSummary = Array.isArray(data?.roomSummary) ? data.roomSummary : [];
  const itemRows = Array.isArray(data?.itemRows) ? data.itemRows : [];
  const sourceWarehouses = Array.isArray(data?.sourceWarehouses) ? data.sourceWarehouses : [];

  const roomColumns = useMemo(
    () => roomSummary.map((room: any) => ({ id: Number(room.roomId), name: room.roomName })),
    [roomSummary],
  );

  const sourceNameById = useMemo(
    () => new Map(sourceWarehouses.map((warehouse: any) => [Number(warehouse.id), warehouse.name])),
    [sourceWarehouses],
  );

  const itemMap = useMemo(() => {
    const map = new Map<number, any>();

    for (const item of items) {
      const sourceWarehouseId = item.sourceWarehouseId == null ? null : Number(item.sourceWarehouseId);
      map.set(Number(item.id), {
        id: Number(item.id),
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        sourceWarehouseId,
        sourceWarehouseName: sourceWarehouseId ? sourceNameById.get(sourceWarehouseId) ?? "Sumber tidak diketahui" : "Belum ditetapkan",
      });
    }

    for (const row of itemRows) {
      const id = Number(row.itemId);
      const sourceWarehouseId = row.sourceWarehouseId == null ? null : Number(row.sourceWarehouseId);
      const existing = map.get(id);

      map.set(id, {
        id,
        name: existing?.name ?? row.itemName,
        sku: existing?.sku ?? row.sku,
        unit: existing?.unit ?? row.unit,
        sourceWarehouseId: existing?.sourceWarehouseId ?? sourceWarehouseId,
        sourceWarehouseName:
          existing?.sourceWarehouseName ??
          row.sourceWarehouseName ??
          (sourceWarehouseId ? sourceNameById.get(sourceWarehouseId) ?? "Sumber tidak diketahui" : "Belum ditetapkan"),
      });
    }

    return map;
  }, [items, itemRows, sourceNameById]);

  const activityByItem = useMemo(() => {
    const map = new Map<number, Map<number, any>>();
    for (const row of itemRows) {
      const itemId = Number(row.itemId);
      const roomId = Number(row.roomId);
      if (!map.has(itemId)) map.set(itemId, new Map());
      map.get(itemId)?.set(roomId, row);
    }
    return map;
  }, [itemRows]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = Array.from(itemMap.values());

    return all
      .filter((item) => {
        const activity = activityByItem.get(item.id);
        const hasActivity = Boolean(activity?.size);
        const matchesSource =
          selectedSourceWarehouseId === "all" ||
          Number(item.sourceWarehouseId) === Number(selectedSourceWarehouseId);

        if (!matchesSource) return false;
        if (!query) return hasActivity;

        return [item.name, item.sku, item.unit].some((value) =>
          String(value ?? "").toLowerCase().includes(query),
        );
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
  }, [activityByItem, itemMap, search, selectedSourceWarehouseId]);

  const searched = Boolean(search.trim());

  const sourceLabel =
    selectedSourceWarehouseId === "all"
      ? "Semua gudang sumber"
      : sourceWarehouses.find((warehouse: any) => Number(warehouse.id) === Number(selectedSourceWarehouseId))?.name ?? "Gudang sumber";

  return (
    <Card className="overflow-hidden border-[#9CCED8]/70 bg-[#FFFFFF] shadow-sm">
      <CardHeader className="border-b border-[#C7E0E6]/70 bg-[#FFFFFF]/55">
        <div className="space-y-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="golog-kicker">Perbandingan antar-ruangan</p>
              <CardTitle className="mt-1">Distribusi per Barang</CardTitle>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-[#315563]">
                Baris = satu barang. Kolom = ruangan. Gunakan pencarian untuk item tertentu dan filter gudang sumber untuk memisahkan 4 gudang pusat.
              </p>
            </div>

            <div className="w-full lg:max-w-md">
              <div className="relative">
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#55727C]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama barang atau SKU…"
                  className="h-11 rounded-xl border-2 border-[#9CCED8] bg-[#FFFFFF] pl-10 text-[#07304A]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedSourceWarehouseId("all")}
              className={
                selectedSourceWarehouseId === "all"
                  ? "rounded-full border border-[#07304A] bg-[#07304A] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                  : "rounded-full border border-[#B8D5DE] bg-[#FFFFFF] px-2.5 py-1.5 text-[11px] font-semibold text-[#315563] hover:bg-[#F4FAFC]"
              }
            >
              Semua sumber
            </button>

            {sourceWarehouses.map((warehouse: any) => {
              const warehouseId = Number(warehouse.id);
              const active = selectedSourceWarehouseId === warehouseId;
              return (
                <button
                  key={warehouseId}
                  type="button"
                  onClick={() => setSelectedSourceWarehouseId(warehouseId)}
                  className={
                    active
                      ? "rounded-full border border-[#0091B9] bg-[#BAE4F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#4e5e29]"
                      : "rounded-full border border-[#B8D5DE] bg-[#FFFFFF] px-3 py-2 text-xs font-semibold text-[#315563] hover:bg-[#F4FAFC]"
                  }
                >
                  {warehouse.name}
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[#55727C]">
            {searched
              ? "Hasil pencarian: " + formatNumber(rows.length) + " item · " + sourceLabel
              : "Menampilkan " + formatNumber(rows.length) + " item aktif pada " + sourceLabel}
          </div>
          <div className="rounded-full border border-[#B8D5DE] bg-[#FFFFFF] px-3 py-1.5 text-[11px] font-semibold text-[#315563]">
            Periode: {data?.days === 7 ? "1 minggu" : (data?.days ?? 0) + " hari"}
          </div>
        </div>

        <div className="max-h-[805px] overflow-auto rounded-2xl border border-[#C7E0E6]">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 bg-[#FFFFFF] text-left text-xs uppercase tracking-[0.1em] text-[#55727C]">
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[220px] border-r border-[#C7E0E6] bg-[#FFFFFF] px-3 py-2.5">Barang</th>
                <th className="min-w-[82px] px-3 py-3">Unit</th>
                {roomColumns.map((room: any) => (
                  <th key={room.id} className="min-w-[110px] border-l border-[#D5E8ED] px-3 py-3 text-right">{room.name}</th>
                ))}
                <th className="min-w-[125px] border-l border-[#D5E8ED] px-3 py-3 text-right">Total</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#D5E8ED] bg-[#FFFFFF]">
              {rows.map((item: any) => {
                const byRoom = activityByItem.get(item.id) ?? new Map();
                const totalQty = roomColumns.reduce((sum: number, room: any) => sum + Number(byRoom.get(room.id)?.totalQty ?? 0), 0);
                const totalActiveDays = roomColumns.reduce((sum: number, room: any) => sum + Number(byRoom.get(room.id)?.activeDays ?? 0), 0);
                const totalAverage = totalActiveDays > 0 ? totalQty / totalActiveDays : 0;

                return (
                  <tr key={item.id} className="hover:bg-[#FFFFFF]/45">
                    <td className="sticky left-0 z-[1] border-r border-[#D5E8ED] bg-[#FFFFFF] px-4 py-3">
                      <p className="font-semibold text-[#07304A]">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-[#55727C]">{item.sku}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[#315563]">{item.unit}</td>

                    {roomColumns.map((room: any) => {
                      const row = byRoom.get(room.id);
                      const avg = Number(row?.avgPerActiveDay ?? 0);
                      const total = Number(row?.totalQty ?? 0);
                      const activeDays = Number(row?.activeDays ?? 0);

                      return (
                        <td
                          key={room.id}
                          title={row ? formatNumber(total) + " " + item.unit + " dalam " + formatNumber(activeDays) + " hari aktif" : "Tidak ada distribusi"}
                          className={"border-l border-[#eee4cf] px-3 py-3 text-right " + (row ? "bg-[#E6F4F7]/35" : "")}
                        >
                          {row ? (
                            <>
                              <p className="font-semibold text-[#004E9B]">{formatNumber(avg)}</p>
                              <p className="mt-0.5 text-[10px] text-[#55727C]">{formatNumber(total)} total</p>
                            </>
                          ) : (
                            <span className="text-[#b4a58c]">—</span>
                          )}
                        </td>
                      );
                    })}

                    <td className="border-l border-[#D5E8ED] px-3 py-2.5 text-right">
                      <p className="font-semibold text-[#07304A]">{formatNumber(totalQty)}</p>
                      <p className="mt-0.5 text-[10px] text-[#55727C]">{formatNumber(totalAverage)}/hari aktif</p>
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={roomColumns.length + 3} className="px-5 py-12 text-center">
                    <Search className="mx-auto text-[#b4a58c]" size={24} />
                    <p className="mt-3 font-semibold text-[#07304A]">
                      {searched ? "Barang tidak ditemukan" : "Belum ada distribusi dalam periode ini"}
                    </p>
                    <p className="mt-1 text-sm text-[#55727C]">
                      {searched ? "Coba nama barang atau SKU lain." : "Pilih periode atau gudang sumber lain untuk melihat histori distribusi."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#D5E8ED] pt-3">
          <div className="text-xs text-[#55727C]">
            {rows.length
              ? "Menampilkan " + formatNumber(rows.length) + " barang · tabel menampilkan maksimal 15 baris sekaligus"
              : "Tidak ada baris untuk ditampilkan"}
          </div>
          {rows.length > 15 && (
            <div className="shrink-0 text-[11px] font-semibold text-[#315563]">
              ↕ Gulir tabel untuk melihat barang lainnya
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl border border-[#C7E0E6] bg-[#F4FAFC]/45 px-3 py-2.5 text-xs leading-5 text-[#315563]">
          Angka utama di tiap kolom adalah <strong>rata-rata distribusi per hari aktif</strong>. Data dapat dipisahkan berdasarkan gudang sumber: Gudang Farmasi, Gudang RT, CSSD, dan Laboratorium.
        </div>
      </CardContent>
    </Card>
  );
}
function Overview({
  dashboard,
  isAdmin,
  onGo,
  report,
  requests = [],
  userName = "Pengguna",
  unreadNotificationCount = 0,
  onOpenNotifications,
}: {
  dashboard: any;
  isAdmin: boolean;
  onGo: (key: NavKey) => void;
  report?: any;
  requests?: any[];
  userName?: string;
  unreadNotificationCount?: number;
  onOpenNotifications?: () => void;
}) {
  const stats = dashboard?.stats ?? { items: 0, lowStock: 0, pending: 0, todayIn: 0 };
  const roomName = dashboard?.roomName;

  const reportSummary = useMemo(() => {
    if (!report) return { items: stats.items, lowStock: stats.lowStock, distribution: 0, rooms: 0 };
    const pivot = computeMonthlyPivot(report);
    return {
      items: report.items?.length ?? stats.items,
      lowStock: pivot.categories.reduce((sum: number, category: any) => sum + category.rows.filter((row: any) => row.isLowStock).length, 0),
      distribution: pivot.categories.reduce((sum: number, category: any) => sum + category.rows.reduce((categorySum: number, row: any) => categorySum + row.keluarTotal, 0), 0),
      rooms: pivot.rooms.length,
    };
  }, [report, stats.items, stats.lowStock]);

  if (isAdmin) {
    const cards = [
      { label: "SKU aktif", value: reportSummary.items, hint: "Master barang aktif", icon: Boxes, tint: "bg-teal-50 text-teal-700" },
      { label: "Stok rendah", value: reportSummary.lowStock, hint: "Di bawah atau sama dengan minimum", icon: Activity, tint: "bg-rose-50 text-rose-700" },
      { label: "Distribusi bulan ini", value: reportSummary.distribution, hint: "Total barang keluar ke ruangan", icon: Truck, tint: "bg-sky-50 text-sky-700" },
      { label: "Ruangan aktif", value: reportSummary.rooms, hint: "Ruangan yang terdaftar aktif", icon: Hospital, tint: "bg-emerald-50 text-emerald-700" },
    ];

    return <>
      <div className="md:hidden">
        <MobileAdminOverview dashboard={dashboard} requests={requests} userName={userName} onGo={onGo} unreadNotificationCount={unreadNotificationCount} onOpenNotifications={onOpenNotifications} />
      </div>
      <div className="hidden md:block space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((item) => {
            const Icon = item.icon;
            return <Card key={item.label} className="border-slate-200/80 shadow-sm"><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(item.value)}</p><p className="mt-1 text-xs text-slate-400">{item.hint}</p></div><div className={"rounded-2xl p-3 " + item.tint}><Icon size={20} /></div></CardContent></Card>;
          })}
        </div>
        {report && <CategoryPivotTable report={report} />}
        <Card className="border-slate-200/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle>Aktivitas Gudang Pusat</CardTitle><p className="mt-1 text-sm text-slate-500">Pergerakan terakhir di Gudang Pusat.</p></div>
            <Button variant="outline" size="sm" onClick={() => onGo("reports")}><FileDown size={15} className="mr-2" />Laporan</Button>
          </CardHeader>
          <CardContent><div className="divide-y divide-slate-100">{(dashboard?.recent ?? []).length ? dashboard.recent.map((row: any) => <div key={row.movement.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className={"rounded-xl p-2 " + (row.movement.quantity >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{row.movement.quantity >= 0 ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{row.item?.name ?? "Item"}</p><p className="text-xs text-slate-400">{row.movement.movementType === "in" ? "Barang masuk" : row.movement.movementType === "out" ? "Keluar gudang" : "Penyesuaian"} · {formatDate(row.movement.occurredAt)}</p></div></div><p className={"shrink-0 text-sm font-semibold " + (row.movement.quantity >= 0 ? "text-emerald-700" : "text-rose-700")}>{row.movement.quantity >= 0 ? "+" : ""}{formatNumber(row.movement.quantity)}</p></div>) : <EmptyState title="Belum ada aktivitas" text="Catat barang masuk untuk memulai kartu stok." />}</div></CardContent>
        </Card>
      </div>
    </>;
  }

  return <>
    <div className="md:hidden">
      <MobileUserOverview dashboard={dashboard} requests={requests} userName={userName} roomName={roomName} onGo={onGo} unreadNotificationCount={unreadNotificationCount} onOpenNotifications={onOpenNotifications} />
    </div>
    <div className="hidden md:block space-y-6">
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Jenis barang di ruangan", value: stats.items, hint: roomName ? roomName : "Belum ada ruangan aktif", icon: Boxes, tint: "bg-teal-50 text-teal-700" },
          { label: "Stok perlu perhatian", value: stats.lowStock, hint: "Stok ruangan di bawah minimum", icon: Activity, tint: "bg-amber-50 text-amber-700" },
          { label: "Permintaan diajukan", value: stats.pending, hint: "Masih menunggu verifikasi", icon: ClipboardCheck, tint: "bg-sky-50 text-sky-700" },
          { label: "Masuk hari ini", value: stats.todayIn, hint: "Unit masuk ke ruangan", icon: ArrowDownToLine, tint: "bg-emerald-50 text-emerald-700" },
        ].map((item) => {
          const Icon = item.icon;
          return <Card key={item.label} className="border-slate-200/80 shadow-sm"><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(item.value)}</p><p className="mt-1 text-xs text-slate-400">{item.hint}</p></div><div className={"rounded-2xl p-3 " + item.tint}><Icon size={20} /></div></CardContent></Card>;
        })}
      </div>
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <div><CardTitle>Aktivitas ruangan</CardTitle><p className="mt-1 text-sm text-slate-500">{roomName ? "Pergerakan terakhir di " + roomName + "." : "Belum ada ruangan aktif."}</p></div>
        </CardHeader>
        <CardContent><div className="divide-y divide-slate-100">{(dashboard?.recent ?? []).length ? dashboard.recent.map((row: any) => <div key={row.movement.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className={"rounded-xl p-2 " + (row.movement.quantity >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{row.movement.quantity >= 0 ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{row.item?.name ?? "Item"}</p><p className="text-xs text-slate-400">{row.movement.movementType === "in" ? "Barang masuk" : row.movement.movementType === "out" ? "Keluar" : "Penyesuaian"} · {formatDate(row.movement.occurredAt)}</p></div></div><p className={"shrink-0 text-sm font-semibold " + (row.movement.quantity >= 0 ? "text-emerald-700" : "text-rose-700")}>{row.movement.quantity >= 0 ? "+" : ""}{formatNumber(row.movement.quantity)}</p></div>) : <EmptyState title="Belum ada aktivitas" text={roomName ? "Belum ada barang masuk ke ruangan." : "Belum ada ruangan aktif."} />}</div></CardContent>
      </Card>
    </div>
  </>;
}

function MobileAdminOverview({
  dashboard,
  requests,
  userName,
  onGo,
  unreadNotificationCount = 0,
  onOpenNotifications,
}: {
  dashboard: any;
  requests: any[];
  userName: string;
  onGo: (key: NavKey) => void;
  unreadNotificationCount?: number;
  onOpenNotifications?: () => void;
}) {
  const stats = dashboard?.stats ?? { items: 0, lowStock: 0, pending: 0, todayIn: 0 };
  const pendingRequests = requests.filter((row) => row?.request?.status === "submitted");
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "GI";

  return (
    <div className="min-h-[100vh] golog-mobile-surface px-4 pt-7 sm:px-6">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#07304A] text-sm font-bold text-[#FFFFFF] shadow-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Welcome back,</p>
              <p className="truncate text-[18px] font-semibold tracking-tight text-[#07304A]">{userName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenNotifications?.()}
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFFFFF] text-[#07304A] shadow-sm ring-1 ring-[#9CCED8]"
            aria-label="Notifikasi"
          >
            <Bell size={20} />
            {unreadNotificationCount > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#FF6500] ring-2 ring-[#FFFFFF]" />}
          </button>
        </div>

        <button
          type="button"
          onClick={() => onGo("stock")}
          className="flex w-full items-center gap-3 rounded-2xl bg-[#BAE4F0] px-4 py-3.5 text-left shadow-inner ring-1 ring-slate-200/70"
        >
          <Search size={21} className="text-[#42566d]" />
          <span className="text-sm text-slate-500">Cari SKU atau nama barang</span>
        </button>

        <button
          type="button"
          onClick={() => onGo("requests")}
          className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-[#FFFFFF] px-4 py-3.5 text-left shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><ClipboardCheck size={18} /></div>
            <div>
              <p className="text-xs font-semibold text-amber-800">{pendingRequests.length} Permintaan menunggu</p>
              <p className="mt-0.5 text-[11px] text-amber-700/80">Perlu ditinjau Kepala Gudang</p>
            </div>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">Review</span>
        </button>

        <div className="rounded-[1.8rem] bg-[#0091B9] p-5 text-white shadow-[0_18px_45px_rgba(13,184,137,0.24)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[20px] font-semibold tracking-tight">Aksi Gudang</p>
              <p className="mt-1 text-sm text-emerald-50/90">Akses cepat ke pekerjaan gudang utama.</p>
            </div>
            <button
              type="button"
              onClick={() => onGo("stocktake")}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20 transition hover:bg-white/20"
              aria-label="Buka stock opname"
            >
              <ClipboardType size={25} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onGo("inbound")}
            className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70"
          >
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><ArrowDownToLine size={22} /></div>
            <p className="mt-3 text-sm font-semibold text-[#07304A]">Barang Masuk</p>
            <p className="mt-1 text-xs text-slate-400">Catat penerimaan</p>
          </button>
          <button
            type="button"
            onClick={() => onGo("requests")}
            className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70"
          >
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-50 text-orange-500"><Truck size={22} /></div>
            <p className="mt-3 text-sm font-semibold text-[#07304A]">Distribusi</p>
            <p className="mt-1 text-xs text-slate-400">Kelola permintaan</p>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Total SKU</p>
            <p className="mt-2 text-[27px] font-bold tracking-tight text-[#07304A]">{formatNumber(stats.items)}</p>
            <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">Aktif</span>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Stok Rendah</p>
            <p className="mt-2 text-[27px] font-bold tracking-tight text-[#07304A]">{formatNumber(stats.lowStock)}</p>
            <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600">{stats.lowStock ? "Perlu cek" : "Aman"}</span>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold tracking-tight text-[#07304A]">Pending Approvals</h2>
            <button type="button" onClick={() => onGo("requests")} className="text-xs font-bold text-emerald-600">
              {pendingRequests.length} Required
            </button>
          </div>
          <div className="space-y-3">
            {pendingRequests.slice(0, 3).map((row: any) => {
              const priority = row.request.priority;
              const priorityClass =
                priority === "darurat"
                  ? "text-rose-600"
                  : priority === "mendesak"
                    ? "text-amber-600"
                    : "text-slate-500";
              return (
                <button
                  key={row.request.id}
                  type="button"
                  onClick={() => onGo("requests")}
                  className="w-full rounded-2xl border-l-4 border-amber-400 bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-[10px] font-extrabold uppercase tracking-[0.12em] ${priorityClass}`}>{priority} · priority</span>
                    <span className="text-[10px] italic text-slate-400">{formatDate(row.request.createdAt)}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-[#07304A]">{row.request.requestNo}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{row.room?.name || "Ruangan"} · {row.lines?.length || 0} item</p>
                  <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-500">Buka antrean approval</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600">Review <ChevronRight size={14} /></span>
                  </div>
                </button>
              );
            })}
            {!pendingRequests.length && (
              <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/70">
                <ClipboardCheck className="mx-auto text-emerald-500" size={22} />
                <p className="mt-2 text-sm font-semibold text-[#07304A]">Tidak ada approval tertunda</p>
                <p className="mt-1 text-xs text-slate-400">Antrean gudang sedang bersih.</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold tracking-tight text-[#07304A]">Recent Activity</h2>
            <button type="button" onClick={() => onGo("reports")} className="text-xs font-bold text-emerald-600">See all</button>
          </div>
          <div className="space-y-2.5">
            {(dashboard?.recent ?? []).slice(0, 5).map((row: any) => {
              const positive = Number(row.movement.quantity) >= 0;
              return (
                <button
                  type="button"
                  key={row.movement.id}
                  onClick={() => onGo("stock")}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-sm ring-1 ring-slate-200/70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                      {positive ? <ArrowDownToLine size={19} /> : <ArrowUpFromLine size={19} />}
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-[#07304A]">{row.item?.name || "Item"}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {row.movement.movementType === "in" ? "Barang masuk" : row.movement.movementType === "out" ? "Keluar gudang" : "Penyesuaian"} · {formatDate(row.movement.occurredAt)}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-bold ${positive ? "text-emerald-600" : "text-rose-500"}`}>
                      {positive ? "+" : ""}{formatNumber(row.movement.quantity)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">{formatDate(row.movement.occurredAt)}</p>
                  </div>
                </button>
              );
            })}
            {!dashboard?.recent?.length && (
              <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/70">
                <History className="mx-auto text-slate-300" size={23} />
                <p className="mt-2 text-sm font-semibold text-[#07304A]">Belum ada aktivitas</p>
                <p className="mt-1 text-xs text-slate-400">Aktivitas gudang akan tampil di sini.</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-1 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Settings2 size={14} />
            <span>Gudang IR · Mobile workspace</span>
          </div>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-xl golog-bottom-nav px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 shadow-[0_-14px_30px_rgba(20,39,61,0.12)]">
        <div className="relative grid grid-cols-5 items-end">
          <button type="button" onClick={() => onGo("overview")} className="flex flex-col items-center gap-1 text-[10px] font-semibold golog-bottom-active">
            <BarChart3 size={19} />
            Home
          </button>
          <button type="button" onClick={() => onGo("stock")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400">
            <Boxes size={19} />
            Stok
          </button>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => onGo("inbound")}
              className="relative -mt-9 grid h-16 w-16 place-items-center rounded-full border-4 border-[#FFFFFF] bg-[#0091B9] text-white shadow-[0_12px_28px_rgba(90,71,56,0.24)]"
              aria-label="Barang Masuk"
              title="Barang Masuk"
            >
              <PackagePlus size={25} />
            </button>
          </div>
          <button type="button" onClick={() => onGo("requests")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400">
            <ClipboardList size={19} />
            Permintaan
          </button>
          <button type="button" onClick={() => onGo("reports")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400">
            <FileDown size={19} />
            Laporan
          </button>
        </div>
      </nav>
    </div>
  );
}


function MobileUserOverview({
  dashboard,
  requests,
  userName,
  roomName,
  onGo,
  unreadNotificationCount = 0,
  onOpenNotifications,
}: {
  dashboard: any;
  requests: any[];
  userName: string;
  roomName?: string | null;
  onGo: (key: NavKey) => void;
  unreadNotificationCount?: number;
  onOpenNotifications?: () => void;
}) {
  const stats = dashboard?.stats ?? { items: 0, lowStock: 0, pending: 0, todayIn: 0 };
  const pendingRequests = requests.filter((row) => row?.request?.status === "submitted");
  const initials = userName.split(/\\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "GI";

  return (
    <div className="min-h-[100vh] golog-mobile-surface px-4 pt-7 sm:px-6">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#07304A] text-sm font-bold text-[#FFFFFF] shadow-sm">{initials}</div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Welcome back,</p>
              <p className="truncate text-[18px] font-semibold tracking-tight text-[#07304A]">{userName}</p>
              <p className="truncate text-[11px] text-slate-400">{roomName || "Ruangan belum dipilih"}</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpenNotifications?.()} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFFFFF] text-[#07304A] shadow-sm ring-1 ring-[#9CCED8]" aria-label="Notifikasi">
            <Bell size={20} />
            {pendingRequests.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
          </button>
        </div>

        <button type="button" onClick={() => onGo("stock")} className="flex w-full items-center gap-3 rounded-2xl bg-[#BAE4F0] px-4 py-3.5 text-left shadow-inner ring-1 ring-slate-200/70">
          <Search size={21} className="text-[#42566d]" />
          <span className="text-sm text-slate-500">Cari SKU atau nama barang di ruangan</span>
        </button>

        <button type="button" onClick={() => onGo("requests")} className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-[#FFFFFF] px-4 py-3.5 text-left shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><ClipboardCheck size={18} /></div>
            <div>
              <p className="text-xs font-semibold text-amber-800">{pendingRequests.length} Permintaan menunggu</p>
              <p className="mt-0.5 text-[11px] text-amber-700/80">{pendingRequests.length ? "Menunggu verifikasi Kepala Gudang" : "Tidak ada permintaan yang tertunda"}</p>
            </div>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">Lihat</span>
        </button>

        <div className="rounded-[1.8rem] bg-[#0091B9] p-5 text-white shadow-[0_18px_45px_rgba(13,184,137,0.24)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[20px] font-semibold tracking-tight">Ajukan Kebutuhan</p>
              <p className="mt-1 text-sm text-emerald-50/90">{roomName ? "Buat permintaan BMHP untuk " + roomName + "." : "Pilih ruangan lalu buat permintaan BMHP."}</p>
            </div>
            <button type="button" onClick={() => onGo("requests")} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20 transition hover:bg-white/20" aria-label="Buat permintaan">
              <Truck size={25} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => onGo("stock")} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Boxes size={22} /></div>
            <p className="mt-3 text-sm font-semibold text-[#07304A]">Stok Ruangan</p>
            <p className="mt-1 text-xs text-slate-400">Cek saldo BMHP</p>
          </button>
          <button type="button" onClick={() => onGo("requests")} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-50 text-orange-500"><ClipboardList size={22} /></div>
            <p className="mt-3 text-sm font-semibold text-[#07304A]">Permintaan</p>
            <p className="mt-1 text-xs text-slate-400">Ajukan kebutuhan</p>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Jenis Barang</p>
            <p className="mt-2 text-[27px] font-bold tracking-tight text-[#07304A]">{formatNumber(stats.items)}</p>
            <span className="mt-1 inline-flex max-w-full truncate rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">{roomName || "Ruangan"}</span>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Stok Perlu Cek</p>
            <p className="mt-2 text-[27px] font-bold tracking-tight text-[#07304A]">{formatNumber(stats.lowStock)}</p>
            <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600">{stats.lowStock ? "Perlu perhatian" : "Aman"}</span>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold tracking-tight text-[#07304A]">Permintaan Terakhir</h2>
            <button type="button" onClick={() => onGo("requests")} className="text-xs font-bold text-emerald-600">Lihat semua</button>
          </div>
          <div className="space-y-3">
            {requests.slice(0, 3).map((row: any) => (
              <button key={row.request.id} type="button" onClick={() => onGo("requests")} className="w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{statusLabel(row.request.status)}</span>
                  <span className="text-[10px] italic text-slate-400">{formatDate(row.request.createdAt)}</span>
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-[#07304A]">{row.request.requestNo}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{row.lines?.length || 0} item · {row.request.priority}</p>
                <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-500">{row.request.status === "submitted" ? "Menunggu verifikasi" : "Buka detail permintaan"}</span>
                  <span className="inline-flex items-center gap-1 text-emerald-600">Lihat <ChevronRight size={14} /></span>
                </div>
              </button>
            ))}
            {!requests.length && (
              <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/70">
                <ClipboardList className="mx-auto text-slate-300" size={22} />
                <p className="mt-2 text-sm font-semibold text-[#07304A]">Belum ada permintaan</p>
                <p className="mt-1 text-xs text-slate-400">Ajukan kebutuhan pertama untuk ruangan Anda.</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold tracking-tight text-[#07304A]">Aktivitas Ruangan</h2>
            <button type="button" onClick={() => onGo("stock")} className="text-xs font-bold text-emerald-600">Cek stok</button>
          </div>
          <div className="space-y-2.5">
            {(dashboard?.recent ?? []).slice(0, 5).map((row: any) => {
              const positive = Number(row.movement.quantity) >= 0;
              return (
                <button key={row.movement.id} type="button" onClick={() => onGo("stock")} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-sm ring-1 ring-slate-200/70">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">{positive ? <ArrowDownToLine size={19} /> : <ArrowUpFromLine size={19} />}</div>
                    <div className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-[#07304A]">{row.item?.name || "Item"}</p>
                      <p className="truncate text-[11px] text-slate-400">{row.movement.movementType === "in" ? "Masuk ruangan" : row.movement.movementType === "out" ? "Keluar" : "Penyesuaian"} · {formatDate(row.movement.occurredAt)}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={"text-sm font-bold " + (positive ? "text-emerald-600" : "text-rose-500")}>{positive ? "+" : ""}{formatNumber(row.movement.quantity)}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{formatDate(row.movement.occurredAt)}</p>
                  </div>
                </button>
              );
            })}
            {!dashboard?.recent?.length && (
              <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/70">
                <History className="mx-auto text-slate-300" size={23} />
                <p className="mt-2 text-sm font-semibold text-[#07304A]">Belum ada aktivitas</p>
                <p className="mt-1 text-xs text-slate-400">Distribusi yang disetujui akan tampil di sini.</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-1 text-xs text-slate-400">
          <div className="flex items-center gap-2"><Settings2 size={14} /><span>Gudang IR · Mobile workspace · {roomName || "Ruangan belum dipilih"}</span></div>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-xl golog-bottom-nav px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 shadow-[0_-14px_30px_rgba(20,39,61,0.12)]">
        <div className="relative grid grid-cols-5 items-end">
          <button type="button" onClick={() => onGo("overview")} className="flex flex-col items-center gap-1 text-[10px] font-semibold golog-bottom-active"><BarChart3 size={19} />Home</button>
          <button type="button" onClick={() => onGo("stock")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400"><Boxes size={19} />Stok</button>
          <div className="flex justify-center">
            <button type="button" onClick={() => onGo("requests")} className="relative -mt-9 grid h-16 w-16 place-items-center rounded-full border-4 border-[#FFFFFF] bg-[#0091B9] text-white shadow-[0_12px_28px_rgba(13,184,137,0.35)]" aria-label="Ajukan Permintaan"><Truck size={25} /></button>
          </div>
          <button type="button" onClick={() => onGo("requests")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400"><ClipboardList size={19} />Riwayat</button>
          <button type="button" onClick={() => onGo("requests")} className="flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-400"><Bell size={19} />Status</button>
        </div>
      </nav>
    </div>
  );
}

function StockView({ stock, isAdmin, items, warehouses, onCreateItem, busy, onImport, importBusy, focusItemId }: any) {
  const [show, setShow] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "safe" | "low">("all");
  const [form, setForm] = useState({ sku: "", name: "", unit: "box", category: "", sourceWarehouseId: "", minStock: "0" });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!focusItemId) return;
    const targetId = Number(focusItemId);
    if (!Number.isFinite(targetId)) return;
    setExpanded(targetId);
    const element = document.getElementById(`stock-item-${targetId}`);
    window.requestAnimationFrame(() => element?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focusItemId]);

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
      setPreview({
        rows: [],
        errors: [{ rowNumber: 1, field: "file", message: error instanceof Error ? error.message : "File Excel tidak dapat dibaca." }],
        duplicateSkus: [],
      });
    }
  }

  function downloadTemplate() {
    const blob = new Blob([importTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "template-master-barang.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const rows = Array.isArray(stock) ? stock : [];
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = rows.filter((row: any) => {
    const low = Number(row.movementQty) <= Number(row.minStock);
    const matchesStatus = statusFilter === "all" || (statusFilter === "low" ? low : !low);
    const matchesSearch = !normalizedSearch || [row.name, row.sku, row.category].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesSearch;
  });

  const lowCount = rows.filter((row: any) => Number(row.movementQty) <= Number(row.minStock)).length;
  const safeCount = Math.max(0, rows.length - lowCount);
  const canImport = Boolean(preview && preview.rows.length && preview.errors.length === 0);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[#9CCED8]/60 pb-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <p className="golog-kicker">Inventory workspace</p>
              <CardTitle className="mt-1">{isAdmin ? "Stok Gudang Pusat" : "Stok Ruangan"}</CardTitle>
              <p className="mt-2 text-sm leading-6 text-[#315563]">
                {isAdmin
                  ? "Pantau saldo BMHP Gudang Pusat dan prioritaskan barang yang sudah menyentuh batas minimum."
                  : "Pantau saldo BMHP yang tersedia di ruangan Anda sebelum membuat permintaan baru."}
              </p>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setShowImport(!showImport)}>
                  <Upload size={16} className="mr-2" />
                  {showImport ? "Tutup impor" : "Impor Excel"}
                </Button>
                <Button onClick={() => setShow(!show)}>
                  <PackagePlus size={16} className="mr-2" />
                  {show ? "Tutup form" : "Tambah barang"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {showImport && isAdmin && (
            <div className="mb-6 rounded-2xl border-2 border-[#9CCED8] bg-[#F4FAFC]/45 p-5 shadow-[inset_0_0_0_2px_rgba(255,250,240,0.55)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-[#07304A]">Impor master barang</p>
                  <p className="mt-1 text-xs leading-5 text-[#315563]">Upload .xlsx, .xls, atau .csv. Data diperiksa dahulu dan tidak akan disimpan jika masih ada error.</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>Unduh template CSV</Button>
              </div>

              <div className="mt-4 rounded-xl border border-[#9CCED8] bg-[#FFFFFF] p-3">
                <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])} />
                {fileName && <p className="mt-2 text-xs text-[#315563]">File dipilih: <strong>{fileName}</strong></p>}
              </div>

              {preview && (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="golog-panel-soft rounded-xl p-3"><p className="text-xs text-[#55727C]">Baris terbaca</p><p className="mt-1 text-lg font-semibold">{preview.rows.length}</p></div>
                    <div className="golog-panel-soft rounded-xl p-3"><p className="text-xs text-[#55727C]">Error</p><p className="mt-1 text-lg font-semibold">{preview.errors.length}</p></div>
                    <div className="golog-panel-soft rounded-xl p-3"><p className="text-xs text-[#55727C]">SKU duplikat</p><p className="mt-1 text-lg font-semibold">{preview.duplicateSkus.length}</p></div>
                  </div>

                  {preview.errors.length > 0 && (
                    <div className="rounded-xl border border-[#FFD1C2] bg-[#f8e3de] p-3 text-sm text-[#D94A1A]">
                      {preview.errors.slice(0, 8).map((error, i) => <p key={i}>Baris {error.rowNumber} · {error.field}: {error.message}</p>)}
                      {preview.errors.length > 8 && <p className="mt-1">+ {preview.errors.length - 8} error lainnya.</p>}
                    </div>
                  )}

                  {canImport && (
                    <div className="flex flex-col gap-3 rounded-xl border border-[#FFD500] bg-[#E6F4F7] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-[#004E9B]">Semua {preview.rows.length} baris lolos validasi dan siap diimpor.</p>
                      <Button disabled={importBusy} onClick={() => onImport(preview.rows)}>{importBusy ? "Mengimpor…" : "Impor ke master barang"}</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {show && (
            <div className="mb-6 rounded-2xl border-2 border-[#9CCED8] bg-[#F4FAFC]/45 p-5 shadow-[inset_0_0_0_2px_rgba(255,250,240,0.55)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#07304A]">Tambah master barang</p>
                  <p className="mt-1 text-xs text-[#315563]">Tetapkan SKU dan minimum stok agar monitoring segera aktif.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="SKU"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="FAR-001" /></Field>
                <Field label="Nama barang"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sarung tangan" /></Field>
                <Field label="Satuan"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="box" /></Field>
                <Field label="Kategori"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Alat kesehatan" /></Field>
                <Field label="Minimum stok"><Input type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></Field>
                <div className="flex items-end">
                  <Button className="w-full" disabled={busy || !form.sku || !form.name} onClick={() => onCreateItem({ ...form, minStock: Number(form.minStock), sourceWarehouseId: form.sourceWarehouseId ? Number(form.sourceWarehouseId) : null })}>
                    <PackagePlus size={16} className="mr-2" />
                    Simpan master barang
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="golog-panel-soft rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55727C]">SKU aktif</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(rows.length)}</p>
              <p className="mt-1 text-xs text-[#315563]">barang yang sedang terpantau</p>
            </div>
            <button type="button" onClick={() => setStatusFilter(statusFilter === "safe" ? "all" : "safe")} className="golog-panel-soft rounded-2xl p-4 text-left transition hover:-translate-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55727C]">Aman</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(safeCount)}</p>
              <p className="mt-1 text-xs text-[#004E9B]">di atas minimum</p>
            </button>
            <button type="button" onClick={() => setStatusFilter(statusFilter === "low" ? "all" : "low")} className="rounded-2xl border-2 border-[#FFB45C] bg-[#FFF6D6] p-4 text-left shadow-[inset_0_0_0_2px_rgba(255,250,240,0.55)] transition hover:-translate-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF6500]">Perlu cek</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-[#6d4c2f]">{formatNumber(lowCount)}</p>
              <p className="mt-1 text-xs text-[#FF6500]">stok ≤ minimum</p>
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#55727C]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama barang, SKU, atau kategori…"
                className="h-11 pl-10"
                aria-label="Cari stok"
              />
            </div>
            <div className="flex w-full overflow-x-auto rounded-xl border-2 border-[#9CCED8] bg-[#BAE4F0]/55 p-1 md:w-auto">
              {([["all", "Semua"], ["safe", "Aman"], ["low", "Perlu cek"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${statusFilter === value ? "bg-[#07304A] text-[#FFFFFF] shadow-sm" : "text-[#315563] hover:bg-[#FFFFFF]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {filtered.map((row: any) => {
              const low = Number(row.movementQty) <= Number(row.minStock);
              const open = expanded === Number(row.itemId);
              const stockQty = Number(row.movementQty);
              const minQty = Number(row.minStock);
              const coverage = minQty > 0 ? Math.min(100, Math.max(0, (stockQty / minQty) * 100)) : stockQty > 0 ? 100 : 0;

              return (
                <div id={`stock-item-${row.itemId}`} key={row.itemId} className={`overflow-hidden rounded-2xl border-2 bg-[#FFFFFF] shadow-[inset_0_0_0_2px_rgba(255,250,240,0.45)] ${Number(focusItemId) === Number(row.itemId) ? "border-[#0091B9] ring-2 ring-[#FFD500] ring-offset-2" : "border-[#9CCED8]"}`}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : Number(row.itemId))}
                    className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-[#F4FAFC]/55 sm:p-5"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#BAE4F0] text-[#6b573f]">
                      <Boxes size={20} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-[#07304A]">{row.name}</p>
                        <Badge className={low ? "border-[#FFB45C] bg-[#FFF6D6] text-[#FF6500]" : "border-[#FFD500] bg-[#E6F4F7] text-[#004E9B]"}>
                          {low ? "Perlu cek" : "Aman"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#55727C]">{row.sku} · {row.category || "Umum"} · {row.unit}</p>
                      <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[#dfd1a7]">
                        <div className={`h-full rounded-full ${low ? "bg-[#FF6500]" : "bg-[#0091B9]"}`} style={{ width: `${coverage}%` }} />
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className={`text-xl font-semibold tracking-tight ${low ? "text-[#FF6500]" : "text-[#07304A]"}`}>{formatNumber(stockQty)}</p>
                      <p className="text-[11px] text-[#55727C]">{row.unit}</p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b8974]">min {formatNumber(minQty)}</p>
                    </div>

                    <ChevronRight size={18} className={`shrink-0 text-[#55727C] transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>

                  {open && (
                    <div className="border-t-2 border-[#9CCED8]/55 bg-[#F4FAFC]/45 px-4 pb-4 pt-3 sm:px-5">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="golog-panel-soft rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55727C]">SKU</p>
                          <p className="mt-1 text-sm font-semibold text-[#07304A]">{row.sku}</p>
                        </div>
                        <div className="golog-panel-soft rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55727C]">Minimum</p>
                          <p className="mt-1 text-sm font-semibold text-[#07304A]">{formatNumber(minQty)} {row.unit}</p>
                        </div>
                        <div className="golog-panel-soft rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55727C]">Status</p>
                          <p className="mt-1 text-sm font-semibold text-[#07304A]">{low ? "Sudah menyentuh batas minimum." : "Masih di atas batas minimum."}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 text-xs text-[#315563] sm:flex-row sm:items-center sm:justify-between">
                        <span>{isAdmin ? "Lokasi: Gudang Pusat" : "Lokasi: Ruangan aktif"}</span>
                        <span>Saldo diperbarui dari pergerakan stok.</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!filtered.length && (
              <Card className="border-2 border-[#9CCED8] shadow-sm">
                <CardContent>
                  <EmptyState title={rows.length ? "Barang tidak ditemukan" : "Master barang masih kosong"} text={rows.length ? "Coba ubah kata pencarian atau filter status." : isAdmin ? "Tambahkan master barang terlebih dahulu." : "Belum ada data stok."} />
                </CardContent>
              </Card>
            )}
          </div>

          {rows.length > 0 && (
            <p className="mt-4 rounded-xl border border-[#9CCED8]/70 bg-[#F4FAFC]/40 px-3 py-2 text-xs leading-5 text-[#315563]">
              Saldo stok adalah informasi pemantauan. Perubahan stok tetap dilakukan melalui <strong>Barang Masuk</strong>, <strong>Permintaan</strong>, atau <strong>Stock Opname</strong> sesuai wewenang.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function InboundView({ items, warehouses, onSubmit, busy }: any) { const [form, setForm] = useState({ itemId: "", quantity: "", sourceWarehouseId: "", notes: "", occurredAt: new Date().toISOString().slice(0, 10) }); return <Card className="max-w-3xl border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Catat barang masuk</CardTitle><p className="mt-1 text-sm text-slate-500">Penerimaan dari Gudang Farmasi, Gudang RT, CSSD, atau Laboratorium.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2"><Field label="Barang"><select className="h-10 w-full rounded-lg border-2 border-[#9CCED8] bg-[#FFFFFF] px-3 text-sm text-[#07304A] shadow-[inset_0_0_0_2px_rgba(255,250,240,0.52)]" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></Field><Field label="Sumber gudang"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.sourceWarehouseId} onChange={(e) => setForm({ ...form, sourceWarehouseId: e.target.value })}><option value="">Pilih gudang sumber</option>{warehouses.filter((w: any) => w.kind === "source").map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="Jumlah"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" /></Field><Field label="Tanggal kejadian"><Input type="date" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></Field><div className="md:col-span-2"><Field label="Catatan"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Nomor dokumen, nota, atau keterangan penerimaan" /></Field></div></div><Button className="mt-6" disabled={busy || !form.itemId || !form.quantity || !form.sourceWarehouseId} onClick={() => onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), sourceWarehouseId: Number(form.sourceWarehouseId), occurredAt: new Date(form.occurredAt) })}><ArrowDownToLine size={16} className="mr-2" />Simpan barang masuk</Button></CardContent></Card> }

function RequestsView({ requests, rooms, items, warehouses, isAdmin, currentUserId, todayRoomLocks, selectedRoom, selectedRoomName, setSelectedRoom, accessibleRooms, roomAccessLoading, roomAccessError, onRetryRoomAccess, lines, setLines, total, onCreate, onVerify, busy, focusRequestId }: any) {
  const [priority, setPriority] = useState("normal");
  const [requestDate, setRequestDate] = useState(getJakartaDateKeyClient());
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("all");
  const [approvalQty, setApprovalQty] = useState<Record<string, number>>({});
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (!focusRequestId) return;
    const targetId = Number(focusRequestId);
    if (!Number.isFinite(targetId)) return;
    const element = document.getElementById(`request-${targetId}`);
    window.requestAnimationFrame(() => element?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focusRequestId]);

  const roomRequests = selectedRoom
    ? requests.filter((row: any) => Number(row.request.roomId) === Number(selectedRoom))
    : [];

  const filtered = filter === "all"
    ? roomRequests
    : filter === "pending"
      ? roomRequests.filter((row: any) => row.request.status === "submitted")
      : roomRequests.filter((row: any) => row.request.status === filter);

  const priorityRank: Record<string, number> = { darurat: 0, mendesak: 1, normal: 2 };
  const sortedRequests = [...filtered].sort((a: any, b: any) => {
    if (!isAdmin) return new Date(b.request.createdAt).getTime() - new Date(a.request.createdAt).getTime();
    const aPending = a.request.status === "submitted" ? 0 : 1;
    const bPending = b.request.status === "submitted" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (aPending === 0) {
      const priorityDiff = (priorityRank[a.request.priority] ?? 9) - (priorityRank[b.request.priority] ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
    }
    return new Date(b.request.createdAt).getTime() - new Date(a.request.createdAt).getTime();
  });

  const requestCounts = {
    all: roomRequests.length,
    pending: roomRequests.filter((row: any) => row.request.status === "submitted").length,
    partial: roomRequests.filter((row: any) => row.request.status === "partial").length,
    approved: roomRequests.filter((row: any) => row.request.status === "approved").length,
    rejected: roomRequests.filter((row: any) => row.request.status === "rejected").length,
  };

  const requestLocks = trpc.requests.locks.useQuery({ requestDate }, { enabled: Boolean(requestDate) });
  const roomLockById = useMemo(
    () => new Map<number, any>((requestLocks.data ?? []).map((lock: any) => [Number(lock.roomId), lock])),
    [requestLocks.data],
  );
  const getRoomLock = (roomId: number | null) => roomId === null ? null : roomLockById.get(Number(roomId)) ?? null;
  const selectedLock = getRoomLock(selectedRoom);
  const selectedIsMine = Boolean(selectedLock && (selectedLock.isMine || Number(selectedLock.requesterId) === Number(currentUserId)));
  const selectedLockedByOther = Boolean(selectedLock && !selectedIsMine);

  function getApprovalQty(requestId: number, line: any) {
    const key = `${requestId}:${line.line.id}`;
    return approvalQty[key] ?? Number(line.line.requestedQty);
  }

  function setQty(requestId: number, lineId: number, value: string) {
    const key = `${requestId}:${lineId}`;
    const parsed = value === "" ? 0 : Number(value);
    setApprovalQty((current) => ({ ...current, [key]: Number.isFinite(parsed) ? parsed : 0 }));
  }

  function approvalSummary(row: any) {
    const requested = row.lines.reduce((sum: number, line: any) => sum + Number(line.line.requestedQty || 0), 0);
    const approved = row.lines.reduce((sum: number, line: any) => sum + Math.max(0, Math.trunc(getApprovalQty(row.request.id, line))), 0);
    const exceedsStock = row.lines.some((line: any) => {
      const warehouseItem = items.find((candidate: any) => Number(candidate.id) === Number(line.line.itemId));
      const warehouseQty = Number(warehouseItem?.warehouseStockQty ?? 0);
      return getApprovalQty(row.request.id, line) > warehouseQty;
    });
    return { requested, approved, exceedsStock };
  }

  function submitApproval(row: any) {
    const approvalLines = row.lines.map((line: any) => ({
      lineId: Number(line.line.id),
      requestedQty: Number(line.line.requestedQty),
      approvedQty: Math.max(0, Math.trunc(getApprovalQty(row.request.id, line))),
    }));

    const invalid = approvalLines.some((line: any) =>
      !Number.isInteger(line.approvedQty) ||
      line.approvedQty < 0 ||
      line.approvedQty > line.requestedQty
    );
    if (invalid) {
      toast.error("Jumlah distribusi tidak valid. Periksa kembali tiap item.");
      return;
    }

    const totalApproved = approvalLines.reduce((sum: number, line: any) => sum + line.approvedQty, 0);
    if (totalApproved <= 0) {
      toast.error("Minimal satu item harus dipindahkan.");
      return;
    }

    const full = approvalLines.every((line: any) => line.approvedQty === line.requestedQty);
    onVerify({
      requestId: row.request.id,
      status: full ? "approved" : "partial",
      lines: approvalLines.map(({ lineId, approvedQty }: any) => ({ lineId, approvedQty })),
    });
  }

  function fillFullApproval(row: any) {
    const next = { ...approvalQty };
    for (const line of row.lines) {
      next[`${row.request.id}:${line.line.id}`] = Number(line.line.requestedQty);
    }
    setApprovalQty(next);
  }

  function priorityMeta(priorityValue: string) {
    if (priorityValue === "darurat") return { label: "DARURAT", className: "border-rose-200 bg-rose-50 text-rose-700" };
    if (priorityValue === "mendesak") return { label: "MENDESAK", className: "border-amber-200 bg-amber-50 text-amber-700" };
    return { label: "NORMAL", className: "border-slate-200 bg-slate-50 text-slate-600" };
  }

  function stockAfterTone(afterQty: number, minimumQty: number) {
    if (afterQty < 0) return "text-rose-700";
    if (afterQty <= minimumQty) return "text-amber-700";
    return "text-emerald-700";
  }

  function stockAfterLabel(afterQty: number, minimumQty: number) {
    if (afterQty < 0) return "Tidak cukup";
    if (afterQty <= minimumQty) return "Menyentuh minimum";
    return "Masih aman";
  }

  if (isAdmin) {
    return <div className="space-y-5">
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <CardTitle>Antrean permintaan</CardTitle>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Prioritas permintaan ditampilkan lebih dulu. Kepala gudang menentukan jumlah yang benar-benar dipindahkan berdasarkan stok yang tersedia.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <button type="button" onClick={() => setFilter("all")} className={`rounded-xl border px-4 py-3 text-left transition ${filter === "all" ? "border-[#07304A] bg-[#07304A] text-white" : "border-[#9CCED8] bg-[#FFFFFF] hover:bg-slate-50"}`}><p className="text-[11px] opacity-70">Semua</p><p className="mt-1 text-xl font-semibold">{formatNumber(requestCounts.all)}</p></button>
              <button type="button" onClick={() => setFilter("pending")} className={`rounded-xl border px-4 py-3 text-left transition ${filter === "pending" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-[#9CCED8] bg-[#FFFFFF] hover:bg-slate-50"}`}><p className="text-[11px] opacity-70">Menunggu</p><p className="mt-1 text-xl font-semibold">{formatNumber(requestCounts.pending)}</p></button>
              <button type="button" onClick={() => setFilter("partial")} className={`rounded-xl border px-4 py-3 text-left transition ${filter === "partial" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-[#9CCED8] bg-[#FFFFFF] hover:bg-slate-50"}`}><p className="text-[11px] opacity-70">Sebagian</p><p className="mt-1 text-xl font-semibold">{formatNumber(requestCounts.partial)}</p></button>
              <button type="button" onClick={() => setFilter("approved")} className={`rounded-xl border px-4 py-3 text-left transition ${filter === "approved" ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-[#9CCED8] bg-[#FFFFFF] hover:bg-slate-50"}`}><p className="text-[11px] opacity-70">Disetujui</p><p className="mt-1 text-xl font-semibold">{formatNumber(requestCounts.approved)}</p></button>
              <button type="button" onClick={() => setFilter("rejected")} className={`rounded-xl border px-4 py-3 text-left transition ${filter === "rejected" ? "border-rose-500 bg-rose-50 text-rose-900" : "border-[#9CCED8] bg-[#FFFFFF] hover:bg-slate-50"}`}><p className="text-[11px] opacity-70">Ditolak</p><p className="mt-1 text-xl font-semibold">{formatNumber(requestCounts.rejected)}</p></button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {sortedRequests.map((row: any) => {
          const isSubmitted = row.request.status === "submitted";
          const meta = priorityMeta(row.request.priority);
          const approval = approvalSummary(row);

          return <Card id={`request-${row.request.id}`} key={row.request.id} className={`overflow-hidden border-slate-200/80 shadow-sm transition ${Number(focusRequestId) === Number(row.request.id) ? "ring-2 ring-[#0091B9] ring-offset-2" : isSubmitted ? "ring-1 ring-slate-100" : ""}`}>
            <CardContent className="p-0">
              <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={meta.className}>{meta.label}</Badge>
                    <span className="font-semibold text-slate-800">{row.request.requestNo}</span>
                    <Badge className={statusTone(row.request.status)}>{statusLabel(row.request.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{row.room?.name || "Ruangan"} · Kebutuhan {row.request.requestDate} · Diajukan {formatDate(row.request.createdAt)}</p>
                  {row.request.notes && <p className="mt-2 text-xs leading-5 text-slate-500">{row.request.notes}</p>}
                  {isSubmitted && (
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[#315563]">
                      <span className="rounded-lg border border-[#9CCED8] bg-[#FFFFFF] px-2.5 py-1">
                        Dipindahkan {formatNumber(approval.approved)} / {formatNumber(approval.requested)}
                      </span>
                      {approval.exceedsStock && <span className="rounded-lg border border-[#FFD1C2] bg-[#f7ded7] px-2.5 py-1 text-[#D94A1A]">Melebihi stok gudang</span>}
                    </div>
                  )}
                </div>

                {isSubmitted && <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => fillFullApproval(row)}>Isi penuh</Button>
                  <Button size="sm" onClick={() => submitApproval(row)} disabled={busy || approval.exceedsStock || approval.approved <= 0}><Truck size={15} className="mr-2" />Terapkan distribusi</Button>
                  <Button size="sm" variant="outline" onClick={() => onVerify({ requestId: row.request.id, status: "rejected" })} disabled={busy}>Tolak</Button>
                </div>}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Barang</th>
                      <th className="px-4 py-3 text-right">Diminta</th>
                      <th className="px-4 py-3 text-right">Stok gudang</th>
                      <th className="px-4 py-3 text-right">Dipindahkan</th>
                      <th className="px-5 py-3 text-right">Sisa gudang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {row.lines.map((line: any) => {
                      const item = line.item;
                      const warehouseItem = items.find((candidate: any) => Number(candidate.id) === Number(line.line.itemId));
                      const warehouseQty = Number(warehouseItem?.warehouseStockQty ?? 0);
                      const minimumQty = Number(warehouseItem?.minStock ?? 0);
                      const currentQty = getApprovalQty(row.request.id, line);
                      const afterQty = warehouseQty - currentQty;
                      const exceedsWarehouse = currentQty > warehouseQty;
                      return <tr key={line.line.id} className={isSubmitted ? "bg-white" : "bg-slate-50/30"}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-slate-800">{item?.name || "Item"}</p>
                          <p className="mt-1 text-xs text-slate-400">{item?.sku || ""} · {item?.unit || "unit"}</p>
                        </td>
                        <td className="px-4 py-4 text-right font-medium">{formatNumber(line.line.requestedQty)}</td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-semibold text-slate-700">{formatNumber(warehouseQty)}</p>
                          {isSubmitted && <p className="mt-1 text-[11px] text-slate-400">min {formatNumber(minimumQty)}</p>}
                        </td>
                        <td className="px-4 py-4">
                          {isSubmitted ? <Input type="number" min="0" max={line.line.requestedQty} step="1" value={currentQty} onChange={(e) => setQty(row.request.id, line.line.id, e.target.value)} className={exceedsWarehouse ? "border-amber-400 bg-amber-50" : ""} /> : <p className="text-right font-semibold">{formatNumber(line.line.approvedQty)}</p>}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {isSubmitted ? <><p className={`font-semibold ${stockAfterTone(afterQty, minimumQty)}`}>{afterQty < 0 ? "−" : formatNumber(afterQty)}</p><p className={`mt-1 text-[11px] ${stockAfterTone(afterQty, minimumQty)}`}>{stockAfterLabel(afterQty, minimumQty)}</p></> : <p className="text-slate-400">—</p>}
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {row.lines.map((line: any) => {
                  const item = line.item;
                  const warehouseItem = items.find((candidate: any) => Number(candidate.id) === Number(line.line.itemId));
                  const warehouseQty = Number(warehouseItem?.warehouseStockQty ?? 0);
                  const minimumQty = Number(warehouseItem?.minStock ?? 0);
                  const currentQty = getApprovalQty(row.request.id, line);
                  const afterQty = warehouseQty - currentQty;
                  const exceedsWarehouse = currentQty > warehouseQty;

                  return <div key={line.line.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-medium text-slate-800">{item?.name || "Item"}</p><p className="mt-1 text-xs text-slate-400">{item?.sku || ""} · {item?.unit || "unit"}</p></div>
                      <span className="shrink-0 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{formatNumber(line.line.requestedQty)} diminta</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Stok</p><p className="mt-1 font-semibold">{formatNumber(warehouseQty)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Min</p><p className="mt-1 font-semibold">{formatNumber(minimumQty)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Sisa</p><p className={`mt-1 font-semibold ${stockAfterTone(afterQty, minimumQty)}`}>{afterQty < 0 ? "−" : formatNumber(afterQty)}</p></div>
                    </div>
                    {isSubmitted && <div className="rounded-xl border border-[#9CCED8] bg-[#FFFFFF] p-3">
                      <Label className="text-[11px] text-slate-500">Jumlah dipindahkan</Label>
                      <Input type="number" min="0" max={line.line.requestedQty} step="1" value={currentQty} onChange={(e) => setQty(row.request.id, line.line.id, e.target.value)} className={exceedsWarehouse ? "mt-2 border-amber-400 bg-amber-50" : "mt-2"} />
                    </div>}
                    {isSubmitted && <div className={`text-xs ${stockAfterTone(afterQty, minimumQty)}`}>{exceedsWarehouse ? "Jumlah melebihi stok gudang saat ini; verifikasi akhir tetap dilakukan oleh server." : stockAfterLabel(afterQty, minimumQty)}</div>}
                    {!isSubmitted && <p className="text-right text-sm font-semibold text-slate-700">{formatNumber(line.line.approvedQty)} dipindahkan</p>}
                  </div>;
                })}
              </div>
            </CardContent>
          </Card>;
        })}
        {!sortedRequests.length && <Card className="border-slate-200/80 shadow-sm"><CardContent><EmptyState title="Tidak ada permintaan pada filter ini" text="Permintaan baru dari ruangan akan muncul di antrean ini." /></CardContent></Card>}
      </div>
    </div>;
  }

  return <>
    <div className="grid gap-6 xl:grid-cols-[.85fr_1.5fr]">
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader><CardTitle>Buat permintaan</CardTitle><p className="mt-1 text-sm text-slate-500">Ajukan kebutuhan untuk hari ini sampai maksimal 7 hari ke depan. Kepala gudang memproses pemenuhan sesuai hari operasional dan ketersediaan stok.</p></CardHeader>
      <CardContent>
        <Field label="Tanggal kebutuhan"><Input type="date" value={requestDate} min={getJakartaDateKeyClient()} max={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 7 * 86400000))} onChange={(e) => setRequestDate(e.target.value)} /></Field>
        <div className="mt-5"><Field label="Ruangan aktif">
          <select
            aria-label="Pilih ruangan aktif"
            value={selectedRoom ?? ""}
            onChange={(event) => {
              const nextRoomId = Number(event.target.value);
              if (accessibleRooms.some((room: any) => Number(room.id) === nextRoomId)) {
                setSelectedRoom(nextRoomId);
              }
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold text-[#07304A]"
            disabled={!accessibleRooms.length}
          >
            {roomAccessLoading && !accessibleRooms.length ? (
              <option value="">Memuat daftar ruangan…</option>
            ) : accessibleRooms.length ? (
              accessibleRooms.map((room: any) => {
                const lock = roomLockById.get(Number(room.id));
                const isMine = Boolean(lock && (lock.isMine || Number(lock.requesterId) === Number(currentUserId)));
                const label = lock
                  ? isMine
                    ? `${room.name} — PIC Anda`
                    : `${room.name} — PIC ${lock.requesterName || "petugas lain"}`
                  : `${room.name} — belum ada PIC`;
                return <option key={room.id} value={room.id}>{label}</option>;
              })
            ) : (
              <option value="">Tidak ada ruangan yang ditetapkan</option>
            )}
          </select>
          {roomAccessLoading && !accessibleRooms.length && <p className="mt-2 text-xs text-slate-500">Sedang mengambil daftar ruangan yang ditetapkan untuk akun ini…</p>}
          {roomAccessError && accessibleRooms.length > 0 && <p className="mt-2 text-xs text-slate-400">Akses ruangan terakhir berhasil dimuat. Permintaan ulang data akan dicoba lagi otomatis.</p>}
          {!roomAccessLoading && roomAccessError && !accessibleRooms.length && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
              <span>Gagal memuat akses ruangan: {String(roomAccessError)}</span>
              <button type="button" onClick={onRetryRoomAccess} className="shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 font-semibold text-rose-700 hover:bg-rose-100">Coba lagi</button>
            </div>
          )}
          {!roomAccessLoading && !roomAccessError && !accessibleRooms.length && <p className="mt-2 text-xs text-amber-700">Akun ini belum memiliki akses ke ruangan aktif. Minta admin menetapkan ruangan terlebih dahulu.</p>}
        </Field>
        </div>
        <div className={`mt-4 rounded-xl p-3 text-sm ${selectedLockedByOther ? "border-[#FFD1C2] bg-[#f8e3de] text-[#D94A1A]" : selectedLock ? "bg-emerald-50 text-emerald-800" : "border-[#FFD500] bg-[#E6F4F7] text-[#004E9B]"}`}>
          {selectedLock
            ? selectedIsMine
              ? <>Anda adalah PIC request <strong>{selectedRoomName}</strong> pada tanggal kebutuhan ini. Anda dapat membuat request susulan.</>
              : <>Ruangan <strong>{selectedRoomName}</strong> sudah memiliki PIC request pada tanggal kebutuhan ini: <strong>{selectedLock.requesterName || "petugas lain"}</strong>.</>
            : <>Permintaan akan menjadi request pertama untuk <strong>{selectedRoomName || "ruangan yang dipilih"}</strong> pada <strong>{requestDate}</strong>.</>}
        </div>
        <div className="mt-5"><Field label="Prioritas"><select className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="normal">Normal</option><option value="mendesak">Mendesak</option><option value="darurat">Darurat</option></select></Field></div>
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
        <button
          type="button"
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md border-2 border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!selectedRoom) {
              toast.error("Pilih ruangan aktif terlebih dahulu.");
              return;
            }
            if (selectedLockedByOther) {
              toast.error(`Ruangan ${selectedRoomName || "ini"} sudah memiliki PIC lain untuk tanggal kebutuhan tersebut.`);
              return;
            }
            const invalidLine = lines.find((x: Line) => !x.itemId || Number(x.requestedQty) < 1);
            if (invalidLine) {
              toast.error("Lengkapi nama barang dan jumlah setiap item sebelum masuk Review.");
              return;
            }
            setReviewOpen(true);
          }}
        >
          <ClipboardCheck size={16} className="mr-2" />Review & cek {total} unit
        </button>
      </CardContent>
    </Card>

    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <CardTitle>Daftar permintaan{selectedRoomName ? ` · ${selectedRoomName}` : ""}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          {selectedRoomName ? `Riwayat permintaan untuk ${selectedRoomName}.` : "Pilih ruangan untuk melihat daftar permintaannya."}
        </p>
      </div>
      <select className="h-9 rounded-lg border-2 border-[#9CCED8] bg-[#FFFFFF] px-2 text-xs text-[#07304A]" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">Semua status</option>
        <option value="submitted">Diajukan</option>
        <option value="approved">Disetujui</option>
        <option value="partial">Sebagian</option>
        <option value="rejected">Ditolak</option>
      </select>
    </CardHeader>
    <CardContent>
      {!selectedRoom ? (
        <EmptyState title="Pilih ruangan terlebih dahulu" text="Daftar permintaan akan mengikuti ruangan yang sedang dipilih." />
      ) : (
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1 sm:max-h-[520px]">
          {sortedRequests.map((row: any) => <div key={row.request.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><span className="font-semibold">{row.request.requestNo}</span><Badge className={statusTone(row.request.status)}>{statusLabel(row.request.status)}</Badge></div>
                <p className="mt-1 text-sm text-slate-500">{row.room?.name || "Ruangan"} · {formatDate(row.request.createdAt)} · <span className="capitalize">{row.request.priority}</span></p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm">{row.lines.map((line: any) => <div key={line.line.id} className="flex justify-between gap-4"><span>{line.item?.name || "Item"}</span><span className="font-medium">{line.line.requestedQty} diminta · {line.line.approvedQty} dipindahkan</span></div>)}</div>
          </div>)}
          {!sortedRequests.length && <EmptyState title="Belum ada permintaan" text={`Belum ada permintaan untuk ${selectedRoomName || "ruangan ini"} dengan filter tersebut.`} />}
        </div>
      )}
    </CardContent>
    </Card>
    </div>

    {reviewOpen && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#07304A]/45 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="request-review-title">
    <div className="flex h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-3xl">
      <div className="shrink-0 border-b border-slate-100 px-5 pb-3 pt-4 sm:px-7 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-700">Final check</p>
            <h2 id="request-review-title" className="mt-1 text-xl font-semibold leading-tight text-[#07304A] sm:text-2xl">Review permintaan sebelum dikirim</h2>
            <p className="mt-1 hidden text-sm text-slate-500 sm:block">Pastikan ruangan, tanggal kebutuhan, nama barang, dan jumlah sudah benar.</p>
          </div>
          <button type="button" aria-label="Tutup review" onClick={() => setReviewOpen(false)} className="shrink-0 rounded-xl p-2 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
        </div>
        <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Ruangan</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-700">{selectedRoomName || "—"}</p></div>
            <div className="shrink-0 text-right"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Kebutuhan</p><p className="mt-0.5 text-sm font-semibold text-slate-700">{requestDate}</p></div>
          </div>
          <div className="mt-2 flex gap-2 text-xs font-semibold text-slate-500"><span>{formatNumber(lines.length)} item</span><span>·</span><span>{formatNumber(total)} unit</span></div>
        </div>
        <div className="mt-4 hidden gap-2 sm:grid sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Ruangan</p><p className="mt-1 truncate font-semibold text-slate-700">{selectedRoomName || "—"}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Tanggal kebutuhan</p><p className="mt-1 font-semibold text-slate-700">{requestDate}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Total item</p><p className="mt-1 font-semibold text-slate-700">{formatNumber(lines.length)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Total unit</p><p className="mt-1 font-semibold text-slate-700">{formatNumber(total)}</p></div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-7 sm:py-5">
        <div className="mb-3 flex items-center justify-between sm:hidden"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Daftar barang</p><p className="text-xs font-medium text-slate-400">Geser untuk melihat semua</p></div>
        <div className="space-y-2.5 sm:space-y-3">
          {lines.map((line: Line, index: number) => {
            const item = items.find((candidate: any) => Number(candidate.id) === Number(line.itemId));
            const stock = Number(item?.warehouseStockQty ?? 0);
            const over = Number(line.requestedQty) > stock;
            return <div key={index} className={`rounded-2xl border p-3.5 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-4 ${over ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500 sm:hidden">{index + 1}</span>
                  <div className="min-w-0"><p className="text-sm font-semibold leading-5 text-slate-800 sm:text-base">{item?.name || "Item belum dipilih"}</p><p className="mt-1 text-[11px] leading-4 text-slate-400 sm:text-xs">{item?.sku || "—"} · {item?.unit || "unit"} · stok gudang {formatNumber(stock)}</p></div>
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-2.5 sm:mt-0 sm:block sm:shrink-0 sm:border-0 sm:pt-0 sm:text-right">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:hidden">Jumlah diminta</span>
                <div><p className="text-lg font-bold leading-none text-[#07304A] sm:text-lg">{formatNumber(Number(line.requestedQty) || 0)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">diminta</p>{over && <p className="mt-1 text-[10px] font-semibold text-amber-700">⚠ melebihi stok</p>}</div>
              </div>
            </div>;
          })}
        </div>
        <div className="mt-3 rounded-2xl border border-[#9CCED8] bg-[#E6F4F7] p-3.5 text-xs leading-5 text-[#315563] sm:mt-4 sm:p-4 sm:text-sm"><strong>Final check:</strong> setelah dikonfirmasi, permintaan langsung masuk ke antrean Kepala Gudang.</div>
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_20px_rgba(7,48,74,0.06)] sm:px-7 sm:py-4 sm:shadow-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="order-2 w-full sm:order-1 sm:w-auto" onClick={() => setReviewOpen(false)} disabled={busy}>Kembali edit</Button>
          <Button type="button" className="order-1 w-full sm:order-2 sm:w-auto" disabled={busy || !selectedRoom || selectedLockedByOther || lines.some((x: Line) => !x.itemId || Number(x.requestedQty) < 1)} onClick={async () => {
            try {
              await onCreate({ roomId: selectedRoom, requestDate, priority, notes, lines });
              setReviewOpen(false);
            } catch {
              // onError on the mutation already presents the server message.
              // Keep the Review modal open so the user can correct/retry.
            }
          }}><Truck size={16} className="mr-2" />Konfirmasi & kirim</Button>
        </div>
      </div>
    </div>
    </div>}  </>;
}
function StockOpnameView({ stock, items, onSubmit, busy }: any) {
  type OpnameRow = { itemId: number; sku: string; name: string; unit: string; systemQty: number; physicalQty: string; };
  const initialRows = useMemo<OpnameRow[]>(() => items.map((item: any) => {
    const stockRow = stock.find((row: any) => Number(row.itemId) === Number(item.id));
    return { itemId: Number(item.id), sku: item.sku || "", name: item.name || "", unit: item.unit || "unit", systemQty: Number(stockRow?.movementQty ?? 0), physicalQty: "" };
  }), [items, stock]);
  const [rows, setRows] = useState<OpnameRow[]>(initialRows);
  const [reason, setReason] = useState("");
  const [incidentDate, setIncidentDate] = useState(getJakartaDateKeyClient());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "difference">("all");
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalizedQuery || row.name.toLowerCase().includes(normalizedQuery) || row.sku.toLowerCase().includes(normalizedQuery);
      const physical = row.physicalQty === "" ? null : Number(row.physicalQty);
      const difference = physical === null || !Number.isFinite(physical) ? null : physical - row.systemQty;
      const matchesFilter = filter === "all" || (filter === "pending" && physical === null) || (filter === "difference" && difference !== null && difference !== 0);
      return matchesQuery && matchesFilter;
    });
  }, [rows, query, filter]);
  const checkedRows = rows.filter((row) => row.physicalQty !== "");
  const changedRows = checkedRows.filter((row) => Number(row.physicalQty) !== row.systemQty);
  const increaseRows = changedRows.filter((row) => Number(row.physicalQty) > row.systemQty);
  const decreaseRows = changedRows.filter((row) => Number(row.physicalQty) < row.systemQty);
  const allChecked = rows.length > 0 && checkedRows.length === rows.length;
  const totalDifference = changedRows.reduce((sum, row) => sum + (Number(row.physicalQty) - row.systemQty), 0);
  const positiveDifference = increaseRows.reduce((sum, row) => sum + (Number(row.physicalQty) - row.systemQty), 0);
  const negativeDifference = decreaseRows.reduce((sum, row) => sum + (row.systemQty - Number(row.physicalQty)), 0);
  const progress = rows.length ? Math.round((checkedRows.length / rows.length) * 100) : 0;
  function setPhysicalQty(itemId: number, value: string) {
    if (value !== "" && (!/^\d+$/.test(value) || Number(value) < 0)) return;
    setRows((current) => current.map((row) => row.itemId === itemId ? { ...row, physicalQty: value } : row));
  }
  function markAllAsSystem() { setRows((current) => current.map((row) => ({ ...row, physicalQty: String(row.systemQty) }))); }
  function clearAll() { setRows((current) => current.map((row) => ({ ...row, physicalQty: "" }))); }
  function submit() {
    if (!reason.trim() || reason.trim().length < 10) { toast.error("Catatan opname minimal 10 karakter."); return; }
    const filled = rows.filter((row) => row.physicalQty !== "").map((row) => ({ itemId: row.itemId, physicalQty: Number(row.physicalQty) }));
    if (!filled.length) { toast.error("Isi minimal satu stok fisik sebelum menyimpan."); return; }
    if (filled.some((row) => !Number.isInteger(row.physicalQty) || row.physicalQty < 0)) { toast.error("Stok fisik harus berupa bilangan bulat 0 atau lebih."); return; }
    onSubmit({ lines: filled, reason: reason.trim(), incidentDate: new Date(incidentDate) });
  }
  function rowMeta(row: OpnameRow) {
    const physical = row.physicalQty === "" ? null : Number(row.physicalQty);
    const difference = physical === null ? null : physical - row.systemQty;
    if (physical === null) return { physical, difference, label: "Belum diisi", className: "border-[#B8D5DE] bg-[#FFFFFF] text-[#55727C]" };
    if (difference === 0) return { physical, difference, label: "Sesuai", className: "border-[#FFD500] bg-[#E6F4F7] text-[#004E9B]" };
    if (difference! > 0) return { physical, difference, label: "Tambah", className: "border-[#b8d0de] bg-[#e7f0f4] text-[#4d7182]" };
    return { physical, difference, label: "Kurang", className: "border-[#FFD1C2] bg-[#f8e3de] text-[#D94A1A]" };
  }
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[#9CCED8]/60 pb-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl"><p className="golog-kicker">Warehouse control</p><CardTitle className="mt-1">Stock Opname Gudang Pusat</CardTitle><p className="mt-2 text-sm leading-6 text-[#315563]">Hitung stok fisik, bandingkan dengan saldo sistem, lalu simpan seluruh koreksi sekaligus dalam satu transaksi.</p></div>
            <div className="rounded-2xl border-2 border-[#9CCED8] bg-[#FFFFFF] px-4 py-3 xl:min-w-[250px]">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55727C]">Progres opname</p><span className="text-sm font-bold text-[#07304A]">{progress}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dfd1a7]"><div className="h-full rounded-full bg-[#0091B9] transition-all" style={{ width: progress + "%" }} /></div>
              <p className="mt-2 text-xs text-[#55727C]">{formatNumber(checkedRows.length)} dari {formatNumber(rows.length)} barang diperiksa</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3 md:grid-cols-[1fr_190px]">
            <Field label="Catatan opname *"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: Stock opname akhir bulan, dihitung bersama petugas gudang." className="min-h-[86px]" /></Field>
            <Field label="Tanggal opname"><Input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="golog-panel-soft rounded-2xl p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55727C]">Diperiksa</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(checkedRows.length)}</p><p className="mt-1 text-xs text-[#315563]">dari {formatNumber(rows.length)} SKU</p></div>
            <div className="rounded-2xl border-2 border-[#FFB45C] bg-[#FFF6D6] p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF6500]">Ada selisih</p><p className="mt-2 text-3xl font-semibold tracking-tight text-[#6d4c2f]">{formatNumber(changedRows.length)}</p><p className="mt-1 text-xs text-[#FF6500]">perlu dikonfirmasi</p></div>
            <div className="rounded-2xl border-2 border-[#FFD500] bg-[#E6F4F7] p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#004E9B]">Kelebihan</p><p className="mt-2 text-3xl font-semibold tracking-tight text-[#4e6328]">+{formatNumber(positiveDifference)}</p><p className="mt-1 text-xs text-[#004E9B]">{formatNumber(increaseRows.length)} barang</p></div>
            <div className="rounded-2xl border-2 border-[#FFD1C2] bg-[#f8e3de] p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#D94A1A]">Kekurangan</p><p className="mt-2 text-3xl font-semibold tracking-tight text-[#8f493f]">−{formatNumber(negativeDifference)}</p><p className="mt-1 text-xs text-[#D94A1A]">{formatNumber(decreaseRows.length)} barang</p></div>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#9CCED8] bg-[#F4FAFC]/45 p-3 md:flex-row md:items-center md:justify-between">
            <div className="relative min-w-0 flex-1"><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#55727C]" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari SKU atau nama barang…" className="h-11 bg-[#FFFFFF] pl-10" aria-label="Cari barang stock opname" /></div>
            <div className="flex overflow-x-auto rounded-xl border border-[#9CCED8] bg-[#BAE4F0]/55 p-1">
              {(["all", "pending", "difference"] as const).map((value) => {
                const label = value === "all" ? "Semua · " + rows.length : value === "pending" ? "Belum diisi · " + (rows.length - checkedRows.length) : "Selisih · " + changedRows.length;
                return <button key={value} type="button" onClick={() => setFilter(value)} className={"whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition " + (filter === value ? "bg-[#07304A] text-[#FFFFFF] shadow-sm" : "text-[#315563] hover:bg-[#FFFFFF]")}>{label}</button>;
              })}
            </div>
            <div className="flex shrink-0 gap-2"><Button type="button" variant="outline" onClick={markAllAsSystem} disabled={!rows.length || busy || allChecked}>Isi = sistem</Button><Button type="button" variant="outline" onClick={clearAll} disabled={!checkedRows.length || busy}>Kosongkan</Button></div>
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-[#9CCED8] bg-[#FFFFFF]">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-[#B8D5DE] bg-[#F4FAFC] text-[11px] uppercase tracking-[0.12em] text-[#315563]"><tr><th className="px-4 py-3">Barang</th><th className="px-4 py-3 text-right">Sistem</th><th className="px-4 py-3">Stok fisik</th><th className="px-4 py-3 text-right">Selisih</th><th className="px-4 py-3 text-center">Status</th></tr></thead>
                <tbody className="divide-y divide-[#C7E0E6]/70">
                  {visibleRows.map((row) => {
                    const meta = rowMeta(row);
                    return <tr key={row.itemId} className={meta.difference !== null && meta.difference !== 0 ? "bg-[#FFF6D6]/45" : "hover:bg-[#F4FAFC]/30"}>
                      <td className="px-4 py-4"><p className="font-semibold text-[#07304A]">{row.name}</p><p className="mt-1 text-xs text-[#55727C]">{row.sku} · {row.unit}</p></td>
                      <td className="px-4 py-4 text-right"><p className="font-semibold text-[#07304A]">{formatNumber(row.systemQty)}</p><p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#55727C]">saldo sistem</p></td>
                      <td className="px-4 py-4"><Input type="number" min="0" step="1" value={row.physicalQty} onChange={(e) => setPhysicalQty(row.itemId, e.target.value)} placeholder="Isi hasil hitung" className="h-10 w-40 bg-[#FFFFFF]" /></td>
                      <td className={"px-4 py-4 text-right font-bold " + (meta.difference === null ? "text-[#b1a38f]" : meta.difference > 0 ? "text-[#004E9B]" : meta.difference < 0 ? "text-[#D94A1A]" : "text-[#6d7d3e]")}>{meta.difference === null ? "—" : meta.difference > 0 ? "+" + formatNumber(meta.difference) : formatNumber(meta.difference)}</td>
                      <td className="px-4 py-4 text-center"><Badge className={meta.className}>{meta.label}</Badge></td>
                    </tr>;
                  })}
                  {!visibleRows.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-[#55727C]">Tidak ada barang yang cocok dengan filter.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#C7E0E6]/70 md:hidden">
              {visibleRows.map((row) => {
                const meta = rowMeta(row);
                return <div key={row.itemId} className="p-4">
                  <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#BAE4F0] text-[#6b573f]"><ClipboardType size={20} /></div><div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-[#07304A]">{row.name}</p><p className="mt-1 truncate text-xs text-[#55727C]">{row.sku} · {row.unit}</p></div><Badge className={meta.className}>{meta.label}</Badge></div>
                    <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-[#B8D5DE] bg-[#F4FAFC]/55 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55727C]">Sistem</p><p className="mt-1 text-lg font-semibold text-[#07304A]">{formatNumber(row.systemQty)}</p></div><div className="rounded-xl border border-[#B8D5DE] bg-[#FFFFFF] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55727C]">Selisih</p><p className={"mt-1 text-lg font-semibold " + (meta.difference === null ? "text-[#b1a38f]" : meta.difference > 0 ? "text-[#004E9B]" : meta.difference < 0 ? "text-[#D94A1A]" : "text-[#6d7d3e]")}>{meta.difference === null ? "—" : meta.difference > 0 ? "+" + formatNumber(meta.difference) : formatNumber(meta.difference)}</p></div></div>
                    <div className="mt-3"><Field label="Stok fisik"><Input type="number" min="0" step="1" inputMode="numeric" value={row.physicalQty} onChange={(e) => setPhysicalQty(row.itemId, e.target.value)} placeholder="Isi hasil hitung" className="h-11 bg-[#FFFFFF]" /></Field></div>
                  </div></div>
                </div>;
              })}
              {!visibleRows.length && <div className="px-4 py-12 text-center text-sm text-[#55727C]">Tidak ada barang yang cocok dengan filter.</div>}
            </div>
          </div>
          <div className="sticky bottom-3 z-10 rounded-2xl border-2 border-[#9CCED8] bg-[#FFFFFF]/95 p-4 shadow-[0_14px_35px_rgba(90,71,56,0.15)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div><p className="text-sm font-semibold text-[#07304A]">Siap disimpan: {formatNumber(checkedRows.length)} barang</p><div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="rounded-lg border border-[#B8D5DE] bg-[#F4FAFC] px-2.5 py-1 text-[#315563]">Selisih bersih {totalDifference > 0 ? "+" : ""}{formatNumber(totalDifference)}</span>{changedRows.length > 0 && <span className="rounded-lg border border-[#FFB45C] bg-[#FFF6D6] px-2.5 py-1 text-[#FF6500]">{formatNumber(changedRows.length)} koreksi</span>}{allChecked && <span className="rounded-lg border border-[#FFD500] bg-[#E6F4F7] px-2.5 py-1 text-[#004E9B]">Semua SKU diperiksa</span>}</div><p className="mt-2 text-xs leading-5 text-[#55727C]">Barang tanpa selisih tetap tercatat sebagai hasil pemeriksaan dan tidak membuat movement baru.</p></div>
              <Button className="w-full sm:w-auto" disabled={busy || !checkedRows.length || reason.trim().length < 10} onClick={submit}><ClipboardCheck size={16} className="mr-2" />{busy ? "Menyimpan hasil…" : "Simpan " + formatNumber(checkedRows.length) + " hasil opname"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[#9CCED8]/60"><p className="golog-kicker">Cara kerja</p><CardTitle className="mt-1">Satu sesi, satu koreksi terkontrol</CardTitle></CardHeader>
        <CardContent className="pt-5"><div className="grid gap-3 md:grid-cols-4">
          {[["1", "Hitung fisik", "Masukkan jumlah nyata yang ditemukan di Gudang Pusat."], ["2", "Review", "Sistem menghitung fisik − saldo sistem secara langsung."], ["3", "Simpan", "Semua hasil diproses sekaligus dalam satu transaksi."], ["4", "Selesai", "Stok gudang dan histori koreksi langsung diperbarui."]].map(([number, title, text]) => <div key={number} className="rounded-2xl border-2 border-[#9CCED8] bg-[#FFFFFF] p-4"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#07304A] text-sm font-semibold text-white">{number}</div><p className="mt-3 font-semibold text-[#07304A]">{title}</p><p className="mt-1 text-xs leading-5 text-[#315563]">{text}</p></div>)}
        </div></CardContent>
      </Card>
    </div>
  );
}
function AdjustmentsView({ adjustments, items, rooms, onSubmit, busy }: any) { const [form, setForm] = useState({ itemId: "", roomId: "", adjustmentType: "subtract", quantity: "", physicalQty: "", reasonType: "holiday_pickup", reason: "", incidentDate: new Date().toISOString().slice(0, 10) }); return <div className="grid gap-6 xl:grid-cols-[.9fr_1.4fr]"><Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Penyesuaian stok</CardTitle><p className="mt-1 text-sm text-slate-500">Untuk selisih fisik, pengambilan hari libur, rusak, atau darurat.</p></CardHeader><CardContent><div className="grid gap-4"><Field label="Barang *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}><option value="">Pilih barang</option>{items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Jenis"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.adjustmentType} onChange={(e) => setForm({ ...form, adjustmentType: e.target.value })}><option value="subtract">Pengurangan</option><option value="add">Penambahan</option></select></Field><Field label="Jumlah"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field></div><Field label="Ruangan terkait"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}><option value="">Tidak ada / umum</option>{rooms.map((room: any) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field><Field label="Stok fisik setelah kejadian"><Input type="number" min="0" value={form.physicalQty} onChange={(e) => setForm({ ...form, physicalQty: e.target.value })} /></Field><Field label="Jenis kejadian"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.reasonType} onChange={(e) => setForm({ ...form, reasonType: e.target.value })}><option value="holiday_pickup">Pengambilan hari libur</option><option value="forgotten_entry">Lupa tercatat</option><option value="emergency">Pengeluaran darurat</option><option value="damaged">Barang rusak</option><option value="expired">Kedaluwarsa</option><option value="stocktake">Stock opname</option><option value="other">Lainnya</option></select></Field><Field label="Tanggal kejadian"><Input type="date" value={form.incidentDate} onChange={(e) => setForm({ ...form, incidentDate: e.target.value })} /></Field><Field label="Alasan wajib (minimal 10 karakter)"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Contoh: 10 box diambil ICU Garuda saat hari libur…" /></Field><Button disabled={busy || !form.itemId || !form.quantity || !form.physicalQty || form.reason.length < 10} onClick={() => onSubmit({ ...form, itemId: Number(form.itemId), roomId: form.roomId ? Number(form.roomId) : null, quantity: Number(form.quantity), physicalQty: Number(form.physicalQty), incidentDate: new Date(form.incidentDate) })}><ClipboardCheck size={16} className="mr-2" />Terapkan penyesuaian</Button><p className="text-xs leading-5 text-slate-400">Penyesuaian langsung menerapkan stok dan mencatat self-verification kepala gudang.</p></div></CardContent></Card><Card className="border-slate-200/80 shadow-sm"><CardHeader><CardTitle>Riwayat penyesuaian</CardTitle></CardHeader><CardContent><div className="space-y-3">{adjustments.map((row: any) => <div key={row.adjustment.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{row.adjustment.adjustmentNo}</p><p className="mt-1 text-sm text-slate-500">{row.item?.name} · {row.room?.name || "umum"}</p></div><Badge className="border-violet-200 bg-violet-50 text-violet-700">Self-verified</Badge></div><p className="mt-3 text-sm">{row.adjustment.reason}</p><p className="mt-2 text-xs text-slate-400">{formatDate(row.adjustment.incidentDate)} · {row.adjustment.adjustmentType === "add" ? "+" : "−"}{row.adjustment.quantity} unit</p></div>)}{!adjustments.length && <EmptyState title="Belum ada penyesuaian" text="Setiap koreksi stok akan tercatat di sini." />}</div></CardContent></Card></div> }

function ReportsView({ report, month, onMonthChange }: any) {
  const data = report ?? {};
  const items = data.items ?? [];
  const rooms = data.rooms ?? [];
  const movements = data.movements ?? [];
  const daysInMonth = Number(data.daysInMonth ?? 0);
  const openingWarehouse = new Map<number, number>();
  for (const row of data.openingWarehouse ?? []) {
    openingWarehouse.set(Number((row as any).itemId), Number((row as any).quantity ?? 0));
  }
  const openingRooms = new Map<string, number>();
  for (const row of data.openingRooms ?? []) {
    openingRooms.set(`${Number((row as any).roomId)}:${Number((row as any).itemId)}`, Number((row as any).quantity ?? 0));
  }

  const warehouseStats = new Map<number, { opening: number; inbound: number; distributed: number; adjustment: number }>();
  const roomStats = new Map<string, { roomId: number; itemId: number; distributed: number; used: number; adjustment: number }>();
  const inboundDaily = new Map<string, number>();
  const usageDaily = new Map<string, number>();
  const distributionRows: ExcelCell[][] = [];
  const movementRows: ExcelCell[][] = [];

  for (const item of items) {
    const opening = Number(openingWarehouse.get(Number((item as any).id)) ?? 0);
    warehouseStats.set(Number((item as any).id), { opening, inbound: 0, distributed: 0, adjustment: 0 });
  }

  for (const row of movements) {
    const movement = row.movement;
    const itemId = Number(movement.itemId);
    const roomId = movement.roomId === null ? null : Number(movement.roomId);
    const quantity = Number(movement.quantity);
    const absoluteQty = Math.abs(quantity);
    const day = getReportDay(movement.occurredAt);
    const item = row.item;
    const room = row.room;

    movementRows.push([
      formatDate(movement.occurredAt),
      item?.sku || "",
      item?.name || "",
      item?.unit || "",
      room?.name || row.warehouse?.name || "Gudang Pusat",
      movement.movementType === "in" ? "Masuk" : movement.movementType === "out" ? "Keluar" : "Penyesuaian",
      quantity,
      movement.notes || "",
    ]);

    if (roomId === null) {
      const stats = warehouseStats.get(itemId) ?? { opening: 0, inbound: 0, distributed: 0, adjustment: 0 };
      if (movement.movementType === "in") {
        stats.inbound += absoluteQty;
        inboundDaily.set(`${itemId}:${day}`, (inboundDaily.get(`${itemId}:${day}`) ?? 0) + absoluteQty);
      } else if (movement.movementType === "out") {
        stats.distributed += absoluteQty;
      } else {
        stats.adjustment += quantity;
      }
      warehouseStats.set(itemId, stats);
    } else {
      const key = `${roomId}:${itemId}`;
      const stats = roomStats.get(key) ?? { roomId, itemId, distributed: 0, used: 0, adjustment: 0 };
      if (movement.movementType === "in") {
        stats.distributed += absoluteQty;
        distributionRows.push([formatDate(movement.occurredAt), room?.name || "", item?.sku || "", item?.name || "", item?.unit || "", absoluteQty, movement.notes || ""]);
      } else if (movement.movementType === "out") {
        stats.used += absoluteQty;
        usageDaily.set(`${key}:${day}`, (usageDaily.get(`${key}:${day}`) ?? 0) + absoluteQty);
      } else {
        stats.adjustment += quantity;
      }
      roomStats.set(key, stats);
    }
  }

  const rekapRows: ExcelCell[][] = [];
  for (const item of items) {
    const itemId = Number(item.id);
    const stats = warehouseStats.get(itemId) ?? { opening: 0, inbound: 0, distributed: 0, adjustment: 0 };
    const closing = stats.opening + stats.inbound - stats.distributed + stats.adjustment;
    if (stats.opening || stats.inbound || stats.distributed || stats.adjustment || closing) {
      rekapRows.push([item.sku, item.name, item.category || "", item.unit, stats.opening, stats.inbound, stats.distributed, stats.adjustment, closing]);
    }
  }

  const weekRanges = [[1, 7], [8, 14], [15, 21], [22, daysInMonth]];
  function weekTotal(getValue: (day: number) => number, range: number[]) {
    if (range[0] > range[1]) return 0;
    let total = 0;
    for (let day = range[0]; day <= range[1]; day += 1) total += getValue(day);
    return total;
  }

  const inboundHeaders: ExcelCell[] = ["No", "SKU", "Nama Barang", "Satuan", ...Array.from({ length: daysInMonth }, (_, index) => index + 1), "MG1", "MG2", "MG3", "MG4", "Total"];
  const inboundRows: ExcelCell[][] = items
    .filter((item: any) => {
      const stats = warehouseStats.get(Number(item.id));
      return Boolean(stats?.inbound || stats?.opening || stats?.distributed || stats?.adjustment);
    })
    .map((item: any, index: number) => {
      const getDay = (day: number) => inboundDaily.get(`${Number(item.id)}:${day}`) ?? 0;
      const daily = Array.from({ length: daysInMonth }, (_, dayIndex) => getDay(dayIndex + 1));
      return [index + 1, item.sku, item.name, item.unit, ...daily, ...weekRanges.map((range) => weekTotal(getDay, range)), daily.reduce((sum, qty) => sum + qty, 0)];
    });

  const roomSheetRows = rooms.map((room: any) => {
    const roomItems = items.filter((item: any) => {
      const key = `${Number(room.id)}:${Number(item.id)}`;
      const stats = roomStats.get(key);
      return Boolean(stats?.distributed || stats?.used || stats?.adjustment || (openingRooms.get(key) ?? 0));
    });
    const headers: ExcelCell[] = ["No", "SKU", "Nama Barang", "Satuan", ...Array.from({ length: daysInMonth }, (_, index) => index + 1), "MG1", "MG2", "MG3", "MG4", "Total"];
    const rows = roomItems.map((item: any, index: number) => {
      const key = `${Number(room.id)}:${Number(item.id)}`;
      const getDay = (day: number) => usageDaily.get(`${key}:${day}`) ?? 0;
      const daily = Array.from({ length: daysInMonth }, (_, dayIndex) => getDay(dayIndex + 1));
      return [index + 1, item.sku, item.name, item.unit, ...daily, ...weekRanges.map((range) => weekTotal(getDay, range)), daily.reduce((sum, qty) => sum + qty, 0)];
    });
    return { room, headers, rows };
  });

  const totalInbound = Array.from(warehouseStats.values()).reduce((sum, stats) => sum + stats.inbound, 0);
  const totalDistributed = Array.from(warehouseStats.values()).reduce((sum, stats) => sum + stats.distributed, 0);
  const totalUsage = Array.from(roomStats.values()).reduce((sum, stats) => sum + stats.used, 0);
  const totalAdjustment = Array.from(warehouseStats.values()).reduce((sum, stats) => sum + stats.adjustment, 0) + Array.from(roomStats.values()).reduce((sum, stats) => sum + stats.adjustment, 0);

  function exportReport() {
    const summaryRows: ExcelCell[][] = [
      ["Laporan BMHP Golog.Irin"],
      ["Periode", month],
      ["Dibuat", getJakartaDateKeyClient()],
      [],
      ["Indikator", "Nilai"],
      ["Transaksi bulan berjalan", movements.length],
      ["Barang masuk Gudang Pusat", totalInbound],
      ["Distribusi ke ruangan", totalDistributed],
      ["Pengeluaran ruangan (historis)", totalUsage],
      ["Penyesuaian bersih", totalAdjustment],
      ["Jumlah master barang aktif", items.length],
      ["Jumlah ruangan aktif", rooms.length],
    ];

    const rekapSheet = [["SKU", "Nama Barang", "Kategori", "Satuan", "Stok Awal Gudang", "Barang Masuk", "Distribusi", "Penyesuaian", "Stok Akhir Gudang"], ...rekapRows];
    const distribusiSheet = [["Tanggal", "Ruangan", "SKU", "Nama Barang", "Satuan", "Jumlah", "Catatan"], ...distributionRows];
    const movementSheet = [["Tanggal", "SKU", "Nama Barang", "Satuan", "Lokasi", "Jenis", "Jumlah Bertanda", "Catatan"], ...movementRows];

    const sheets: Array<{ name: string; rows: ExcelCell[][] }> = [
      { name: "Ringkasan", rows: summaryRows },
      { name: "Rekap Gudang", rows: rekapSheet },
      { name: "Penerimaan", rows: [inboundHeaders, ...inboundRows] },
      { name: "Distribusi", rows: distribusiSheet },
    ];

    for (const sheet of roomSheetRows) {
      sheets.push({
        name: `Pengeluaran ${String(sheet.room.name)}`,
        rows: [[`Pengeluaran BHP (historis) - ${sheet.room.name}`], sheet.headers, ...sheet.rows],
      });
    }

    sheets.push({ name: "Transaksi", rows: movementSheet });
    downloadWorkbook(`BMHP-${month}.xlsx`, sheets);
  }

  return <div className="space-y-6">
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Laporan BMHP Bulanan</CardTitle>
          <p className="mt-1 text-sm text-slate-500">Format mengikuti pola penerimaan, distribusi, riwayat pengeluaran ruangan, dan rekap stok.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="month" value={month} onChange={(e) => onMonthChange(e.target.value)} className="h-10 sm:w-40" />
          <Button onClick={exportReport} disabled={!daysInMonth}><FileDown size={16} className="mr-2" />Export BMHP Excel</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Barang masuk", totalInbound],
            ["Distribusi", totalDistributed],
            ["Pengeluaran historis", totalUsage],
            ["Penyesuaian bersih", totalAdjustment],
          ].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-400">{String(label)}</p><p className="mt-1 text-2xl font-semibold">{formatNumber(Number(value))}</p><p className="mt-1 text-xs text-slate-400">periode {month}</p></div>)}
        </div>
      </CardContent>
    </Card>

    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader><CardTitle>Rekap stok Gudang Pusat</CardTitle><p className="mt-1 text-sm text-slate-500">Stok akhir dihitung dari stok awal + barang masuk − distribusi ± penyesuaian.</p></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400"><tr>{["SKU", "Barang", "Kategori", "Satuan", "Stok Awal", "Masuk", "Distribusi", "Penyesuaian", "Stok Akhir"].map((h) => <th className="px-3 py-3" key={h}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rekapRows.map((row) => <tr key={String(row[0])}><td className="px-3 py-3">{String(row[0])}</td><td className="px-3 py-3 font-medium">{String(row[1])}</td><td className="px-3 py-3 text-slate-500">{String(row[2])}</td><td className="px-3 py-3">{String(row[3])}</td><td className="px-3 py-3">{formatNumber(row[4])}</td><td className="px-3 py-3">{formatNumber(row[5])}</td><td className="px-3 py-3">{formatNumber(row[6])}</td><td className="px-3 py-3">{formatNumber(row[7])}</td><td className="px-3 py-3 font-semibold">{formatNumber(row[8])}</td></tr>)}
              {!rekapRows.length && <tr><td colSpan={9}><EmptyState title="Belum ada data bulan ini" text="Pilih bulan lain atau catat transaksi terlebih dahulu." /></td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label className="text-xs font-semibold text-slate-600">{label}</Label>{children}</div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="grid place-items-center px-5 py-14 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><ClipboardList size={20} /></div><p className="mt-4 font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p></div>; }



