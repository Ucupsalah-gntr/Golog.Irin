import { useState } from "react";
import { Link } from "wouter";
import { ShieldCheck, Hospital, RefreshCw, ArrowLeft, UserRound, Save } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function UsersRooms() {
  const { user, loading, isAuthenticated } = useAuth();
  const [draftRooms, setDraftRooms] = useState<Record<number, string>>({});
  const users = trpc.system.users.list.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });
  const catalog = trpc.catalog.all.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });
  const assignRoom = trpc.system.users.assignRoom.useMutation({
    onSuccess: (_, input) => {
      toast.success(input.roomId === null ? "Akun dilepas dari ruangan" : "Ruangan akun berhasil diperbarui");
      users.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const rooms = catalog.data?.rooms ?? [];

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-[#f4f7f6]"><p className="text-sm text-slate-500">Menyiapkan halaman akun…</p></div>;
  }

  if (!isAuthenticated) {
    return <div className="min-h-screen grid place-items-center bg-[#f4f7f6] p-6"><Card className="max-w-md"><CardContent className="p-8 text-center"><p className="text-lg font-semibold">Belum masuk</p><p className="mt-2 text-sm text-slate-500">Silakan masuk ke Gudang IR terlebih dahulu.</p><a href="/" className="mt-6 inline-flex rounded-xl bg-[#102a2b] px-4 py-2 text-sm font-medium text-white">Kembali ke login</a></CardContent></Card></div>;
  }

  if (user?.role !== "admin") {
    return <div className="min-h-screen grid place-items-center bg-[#f4f7f6] p-6"><Card className="max-w-md"><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto mb-4 text-rose-500" size={30} /><p className="text-lg font-semibold">Akses khusus kepala gudang</p><p className="mt-2 text-sm text-slate-500">Halaman pengaturan akun dan ruangan hanya dapat dibuka oleh admin.</p><Link href="/"><Button className="mt-6 rounded-xl bg-[#102a2b]">Kembali</Button></Link></CardContent></Card></div>;
  }

  return (
    <div className="min-h-screen bg-[#f4f7f6] text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#c9f3d7] text-[#102a2b]"><Hospital size={22} /></div>
            <div><p className="font-semibold">Gudang IR</p><p className="text-xs text-slate-500">Akun & Ruangan</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => { users.refetch(); catalog.refetch(); }} disabled={users.isFetching || catalog.isFetching}>
              <RefreshCw size={16} className={`mr-2 ${users.isFetching || catalog.isFetching ? "animate-spin" : ""}`} />Segarkan
            </Button>
            <Link href="/"><Button variant="outline" className="rounded-xl"><ArrowLeft size={16} className="mr-2" />Kembali</Button></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Administrasi</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Akun & Ruangan</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Tautkan akun petugas ke satu ruangan aktif. Penguncian akses ruangan belum diaktifkan pada tahap ini.</p>
        </div>

        <Card className="border-slate-200/80 shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRound size={20} />Daftar akun</CardTitle></CardHeader>
          <CardContent className="p-0">
            {users.isLoading ? <div className="p-8 text-center text-sm text-slate-500">Memuat akun…</div> : users.isError ? <div className="p-8 text-center text-sm text-rose-600">{users.error.message}</div> : !users.data?.length ? <div className="p-8 text-center text-sm text-slate-500">Belum ada akun yang tersedia.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-y border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-5 py-3">Nama</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Ruangan</th><th className="px-5 py-3 text-right">Aksi</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.data.map((row) => {
                      const currentRoomId = draftRooms[row.id] ?? (row.roomId == null ? "" : String(row.roomId));
                      return (
                        <UserRow
                          key={row.id}
                          row={row}
                          currentRoomId={currentRoomId}
                          rooms={rooms}
                          saving={assignRoom.isPending && assignRoom.variables?.userId === row.id}
                          onChange={(value) => setDraftRooms((prev) => ({ ...prev, [row.id]: value }))}
                          onSave={() => assignRoom.mutate({ userId: row.id, roomId: currentRoomId === "" ? null : Number(currentRoomId) })}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="p-5 text-sm leading-6 text-amber-900">
            <strong>Catatan tahap ini:</strong> pengaturan ruangan baru menentukan data penugasan akun. Validasi backend agar petugas hanya dapat membuat, melihat, dan menerima permintaan untuk ruangannya akan diaktifkan pada tahap 3C-3.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function UserRow({ row, currentRoomId, rooms, saving, onChange, onSave }: any) {
  return (
    <tr className="align-middle">
      <td className="px-5 py-4"><div className="font-medium">{row.name ?? "Tanpa nama"}</div><div className="text-xs text-slate-400">ID #{row.id}</div></td>
      <td className="px-5 py-4 text-slate-500">{row.email ?? "—"}</td>
      <td className="px-5 py-4"><Badge variant="outline" className={row.role === "admin" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{row.role === "admin" ? "Kepala gudang" : "Petugas"}</Badge></td>
      <td className="px-5 py-4"><select value={currentRoomId} onChange={(event) => onChange(event.target.value)} className="h-10 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500"><option value="">Belum ditugaskan</option>{rooms.map((room: any) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></td>
      <td className="px-5 py-4 text-right"><Button className="rounded-xl bg-[#102a2b]" onClick={onSave} disabled={saving}><Save size={16} className="mr-2" />{saving ? "Menyimpan…" : "Simpan"}</Button></td>
    </tr>
  );
}
