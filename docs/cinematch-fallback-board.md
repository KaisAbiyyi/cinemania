# CineMatch — Status Board, Readability Contract & Notion Fallback

> **Kebijakan Owner (2026-11-26):** CineMatch tetap memakai **Notion** sebagai Project Hub dan papan kerja bersama, sekaligus menjaga **catatan di GitHub** ([Issue #76](https://github.com/KaisAbiyyi/cinemania/issues/76) dan berkas ini) selalu lengkap, rapi, dan aman sebagai cadangan (*fallback*) apabila Notion terkendala kuota atau akses (misalnya batas *Query Data Source*).

## 1. Aturan Format Respon Reviewer (Kontrak Keterbacaan Owner)

Setiap laporan reviewer resmi CineMatch (di chat maupun catatan GitHub/Notion) mengikuti struktur berikut:

1. **Identitas & Keputusan di Paling Atas:** Sebutkan nama reviewer resmi, keputusan singkat (aman & di-merge / perlu revisi / ditahan), dan dampaknya ke situs produksi.
2. **Penjelasan Bahasa Awam:** Jelaskan inti perubahan, hasil pengecekan, tindakan yang sudah dijalankan, serta langkah lanjutan memakai bahasa sehari-hari yang langsung dipahami tanpa harus membaca deretan hash/SHA di tengah paragraf.
3. **Komentar Review GitHub Hanya Saat Perlu Revisi:** Jika aman dan masuk batas wewenang reviewer, tidak perlu membuat komentar revisi di GitHub.
4. **Semua SHA & ID Teknis di Bagian Akhir:** Gabungkan seluruh SHA commit, tree SHA, ID run CI, ID deployment Vercel, dan tautan teknis di satu bagian **Referensi Teknis & SHA** di paling bawah.

## 2. Ringkasan Papan Tugas Terkini

- **Selesai (`Done` — 26 tugas):** `CINE-001` s.d. `CINE-025` dan infrastruktur lokal `GH-52` sudah selesai, ter-merge ke `main`, dan seluruh issue GitHub-nya berstatus `CLOSED`.
- **Sedang Tahap Review / Ditahan (`Review` / `HOLD` — 2 tugas):**
  - **CINE-026** ([Issue #28](https://github.com/KaisAbiyyi/cinemania/issues/28)) & **CINE-063** ([Issue #63](https://github.com/KaisAbiyyi/cinemania/issues/63)):
    - PR infrastruktur alat bantu tes staging ([PR #75](https://github.com/KaisAbiyyi/cinemania/pull/75)) sudah direview resmi (`Gemini 4 Hydrogen`), lolos semua cek lokal & CI GitHub, lalu di-merge ke `main` dengan deploy Vercel produksi tetap dilewati aman dan dipulihkan.
    - Kandidat fitur utama ([PR #66](https://github.com/KaisAbiyyi/cinemania/pull/66)) tetap berstatus **Draft**. Owner sudah memberi izin eksklusif baru untuk menjalankan 1x tes ringan `gate-a-only` di staging memakai workflow `main` terbaru.
- **Antrean Berikutnya (`Backlog` — 3 tugas):**
  - **CINE-027** ([Issue #29](https://github.com/KaisAbiyyi/cinemania/issues/29), `P0`) — Anggaran performa & observabilitas Next.js; menunggu `CINE-026` selesai.
  - **CINE-028** ([Issue #30](https://github.com/KaisAbiyyi/cinemania/issues/30), `P1`) — Operasional rilis produksi, migrasi, rollback & kepatuhan TMDB; menunggu `CINE-026` & `CINE-027` selesai. *Catatan bawaan penting yang harus dituntaskan di tahap ini:* rilis migrasi PostgreSQL produksi (`001`–`006`), scheduler retensi `RoomExpiryWorker`, penyesuaian ukuran `pg Pool` terhadap batas session pooler, secret runtime produksi & audit `npm audit`, serta uji asap dan rollback produksi.
  - **CINE-029** ([Issue #31](https://github.com/KaisAbiyyi/cinemania/issues/31), `P0`) — Evaluasi independen menyeluruh setelah `CINE-026`, `CINE-027`, dan `CINE-028` tuntas.

## 3. Indeks Pelajaran Terverifikasi Kunci (Cadangan Learning Log)

Ringkasan pelindung (*guardrails*) terpenting agar tidak hilang saat Notion Learning Log sulit diakses:

- **Integritas Bukti (`L-001`–`L-004`, `L-011`, `L-014`):** Selalu buka file sumber pada SHA tepat alih-alih menebak dari `package.json`; pakai permalink GitHub alih-alih path lokal; pisahkan hasil lokal, CI, dan staging; screenshot UI harus membuktikan state final yang lolos dekode gambar.
- **Toolchain, Runtime & Vercel (`L-005`–`L-015`):** Pertahankan satu package manager kanonik (`npm ci` di Node 24 LTS) dan cocokkan dengan `vercel.json` + dashboard settings; periksa log build cloud aktual; ikuti prosedur skip/restore `Ignored Build Step` Vercel saat menggabung PR docs/infra ke `main` bila rilis produksi belum diizinkan.
- **Database PostgreSQL & Keamanan RLS (`L-027`–`L-049`, `L-053`, `L-055`, `L-059`–`L-063`):** Token kapabilitas pakai detik RFC 7519 (`Math.floor(Date.now() / 1000)`); topik Realtime `room:${room_id}`; policy tolak broadcast `AS RESTRICTIVE`; helper `SECURITY DEFINER` membaca identitas dari JWT `sub`; uji lock memakai `pg_locks` ter-scope PID; uji DDL destruktif terisolasi dari `public`; `SAVEPOINT` untuk retry kode `23505`; satukan mutasi DB dan rotasi token dalam satu transaksi.
- **Frontend Next.js 16, React 19 & Playwright (`L-050`–`L-058`):** Bungkus `useSearchParams()` dengan `<Suspense>` terlokalisasi; bedakan `customOverrides` dari preset tanggal kalender lokal; kembalikan `tests/fixtures/request-logs.json` sesudah run Playwright lokal; isolasi sentinel per spec paralel dan uji ulang `--repeat-each=5 --workers=1`.
- **Kualifikasi Staging (`L-065` & entri 16–25 Nov 2026):** Perbarui token sebelum TTL 60 detik berakhir dan buat client/socket baru saat reconnect; catat kegagalan pertama secara fail-closed; pisahkan status warm-path (`gate-a-only`) dari cold-path recovery; uji sambungan end-to-end antarproses pada `event-relay.cjs`, bukan hanya unit modul terpisah.

---

### Referensi Teknis & SHA

- **Hub Fallback Live di GitHub:** [Issue #76](https://github.com/KaisAbiyyi/cinemania/issues/76)
- **Baseline `main`:** `26e761ba2892c1952120a0282aad79005b9732ac` ([PR #75](https://github.com/KaisAbiyyi/cinemania/pull/75))
- **Kandidat PR #66 (Draft):** [PR #66](https://github.com/KaisAbiyyi/cinemania/pull/66) (`feature/cine-026-063-integration` @ `00555c03d4173ac54750677207b78252e2063257`)
- **Isu Terbuka:** `#28` (`CINE-026`), `#63` (`CINE-063`), `#29` (`CINE-027`), `#30` (`CINE-028`), `#31` (`CINE-029`)
- **Halaman Notion Terkait:**
  - Project Hub: `https://app.notion.com/p/40cc4a6aaf73813bab68ef3e38d75cab`
  - Execution Tasks DB: `https://app.notion.com/p/c3372be08c1e4584a9c6d7143752cdf8`
  - Governance Rules: `https://app.notion.com/p/40fc4a6aaf7381169c17ee5584d48fef`
  - Agent Learning Log: `https://app.notion.com/p/40fc4a6aaf738176a09ed095a929f27e`
