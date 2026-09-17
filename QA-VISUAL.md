# Catatan QA Visual Gudang IR

- Screenshot desktop 1280x720 menunjukkan dashboard ter-render dengan sidebar, header, empat kartu ringkasan, panel aktivitas, dan panel alur kerja.
- Screenshot mobile 390x844 menangkap state loading `Menyiapkan ruang kerja…`; ini konsisten dengan query autentikasi yang belum selesai pada saat capture, bukan error render. Dev server tetap berstatus running dan typecheck bersih.
- Layout mobile menggunakan sidebar off-canvas dan tombol menu, sehingga perlu diuji ulang setelah sesi autentikasi stabil.
