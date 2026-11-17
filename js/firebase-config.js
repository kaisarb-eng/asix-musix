// =====================================================================
// Asix Musix (AMX) — js/firebase-config.js
// Konfigurasi + inisialisasi Firebase (Firestore + Authentication).
// Memenuhi fitur: 2 (katalog), 9 (panel admin), 15 (impor Jamendo).
//
// CATATAN AWAL (baca dulu):
// 1. Perlu verifikasi: cek versi SDK terbaru di dokumentasi Firebase,
//    lalu ubah konstanta SDK_VERSI di bawah jika perlu.
// 2. Tanpa Firebase Storage dan tanpa paket Blaze. Hanya Firestore
//    dan Authentication di paket gratis.
// 3. Konfigurasi Firebase Web boleh publik. Keamanan ada di
//    firestore.rules (baca publik, tulis hanya ADMIN_EMAIL).
// 4. Kuota baca/tulis Firestore harian paket gratis: Perlu verifikasi
//    di dokumentasi Firebase. Dibatasi dengan pagination 20 per halaman.
// 5. Kunci JAMENDO_CLIENT_ID akan terlihat di kode (wajar untuk client_id,
//    tapi kuotanya bisa terpakai orang lain). Pakai non-komersial.
// 6. ES module tidak jalan dari file://. Uji lewat server lokal
//    atau langsung deploy ke Vercel.
// 7. File ini memakai top-level await (didukung Chrome Android modern).
// =====================================================================

// ---------------------------------------------------------------------
// 1) KONSTANTA APLIKASI
// ---------------------------------------------------------------------
export const KODE_APP = 'AMX';
export const NAMA_APP = 'Asix Musix';

// Versi Firebase Web SDK (satu sumber untuk semua modul).
// Perlu verifikasi: cek versi SDK terbaru di dokumentasi Firebase.
export const SDK_VERSI = '10.12.2';

// Email admin (login Google). ISI dengan email admin asli.
// Nilai yang sama juga harus diisi di firestore.rules.
export const ADMIN_EMAIL = 'burger.kaisar@gmail.com';

// Client ID Jamendo (daftar di developer.jamendo.com). ISI dengan milik sendiri.
export const JAMENDO_CLIENT_ID = '529b9b2c';

// Alamat dasar Jamendo API v3.0.
// Perlu verifikasi: cek alamat dan nama parameter di developer.jamendo.com.
export const JAMENDO_API = 'https://api.jamendo.com/v3.0';

// Nama koleksi Firestore dan ukuran halaman (pagination).
export const KOLEKSI_LAGU = 'songs';
export const UKURAN_HALAMAN = 20;

// ---------------------------------------------------------------------
// 2) LOGO & ASET STATIS
// Taruh file asli di repo (folder assets/). Jangan hotlink Google Drive.
// Ikon PWA (192 dan 512) diambil dari logo yang sama.
// ---------------------------------------------------------------------
export const LOGO = {
  utama: 'assets/logo.png',
  ikon192: 'assets/icon-192.png',
  ikon512: 'assets/icon-512.png'
};

// ---------------------------------------------------------------------
// 3) DAFTAR PLAYLIST (8 chip di beranda)
// 'semua' = tanpa filter. id lainnya cocok dengan field `playlists`
// pada dokumen songs di Firestore.
// ---------------------------------------------------------------------
export const PLAYLISTS = [
  { id: 'semua', nama: 'Semua' },
  { id: 'fokus-tugas', nama: 'Fokus Tugas' },
  { id: 'cari-ide', nama: 'Cari Ide' },
  { id: 'istirahat', nama: 'Istirahat' },
  { id: 'gitar', nama: 'Gitar' },
  { id: 'piano', nama: 'Piano' },
  { id: 'gembira', nama: 'Gembira' },
  { id: 'santai', nama: 'Santai' }
];

// ---------------------------------------------------------------------
// 4) KONFIGURASI FIREBASE
// Isi dari Firebase Console -> Project settings -> Your apps -> Web app.
// Selama masih berawalan "ISI_", app berjalan di MODE PREVIEW
// (memakai data-contoh.json, tanpa memuat Firebase, tanpa error).
// ---------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyDga7qPE0VDDyqOiRgCliFUQJr97q-Flzs",
  authDomain: "asix-musix.firebaseapp.com",
  projectId: "asix-musix",
  storageBucket: "asix-musix.firebasestorage.app",
  messagingSenderId: "580029758411",
  appId: "1:580029758411:web:276ee33a5c09feceb9944e"
};

// ---------------------------------------------------------------------
// 5) PENANDA PLACEHOLDER (preview-safe)
// ---------------------------------------------------------------------
const masihPlaceholder = (nilai) =>
  typeof nilai === 'string' && nilai.includes('ISI_');

// true jika semua nilai firebaseConfig sudah diisi.
export const FIREBASE_SIAP = Object.values(firebaseConfig).every(
  (nilai) => !masihPlaceholder(nilai)
);

// true jika ADMIN_EMAIL sudah diisi.
export const ADMIN_SIAP = !masihPlaceholder(ADMIN_EMAIL);

// true jika JAMENDO_CLIENT_ID sudah diisi.
export const JAMENDO_SIAP = !masihPlaceholder(JAMENDO_CLIENT_ID);

// ---------------------------------------------------------------------
// 6) INISIALISASI FIREBASE (hanya jika konfigurasi sudah diisi)
//    app, db, auth : instance Firebase
//    fs            : modul firebase-firestore (collection, query, getDocs, dst.)
//    au            : modul firebase-auth (GoogleAuthProvider, signInWithPopup, dst.)
//    Modul lain memakai fs.xxx / au.xxx supaya versi SDK cukup di satu tempat.
// ---------------------------------------------------------------------
export let app = null;
export let db = null;
export let auth = null;
export let fs = null;
export let au = null;
export let ERROR_INIT = null;

if (FIREBASE_SIAP) {
  try {
    const dasar = `https://www.gstatic.com/firebasejs/${SDK_VERSI}`;
    const [modApp, modFirestore, modAuth] = await Promise.all([
      import(`${dasar}/firebase-app.js`),
      import(`${dasar}/firebase-firestore.js`),
      import(`${dasar}/firebase-auth.js`)
    ]);

    app = modApp.initializeApp(firebaseConfig);
    db = modFirestore.getFirestore(app);
    auth = modAuth.getAuth(app);
    fs = modFirestore;
    au = modAuth;
  } catch (err) {
    // Jika gagal memuat SDK (misalnya offline), app jatuh ke mode preview.
    ERROR_INIT = err;
    console.error('[AMX] Gagal inisialisasi Firebase:', err);
  }
}

// true jika Firebase TIDAK aktif -> UI memakai data-contoh.json
// dan fitur yang butuh Firebase (admin, impor) disembunyikan.
export const MODE_PREVIEW = !db;

// ---------------------------------------------------------------------
// 7) HELPER ADMIN
// Tombol admin hanya tampil untuk ADMIN_EMAIL. Penjagaan sebenarnya
// ada di firestore.rules, bukan di UI.
// ---------------------------------------------------------------------
export function adalahAdmin(email) {
  if (!ADMIN_SIAP || typeof email !== 'string') return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
}
