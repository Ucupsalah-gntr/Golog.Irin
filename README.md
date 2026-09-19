# Golog.Irin

Sistem manajemen gudang Rawat Intensif.

Stack aplikasi:
- Vercel
- React + Vite
- tRPC
- Supabase Auth
- Supabase Postgres + Drizzle

Login aplikasi menggunakan username + password. Email Supabase digunakan sebagai identitas internal Auth.

Status:
- Migrasi dari Manus ke Supabase sudah diterapkan di branch `main`.
- Frontend menggunakan Supabase Auth untuk sesi login.
- Backend tRPC memvalidasi access token Supabase dan menerapkan role `admin` / `user`.
