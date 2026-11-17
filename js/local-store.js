// =====================================================================
// Asix Musix (AMX) - js/local-store.js (File 6)
// Memenuhi fitur: 5 (shuffle diingat), 6 (volume diingat),
// 11 (favorit), 12 (lanjut lagu terakhir).
//
// Semua data disimpan di HP (localStorage, awalan amx_) dan hilang jika
// data browser dibersihkan. Tidak ada yang dikirim ke Firestore.
//
// CATATAN:
// 1. Setiap baca/tulis dibungkus try/catch. Jika localStorage diblokir
//    atau penuh, data disimpan sementara di memori (hilang saat app ditutup).
// 2. Favorit hanya menyimpan ID lagu (contoh jm_123456). Untuk filter
//    Favorit, js/data.js mengambil dokumen lagunya berdasarkan ID itu.
//    Urutan daftarFavorit(): yang terlama di depan, yang terbaru di belakang.
// 3. Lagu terakhir menyimpan ringkasan data lagu (bukan hanya ID) supaya
//    mini player bisa tampil langsung tanpa menunggu Firestore.
// =====================================================================

export const KUNCI = {
  favorit: 'amx_favorit',
  terakhir: 'amx_terakhir',
  pengaturan: 'amx_pengaturan'
};

const BATAS_FAVORIT = 500;
const BAWAAN_PENGATURAN = { volume: 0.8, shuffle: false };

// Field lagu yang disimpan pada "lagu terakhir" (cukup untuk mini player & Now Playing).
const BIDANG_LAGU = [
  'id', 'title', 'artist', 'coverUrl', 'audioUrl', 'duration', 'jamendoId',
  'license', 'licenseUrl', 'source', 'sourceUrl'
];

// ---------------------------------------------------------------------
// 1) PENYIMPANAN DASAR (aman dari error)
// ---------------------------------------------------------------------
const cadangan = new Map(); // dipakai jika localStorage tidak bisa dipakai
let tersedia = true;
try {
  localStorage.setItem('amx_uji', '1');
  localStorage.removeItem('amx_uji');
} catch (err) {
  tersedia = false;
}

export const PENYIMPANAN_TERSEDIA = tersedia;

function baca(kunci, bawaan) {
  try {
    const mentah = (tersedia ? localStorage.getItem(kunci) : null) ?? cadangan.get(kunci);
    return mentah ? JSON.parse(mentah) : bawaan;
  } catch (err) {
    return bawaan;
  }
}

function tulis(kunci, nilai) {
  const teks = JSON.stringify(nilai);
  try {
    if (!tersedia) throw new Error('localStorage tidak tersedia');
    localStorage.setItem(kunci, teks);
    cadangan.delete(kunci);
    return true;
  } catch (err) {
    cadangan.set(kunci, teks);
    return false;
  }
}

function hapus(kunci) {
  cadangan.delete(kunci);
  try {
    if (tersedia) localStorage.removeItem(kunci);
  } catch (err) {
    // diabaikan
  }
}

// ---------------------------------------------------------------------
// 2) FAVORIT (fitur 11) - amx_favorit: daftar ID lagu
// ---------------------------------------------------------------------
let himpunanFavorit = null;
const pemantau = new Set();

function muatFavorit() {
  if (!himpunanFavorit) {
    const data = baca(KUNCI.favorit, []);
    const bersih = Array.isArray(data) ? data.filter((id) => typeof id === 'string') : [];
    himpunanFavorit = new Set(bersih);
  }
  return himpunanFavorit;
}

// Daftar ID favorit (terlama di depan, terbaru di belakang).
export function daftarFavorit() {
  return [...muatFavorit()];
}

export function adalahFavorit(id) {
  return muatFavorit().has(id);
}

// Nyalakan/matikan favorit. Mengembalikan true jika sekarang menjadi favorit.
export function toggleFavorit(id) {
  if (typeof id !== 'string' || !id) return false;
  const himpunan = muatFavorit();
  let aktif;
  if (himpunan.has(id)) {
    himpunan.delete(id);
    aktif = false;
  } else {
    if (himpunan.size >= BATAS_FAVORIT) {
      himpunan.delete(himpunan.values().next().value); // buang yang terlama
    }
    himpunan.add(id);
    aktif = true;
  }
  tulis(KUNCI.favorit, [...himpunan]);
  pemantau.forEach((fn) => {
    try {
      fn(id, aktif);
    } catch (err) {
      console.error('[AMX] Pemantau favorit error:', err);
    }
  });
  return aktif;
}

// Daftarkan fungsi yang dipanggil tiap favorit berubah: fn(id, aktif).
// Mengembalikan fungsi untuk berhenti memantau.
export function pantauFavorit(fn) {
  pemantau.add(fn);
  return () => pemantau.delete(fn);
}

// ---------------------------------------------------------------------
// 3) LAGU TERAKHIR (fitur 12) - amx_terakhir: lagu, posisi detik, playlist
// ---------------------------------------------------------------------
export function simpanTerakhir(lagu, posisi, playlist) {
  if (!lagu || typeof lagu.id !== 'string') return false;
  const ringkas = {};
  BIDANG_LAGU.forEach((bidang) => {
    if (lagu[bidang] !== undefined) ringkas[bidang] = lagu[bidang];
  });
  return tulis(KUNCI.terakhir, {
    lagu: ringkas,
    posisi: Math.max(0, Math.floor(Number(posisi) || 0)),
    playlist: typeof playlist === 'string' && playlist ? playlist : 'semua'
  });
}

// Mengembalikan { lagu, posisi, playlist } atau null jika belum ada / rusak.
export function ambilTerakhir() {
  const data = baca(KUNCI.terakhir, null);
  if (!data || typeof data !== 'object' || !data.lagu) return null;
  if (typeof data.lagu.id !== 'string' || typeof data.lagu.title !== 'string') return null;
  return {
    lagu: data.lagu,
    posisi: Math.max(0, Math.floor(Number(data.posisi) || 0)),
    playlist: typeof data.playlist === 'string' && data.playlist ? data.playlist : 'semua'
  };
}

export function hapusTerakhir() {
  hapus(KUNCI.terakhir);
}

// ---------------------------------------------------------------------
// 4) PENGATURAN (fitur 5 dan 6) - amx_pengaturan: volume (0-1), shuffle
// ---------------------------------------------------------------------
export function ambilPengaturan() {
  const data = baca(KUNCI.pengaturan, {});
  const sumber = data && typeof data === 'object' ? data : {};
  const volume = Number(sumber.volume);
  return {
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : BAWAAN_PENGATURAN.volume,
    shuffle: sumber.shuffle === true
  };
}

// Ubah sebagian pengaturan, contoh: simpanPengaturan({ volume: 0.5 }).
export function simpanPengaturan(sebagian) {
  const baru = { ...ambilPengaturan(), ...(sebagian || {}) };
  const volume = Number(baru.volume);
  baru.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : BAWAAN_PENGATURAN.volume;
  baru.shuffle = baru.shuffle === true;
  tulis(KUNCI.pengaturan, baru);
  return baru;
}
