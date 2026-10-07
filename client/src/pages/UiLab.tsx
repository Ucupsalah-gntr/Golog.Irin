import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Hospital,
  Menu,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Role = "bang-ucup" | "petugas";
type Screen = "overview" | "requests";

type RequestRow = {
  no: string;
  room: string;
  priority: "Darurat" | "Mendesak" | "Normal";
  items: number;
  age: string;
  status: "Menunggu" | "Sebagian" | "Disetujui";
};

const requestRows: RequestRow[] = [
  { no: "REQ-261007-014", room: "ICU", priority: "Darurat", items: 18, age: "8 menit", status: "Menunggu" },
  { no: "REQ-261007-013", room: "ICCU", priority: "Mendesak", items: 11, age: "24 menit", status: "Menunggu" },
  { no: "REQ-261007-011", room: "PICU", priority: "Normal", items: 7, age: "1 jam", status: "Sebagian" },
  { no: "REQ-261007-009", room: "ICU", priority: "Normal", items: 12, age: "2 jam", status: "Disetujui" },
];

const petugasRequests: RequestRow[] = [
  { no: "REQ-261007-014", room: "ICU", priority: "Darurat", items: 18, age: "Baru saja", status: "Menunggu" },
  { no: "REQ-300926-008", room: "ICU", priority: "Normal", items: 9, age: "Kemarin", status: "Disetujui" },
  { no: "REQ-290926-004", room: "ICU", priority: "Normal", items: 6, age: "2 hari lalu", status: "Sebagian" },
];

function priorityClass(priority: RequestRow["priority"]) {
  if (priority === "Darurat") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "Mendesak") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusClass(status: RequestRow["status"]) {
  if (status === "Disetujui") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Sebagian") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function Metric({ label, value, note, icon: Icon, tone = "teal" }: any) {
  const toneClass = {
    teal: "bg-[#E8F7F9] text-[#007B9D]",
    orange: "bg-orange-50 text-orange-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
  }[tone];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(7,48,74,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#07304A]">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{note}</p>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${toneClass}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function RequestCard({ row, admin, onOpen }: { row: RequestRow; admin?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#9CCED8] hover:shadow-[0_10px_30px_rgba(7,48,74,0.08)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#07304A]">{row.no}</span>
            <Badge className={`border ${statusClass(row.status)}`}>{row.status}</Badge>
            <Badge className={`border ${priorityClass(row.priority)}`}>{row.priority}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{row.room} · {row.items} item · {row.age}</p>
        </div>
        <ArrowRight size={18} className="mt-1 shrink-0 text-slate-300" />
      </div>
      {admin && row.status === "Menunggu" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#F4FAFC] px-3 py-2 text-xs font-medium text-[#315563]">
          <Clock3 size={14} />
          Perlu diproses Bang Ucup
        </div>
      )}
    </button>
  );
}

export default function UiLab() {
  const [role, setRole] = useState<Role>("bang-ucup");
  const [screen, setScreen] = useState<Screen>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeRoom, setActiveRoom] = useState("ICU");
  const [showDetail, setShowDetail] = useState(false);

  const admin = role === "bang-ucup";
  const rows = admin ? requestRows : petugasRequests;

  const navItems = useMemo(
    () =>
      admin
        ? [
            { id: "overview" as Screen, label: "Ringkasan", icon: Activity },
            { id: "requests" as Screen, label: "Permintaan", icon: ClipboardList },
            { id: "stock" as const, label: "Stok barang", icon: Boxes },
          ]
        : [
            { id: "overview" as Screen, label: "Ringkasan", icon: Activity },
            { id: "requests" as Screen, label: "Permintaan", icon: ClipboardList },
            { id: "stock" as const, label: "Stok ruangan", icon: Boxes },
          ],
    [admin],
  );

  function go(next: Screen) {
    setScreen(next);
    setMobileMenu(false);
    setShowDetail(false);
  }

  return (
    <div className="min-h-screen bg-[#F4FAFC] text-[#07304A]">
      <div className="border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#07304A] text-white shadow-sm">
              <Hospital size={19} />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">Golog.Irin</p>
              <p className="text-[11px] text-slate-400">UI Lab · Hybrid Action-first</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => { setRole("petugas"); setScreen("overview"); }}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${role === "petugas" ? "bg-white text-[#07304A] shadow-sm" : "text-slate-400"}`}
            >
              Petugas
            </button>
            <button
              type="button"
              onClick={() => { setRole("bang-ucup"); setScreen("overview"); }}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${role === "bang-ucup" ? "bg-[#07304A] text-white shadow-sm" : "text-slate-400"}`}
            >
              Bang Ucup
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="hidden min-h-[calc(100vh-65px)] w-64 shrink-0 border-r border-slate-200 bg-white px-4 py-5 lg:block">
          <div className="rounded-3xl bg-[#07304A] p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10">
                {admin ? <ShieldCheck size={19} /> : <UserRound size={19} />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{admin ? "Bang Ucup" : "Petugas Ruangan 1"}</p>
                <p className="truncate text-xs text-white/60">{admin ? "Pengelola gudang & distribusi" : `${activeRoom} · Petugas ruangan`}</p>
              </div>
            </div>
          </div>

          <nav className="mt-5 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = item.id === screen;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.id !== ("stock" as Screen) && go(item.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-medium transition ${selected ? "bg-[#E8F7F9] text-[#007B9D]" : "text-slate-500 hover:bg-slate-50 hover:text-[#07304A]"}`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#07304A]">
              <Sparkles size={15} />
              Arah desain
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Fokus utama bukan banyaknya angka, tetapi apa yang harus diselesaikan pengguna berikutnya.
            </p>
          </div>
        </aside>

        {mobileMenu && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button aria-label="Tutup menu" className="absolute inset-0 bg-[#07304A]/35" onClick={() => setMobileMenu(false)} />
            <div className="absolute left-0 top-0 h-full w-[82%] max-w-xs bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <p className="font-semibold">Golog.Irin</p>
                  <p className="text-xs text-slate-400">UI Lab</p>
                </div>
                <button type="button" className="rounded-xl p-2 hover:bg-slate-50" onClick={() => setMobileMenu(false)}>
                  <X size={19} />
                </button>
              </div>
              <div className="mt-5 space-y-1">
                {navItems.slice(0, 2).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.label} type="button" onClick={() => go(item.id)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
                      <Icon size={18} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-[#F4FAFC]/90 px-4 py-3 backdrop-blur lg:hidden">
            <button type="button" aria-label="Buka menu" className="rounded-xl bg-white p-2 shadow-sm" onClick={() => setMobileMenu(true)}>
              <Menu size={19} />
            </button>
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#007B9D]">{admin ? "Ruang kendali" : "Ruang kerja"}</p>
              <p className="text-sm font-semibold">{screen === "overview" ? "Ringkasan" : "Permintaan"}</p>
            </div>
            <Bell size={19} className="text-slate-400" />
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
            {screen === "overview" ? (
              <>
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#007B9D]">
                      {admin ? "Ruang kendali" : "Ruang kerja"}
                    </p>
                    <div className="mt-1 text-3xl font-bold tracking-tight text-[#07304A] sm:text-4xl">
                      {admin ? "Selamat datang, Bang Ucup." : "Selamat datang, Petugas Ruangan 1."}
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      {admin
                        ? "Tampilan dipusatkan pada pekerjaan yang perlu dibereskan hari ini: permintaan, stok kritis, dan distribusi."
                        : "Tampilan dipusatkan pada pengajuan kebutuhan, status permintaan, dan kondisi stok ruangan."}
                    </p>
                  </div>

                  {admin ? (
                    <Button className="h-12 rounded-2xl bg-[#07304A] px-5 shadow-[0_8px_24px_rgba(7,48,74,0.16)] hover:bg-[#0B4668]" onClick={() => go("requests")}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Buka antrean permintaan
                    </Button>
                  ) : (
                    <Button className="h-12 rounded-2xl bg-[#FF6500] px-5 shadow-[0_8px_24px_rgba(255,101,0,0.18)] hover:bg-[#E95A00)" onClick={() => go("requests")}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Buat permintaan
                    </Button>
                  )}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {admin ? (
                    <>
                      <Metric label="Menunggu diproses" value="7" note="Permintaan baru masuk" icon={Clock3} tone="orange" />
                      <Metric label="Stok kritis" value="3" note="Perlu perhatian hari ini" icon={Activity} tone="orange" />
                      <Metric label="Distribusi hari ini" value="12" note="Sudah dipindahkan ke ruangan" icon={Truck} tone="blue" />
                      <Metric label="Item aktif" value="148" note="Master barang tersedia" icon={Boxes} tone="teal" />
                    </>
                  ) : (
                    <>
                      <Metric label="Permintaan aktif" value="1" note="Sedang menunggu diproses" icon={Clock3} tone="orange" />
                      <Metric label="Stok perlu dicek" value="2" note="Di bawah batas minimum" icon={Activity} tone="orange" />
                      <Metric label="Selesai minggu ini" value="8" note="Permintaan berhasil dipenuhi" icon={CheckCircle2} tone="green" />
                      <Metric label="Ruangan aktif" value={activeRoom} note="Bisa diganti dari sini" icon={Hospital} tone="teal" />
                    </>
                  )}
                </div>

                {!admin && (
                  <div className="mt-4 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(7,48,74,0.06)] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Ruangan aktif</p>
                      <p className="mt-1 text-lg font-bold text-[#07304A]">{activeRoom}</p>
                    </div>
                    <select className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#07304A]" value={activeRoom} onChange={(event) => setActiveRoom(event.target.value)}>
                      <option>ICU</option>
                      <option>ICCU</option>
                      <option>PICU</option>
                    </select>
                  </div>
                )}

                <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(7,48,74,0.06)]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#007B9D]">Fokus sekarang</p>
                        <div className="mt-1 text-xl font-bold text-[#07304A]">{admin ? "Antrean permintaan" : "Permintaan saya"}</div>
                      </div>
                      <button type="button" className="text-xs font-semibold text-[#007B9D] hover:underline" onClick={() => go("requests")}>Lihat semua</button>
                    </div>

                    <div className="mt-4 space-y-2.5">
                      {rows.slice(0, admin ? 4 : 3).map((row) => (
                        <RequestCard key={row.no} row={row} admin={admin} onOpen={() => setShowDetail(true)} />
                      ))}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[#9CCED8] bg-gradient-to-br from-[#E8F7F9] to-white p-5 shadow-[0_8px_30px_rgba(0,78,155,0.06)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#007B9D]">UX intent</p>
                    <div className="mt-1 text-xl font-bold text-[#07304A]">
                      {admin ? "“Apa yang perlu saya cek sekarang?”" : "“Apa yang harus saya lakukan sekarang?”"}
                    </div>
                    <div className="mt-5 space-y-3">
                      {(admin
                        ? [
                            ["01", "Buka antrean", "Kerjakan permintaan yang menunggu paling atas."],
                            ["02", "Cek stok", "Perhatikan item kritis sebelum distribusi."],
                            ["03", "Terapkan distribusi", "Pindahkan stok sesuai jumlah yang tersedia."],
                          ]
                        : [
                            ["01", "Pilih ruangan", "Pastikan ruangan aktif sudah benar."],
                            ["02", "Buat permintaan", "Masukkan kebutuhan dalam satu alur."],
                            ["03", "Pantau status", "Tidak perlu menebak posisi permintaan."],
                          ]).map(([n, title, text]) => (
                        <div key={n} className="flex gap-3 rounded-2xl border border-white bg-white/75 p-3">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#07304A] text-[11px] font-bold text-white">{n}</div>
                          <div>
                            <p className="text-sm font-semibold text-[#07304A]">{title}</p>
                            <p className="mt-0.5 text-xs leading-5 text-slate-500">{text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(7,48,74,0.06)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Stok yang perlu diperhatikan</p>
                      <div className="mt-1 text-xl font-bold">Tiga item paling dekat dengan batas minimum</div>
                    </div>
                    <button type="button" className="hidden text-xs font-semibold text-[#007B9D] hover:underline sm:block">Buka stok</button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      ["Masker N95", "8", "minimum 10", "Kritis"],
                      ["Spuit 5 mL", "14", "minimum 20", "Perlu cek"],
                      ["IV Catheter 20G", "23", "minimum 25", "Perlu cek"],
                    ].map(([name, qty, min, state]) => (
                      <div key={name} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">{name}</p>
                          <Badge className={state === "Kritis" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-amber-200 bg-amber-50 text-amber-700"}>{state}</Badge>
                        </div>
                        <div className="mt-3 flex items-end gap-2">
                          <span className="text-2xl font-bold">{qty}</span>
                          <span className="pb-1 text-xs text-slate-400">{min}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#007B9D]">Alur permintaan</p>
                    <div className="mt-1 text-3xl font-bold tracking-tight text-[#07304A]">{admin ? "Antrean permintaan" : `Permintaan · ${activeRoom}`}</div>
                    <p className="mt-2 text-sm text-slate-500">
                      {admin ? "Kerjakan dari yang paling mendesak. Detail lengkap dibuka setelah pengguna memilih permintaan." : "Satu tempat untuk membuat permintaan dan memantau statusnya."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={17} />
                      <input className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-[#0091B9] sm:w-64" placeholder="Cari nomor permintaan" />
                    </div>
                    {!admin && (
                      <Button className="h-11 rounded-2xl bg-[#FF6500] px-4 hover:bg-[#E95A00)" onClick={() => setShowDetail(true)}>
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Buat permintaan
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  {[
                    ["Semua", String(rows.length)],
                    ["Menunggu", String(rows.filter((r) => r.status === "Menunggu").length)],
                    ["Sebagian", String(rows.filter((r) => r.status === "Sebagian").length)],
                    ["Disetujui", String(rows.filter((r) => r.status === "Disetujui").length)],
                  ].map(([label, value], index) => (
                    <button key={label} type="button" className={`rounded-2xl border p-4 text-left transition ${index === 0 ? "border-[#9CCED8] bg-white shadow-sm" : "border-slate-200 bg-white hover:border-[#9CCED8]"}`}>
                      <p className="text-xs font-semibold text-slate-400">{label}</p>
                      <p className="mt-1 text-2xl font-bold">{value}</p>
                    </button>
                  ))}
                </div>

                <div className="mt-5 space-y-3">
                  {rows.map((row) => <RequestCard key={row.no} row={row} admin={admin} onOpen={() => setShowDetail(true)} />)}
                </div>
              </>
            )}

            <div className="mt-8 text-center text-[11px] text-slate-400">
              Konsep visual · tidak terhubung ke data production · aman untuk eksplorasi UI/UX.
            </div>
          </div>
        </main>
      </div>

      <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-[0_10px_35px_rgba(7,48,74,0.14)] backdrop-blur lg:hidden">
        <button type="button" className={`rounded-xl px-4 py-2 text-xs font-semibold ${screen === "overview" ? "bg-[#E8F7F9] text-[#007B9D]" : "text-slate-400"}`} onClick={() => go("overview")}>Ringkasan</button>
        <button type="button" className={`rounded-xl px-4 py-2 text-xs font-semibold ${screen === "requests" ? "bg-[#07304A] text-white" : "text-slate-400"}`} onClick={() => go("requests")}>Permintaan</button>
      </div>

      {showDetail && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#07304A]/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#007B9D]">{admin ? "Detail pekerjaan" : "Buat permintaan"}</p>
                <div className="mt-1 text-xl font-bold text-[#07304A]">{admin ? "REQ-261007-014 · ICU" : `Permintaan untuk ${activeRoom}`}</div>
              </div>
              <button type="button" className="rounded-xl p-2 hover:bg-slate-50" onClick={() => setShowDetail(false)}><X size={19} /></button>
            </div>
            {admin ? (
              <div className="space-y-4 p-5 sm:p-6">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-700"><Clock3 size={15} /> Darurat · masuk 8 menit lalu</div>
                  <p className="mt-1 text-xs leading-5 text-rose-700/80">ICU meminta 18 jenis barang. Prioritaskan item kritis lebih dahulu.</p>
                </div>
                <div className="space-y-2">
                  {["Masker N95", "Spuit 5 mL", "IV Catheter 20G", "Infusion Set Adult"].map((item, index) => (
                    <div key={item} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3">
                      <div>
                        <p className="text-sm font-semibold">{item}</p>
                        <p className="text-xs text-slate-400">Diminta {index + 4}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#07304A]">{Math.max(index + 2, 1)}</p>
                        <p className="text-[11px] text-slate-400">dipindahkan</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-[#9CCED8] bg-[#F4FAFC] p-4 text-sm text-[#315563]">
                  Review tetap fokus pada nama barang, jumlah diminta, jumlah yang dipindahkan, dan dampaknya ke stok pusat.
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="rounded-2xl" onClick={() => setShowDetail(false)}>Tutup</Button>
                  <Button className="rounded-2xl bg-[#07304A] hover:bg-[#0B4668]" onClick={() => setShowDetail(false)}>
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Terapkan distribusi
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-5 sm:p-6">
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-sm font-semibold text-orange-800">Langkah 1 · Isi kebutuhan</p>
                  <p className="mt-1 text-xs leading-5 text-orange-700/80">Form dibuat bertahap supaya pengguna tidak perlu melihat tabel panjang sejak awal.</p>
                </div>
                {["Masker N95", "Spuit 5 mL", "IV Catheter 20G"].map((item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{item}</p>
                      <p className="text-xs text-slate-400">Stok ruangan 23</p>
                    </div>
                    <input className="h-10 w-24 rounded-xl border border-slate-200 bg-white px-3 text-center text-sm font-semibold outline-none focus:border-[#0091B9]" defaultValue={index + 2} type="number" min={1} />
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl bg-[#07304A] px-4 py-3 text-white">
                  <div>
                    <p className="text-xs text-white/60">Total item diminta</p>
                    <p className="text-lg font-bold">9 unit</p>
                  </div>
                  <Button className="rounded-xl bg-[#FF6500] hover:bg-[#E95A00)" onClick={() => setShowDetail(false)}>
                    Lanjut review
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
