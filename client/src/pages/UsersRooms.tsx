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
  const [draftRooms, setDraftRooms] = useState<Record<number, number[]>>({});
  const users = trpc.system.users.list.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });
  const catalog = trpc.catalog.all.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });
  const assignRooms = trpc.system.users.assignRooms.useMutation({
    onSuccess: (_, input) => {
      toast.success(input.roomIds.length ? "Akses ruangan akun berhasil diperbarui" : "Akses ruangan akun dilepas");
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
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Tentukan satu atau beberapa ruangan yang dapat dilayani akun petugas. Ruangan aktif dipilih oleh petugas setelah login.</p>
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
                          currentRoomIds={draftRooms[row.id] ?? (Array.isArray(row.roomIds) ? row.roomIds.map(Number) : row.roomId == null ? [] : [Number(row.roomId)])}
                          rooms={rooms}
                          saving={assignRooms.isPending && assignRooms.variables?.userId === row.id}
                          onChange={(value: number[]) => setDraftRooms((prev) => ({ ...prev, [row.id]: value }))}
                          onSave={(roomIds: number[]) => assignRooms.mutate({ userId: row.id, roomIds })}
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
            <strong>Catatan:</strong> akses ruangan tersimpan per akun dan digunakan oleh backend untuk membatasi permintaan petugas ke ruangan yang ditugaskan. Perubahan akses berlaku setelah akun memuat ulang sesi kerja.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function UserRow({ row, currentRoomIds, rooms, saving, onChange, onSave }: any) {
  const toggleRoom = (roomId: number) => {
    const next = currentRoomIds.includes(roomId)
      ? currentRoomIds.filter((id: number) => id !== roomId)
      : [...currentRoomIds, roomId];
    onChange(next);
  };

  return (
    <tr className="align-middle">
      <td className="px-5 py-4"><div className="font-medium">{row.name ?? "Tanpa nama"}</div><div className="text-xs text-slate-400">ID #{row.id}</div></td>
      <td className="px-5 py-4 text-slate-500">{row.email ?? "—"}</td>
      <td className="px-5 py-4"><Badge variant="outline" className={row.role === "admin" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{row.role === "admin" ? "Kepala gudang" : "Petugas"}</Badge></td>
      <td className="px-5 py-4">
        <div className="flex max-w-sm flex-wrap gap-2">
          {rooms.map((room: any) => (
            <button key={room.id} type="button" onClick={() => toggleRoom(Number(room.id))} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${currentRoomIds.includes(Number(room.id)) ? "border-[#0091B9] bg-[#E6F4F7] text-[#004E9B]" : "border-slate-200 bg-white text-slate-500 hover:border-[#9CCED8]"}`}>
              {room.name}
            </button>
          ))}
        </div>
        {!currentRoomIds.length && <p className="mt-2 text-xs text-amber-600">Belum ada akses ruangan.</p>}
      </td>
      <td className="px-5 py-4 text-right"><Button className="rounded-xl" onClick={() => onSave(currentRoomIds)} disabled={saving}><Save size={16} className="mr-2" />{saving ? "Menyimpan…" : "Simpan"}</Button></td>
    </tr>
  );
}
