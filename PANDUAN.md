# PANDUAN ASIX MUSIX (AMX)

Panduan dari nol sampai Asix Musix jalan di HP. Ikuti urut dari atas. Tiap bagian pendek, jadi pelan-pelan saja.

> **Perlu verifikasi:** tampilan Firebase Console, GitHub, dan Vercel sering berubah. Nama menu di sini bisa sedikit beda. Kalau menu tidak ketemu, cari kata kuncinya (misalnya "Authorized domains").

---

## 0. Isi proyek (16 file)

```
asix musix\
├── index.html
├── manifest.json
├── sw.js
├── firestore.rules
├── data-contoh.json
├── PANDUAN.md
├── assets\
│   ├── logo.png
│   ├── icon-192.png
│   └── icon-512.png
├── css\
│   └── style.css
└── js\
    ├── firebase-config.js
    ├── local-store.js
    ├── data.js
    ├── player.js
    ├── ui.js
    ├── timer.js
    ├── admin.js
    ├── pwa.js
    └── app.js
```

Catatan: `sw.js` dan `manifest.json` harus di root (sejajar `index.html`), bukan di dalam folder.

---

## 1. Coba di komputer dulu

Aplikasi ini memakai ES module, jadi **tidak jalan kalau `index.html` diklik dua kali** (alamat `file://`). Harus lewat server lokal.

1. Pasang Node.js (cukup versi LTS) dari nodejs.org kalau belum ada.
2. Buka CMD di folder `asix musix`, lalu ketik:

```
npx serve .
```

3. Buka alamat yang muncul di Chrome (biasanya `http://localhost:3000`).

Kalau layar kosong atau putih, tekan F12 lalu lihat tab Console. Pesan merahnya biasanya sudah menjelaskan penyebabnya (lihat bagian 9).

---

## 2. Firebase Console (project `asix-musix`)

Sebagian sudah lo kerjakan. Cek saja semuanya:

| Hal | Status yang benar |
|---|---|
| Paket | Spark (gratis). Aplikasi ini tidak memakai Storage, jadi tidak perlu Blaze. |
| Authentication > Sign-in method | **Google = Enabled** |
| Firestore Database | Sudah dibuat |
| Firestore > Rules | Isi `firestore.rules` sudah di-**Publish** |
| `js/firebase-config.js` | `firebaseConfig`, `ADMIN_EMAIL`, `JAMENDO_CLIENT_ID` sudah terisi |

Client Secret Jamendo **jangan** ditaruh di kode atau GitHub. Aplikasi ini hanya butuh Client ID.

---

## 3. Indeks Firestore (dibuat setelah app jalan)

Saat lo memilih playlist tertentu (bukan "Semua") untuk pertama kali, Firestore akan menolak query-nya dan meminta indeks gabungan (`playlists` + `addedAt`). Ini normal.

1. Buka aplikasi, pilih satu playlist (misalnya Lo-fi).
2. Tekan F12, tab Console. Cari pesan error merah berisi link `https://console.firebase.google.com/...`
3. Klik link itu, lalu tekan **Create index**.
4. Tunggu statusnya **Enabled** (beberapa menit), lalu muat ulang aplikasi.

Ulangi kalau ada link indeks lain yang muncul.

---

## 4. Push ke GitHub

### Cara paling mudah (tanpa perintah)

1. Buka github.com, buat repository baru, misalnya `asix-musix`. Pilih Private kalau mau.
2. Di halaman repo: **Add file > Upload files**.
3. Seret **isi** folder `asix musix` (index.html, manifest.json, sw.js, dan folder `assets`, `css`, `js`). Folder ikut terbawa kalau diseret.
4. Tekan **Commit changes**.

Cek di GitHub: `index.html` harus terlihat langsung di halaman depan repo, bukan di dalam folder lagi.

### Cara git (kalau sudah terbiasa)

Jalankan di folder `asix musix`. Ganti `USERNAME` dengan username GitHub lo:

```
git init
git add .
git commit -m "Asix Musix v1"
git branch -M main
git remote add origin https://github.com/USERNAME/asix-musix.git
git push -u origin main
```

---

## 5. Deploy ke Vercel

1. Buka vercel.com, login dengan GitHub.
2. **Add New > Project**, pilih repo `asix-musix`, tekan **Import**.
3. Isian penting:
   - **Framework Preset:** Other
   - **Build Command:** kosongkan
   - **Output Directory:** kosongkan
4. Tekan **Deploy**.
5. Setelah selesai, lo dapat alamat seperti `asix-musix.vercel.app`. Catat alamat itu.

Mulai sekarang, setiap kali lo push perubahan ke GitHub, Vercel otomatis deploy ulang.

---

## 6. Tambah domain Vercel ke Firebase (wajib, kalau tidak login admin gagal)

1. Firebase Console > **Authentication > Settings > Authorized domains**.
2. **Add domain**, isi alamat Vercel **tanpa** `https://`, contoh:

```
asix-musix.vercel.app
```

3. Simpan.

Kalau lo pakai domain sendiri nanti, tambahkan juga domain itu.

---

## 7. Login admin dan impor lagu pertama

Tombol admin di aplikasi **tersembunyi** sampai lo login sebagai admin. Login pertama lewat alamat khusus:

```
https://asix-musix.vercel.app/#admin
```

(ganti dengan alamat Vercel lo)

1. Tekan **Masuk dengan Google**, pilih email yang sama dengan `ADMIN_EMAIL`.
2. Kalau muncul "Akun ini bukan admin", berarti emailnya beda. Cek `ADMIN_EMAIL` di `js/firebase-config.js`.
3. Setelah masuk, buka tab **Impor Jamendo**. Isi tag, misalnya `lofi` atau `piano`, lalu tekan cari.
4. Putar pratinjau untuk menyeleksi, centang lagu yang diinginkan, pilih minimal 1 playlist, lalu **Simpan ke katalog**.
5. Tab **Kelola Lagu** dipakai untuk mengubah playlist atau tag, dan menghapus lagu.

Setelah login sekali, browser mengingat sesi. Ikon admin muncul di beranda, jadi lo tidak perlu mengetik `#admin` lagi.

Tips: pakai **satu kata** per pencarian supaya hasilnya banyak.

---

## 8. Pasang di HP Android

1. Buka alamat Vercel di **Chrome Android**.
2. Pakai ikon Pasang di beranda aplikasi, atau menu Chrome (titik tiga) > **Instal aplikasi** / **Tambahkan ke layar utama**.
3. Buka dari ikon di layar utama. Aplikasi tampil layar penuh.

Kalau tombol pasang tidak muncul: pastikan alamat memakai https, `manifest.json` bisa dibuka, ketiga PNG di `assets/` ada, dan `sw.js` sudah aktif (lihat bagian 9).

iPhone tidak didukung di versi ini.

---

## 9. Checklist tes di HP

Centang satu per satu:

- [ ] Beranda memuat lagu dan chip playlist bisa dipindah.
- [ ] Putar lagu, mini player muncul, Now Playing terbuka.
- [ ] Tombol **Back** HP menutup layar Now Playing / Antrean / Admin (tidak keluar dari aplikasi).
- [ ] Kunci layar saat lagu main: musik tetap jalan (tidak bisa dijamin di semua HP, wajib dites).
- [ ] Notifikasi Android menampilkan judul, cover, dan tombol putar/jeda/lanjut/sebelumnya.
- [ ] Tombol **Timer**: pilih 15 menit, lencana hitung mundur muncul. Untuk tes cepat, batalkan lalu pastikan lencana hilang.
- [ ] Favorit (hati) tersimpan dan masih ada setelah aplikasi ditutup lalu dibuka.
- [ ] Buka ulang aplikasi: lagu terakhir pulih dalam keadaan jeda.
- [ ] Login admin, impor 1-2 lagu, ubah playlist, hapus satu lagu.
- [ ] Matikan internet lalu buka aplikasi: tampilan tetap terbuka (lagu tidak bisa diputar tanpa internet, itu normal).

Cek service worker di Chrome komputer: F12 > Application > Service Workers (status **activated**), dan Cache Storage berisi `amx-shell-v1`.

---

## 10. Update aplikasi di kemudian hari

1. Ubah file, push ke GitHub (Vercel deploy otomatis).
2. Kalau ada file yang berubah, naikkan `CACHE_VERSI` di `sw.js` (`'v1'` jadi `'v2'`).
3. Kalau menambah file js baru, tambahkan juga ke daftar `FILE_INTI` di `sw.js`.
4. Pengguna cukup menutup lalu membuka lagi aplikasinya.

---

## 11. Masalah yang sering muncul

| Gejala | Penyebab dan solusi |
|---|---|
| Layar putih di komputer | Dibuka lewat `file://`. Pakai `npx serve .` (bagian 1). |
| Login Google: "unauthorized-domain" | Domain belum ditambahkan (bagian 6). |
| Popup login tidak muncul | Popup diblokir browser. Izinkan popup untuk situs ini. |
| "Ditolak oleh aturan Firestore" | Belum login admin, email beda dengan `ADMIN_EMAIL`, atau rules belum di-Publish. |
| Pilih playlist, daftar kosong atau error | Indeks belum dibuat (bagian 3). |
| Pencarian Jamendo gagal | Cek `JAMENDO_CLIENT_ID`. Coba satu kata saja. Lihat pesan di tab Console. |
| Lagu tertentu tidak bisa diputar | URL audio Jamendo bisa kedaluwarsa. Aplikasi mencoba memperbarui otomatis. Kalau tetap gagal, hapus lagu itu dan impor ulang. |
| Tampilan berantakan saat offline pertama kali | Tailwind belum pernah dimuat. Buka sekali saat online. |
| Perubahan tidak muncul setelah deploy | Naikkan `CACHE_VERSI`, lalu tutup dan buka ulang aplikasi. |
| Tombol pasang tidak muncul | Lihat bagian 8. |

---

## 12. Lisensi dan etika konten

- Semua lagu berasal dari Jamendo. Aplikasi menyimpan nama lisensi dan tautan sumber tiap lagu.
- Lisensi yang mengandung **NC** (non-komersial) hanya boleh untuk pemakaian non-komersial. Kalau Asix Musix nanti dimonetisasi (iklan, langganan), pilih lagu dengan lisensi yang membolehkan.
- Lisensi CC umumnya mewajibkan **atribusi** (menyebut artis dan lisensi). Pastikan kredit tampil jelas di aplikasi.
- Cek syarat pemakaian API Jamendo untuk jenis proyek lo, karena penggunaan komersial bisa butuh izin tambahan.

---

## 13. Kuota gratis Firestore (Spark)

Perkiraan batas harian paket Spark: sekitar 50.000 baca, 20.000 tulis, 20.000 hapus. **Perlu verifikasi:** angka bisa berubah, cek halaman harga Firebase.

Aplikasi ini hemat kuota karena memuat lagu per halaman (bukan sekaligus), menyimpan hasil di memori, dan tidak memakai pemantauan realtime pada koleksi lagu. Pantau di Firebase Console > Firestore > **Usage** setelah impor besar.

---

## 14. Daftar "Perlu verifikasi" yang masih terbuka

- Versi SDK Firebase (`10.12.2`) dan Tailwind CDN (`3.4.17`): cek versi terbaru di dokumentasi masing-masing.
- Parameter Jamendo API (`tags`, `audioformat`, `vocalinstrumental`, `order`) dan apakah panggilan langsung dari browser diizinkan.
- Kuota gratis Firestore.
- Kestabilan URL audio Jamendo.
- Pemutaran saat layar terkunci dan notifikasi Android: hanya bisa dipastikan lewat tes di HP lo.
