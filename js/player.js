// =====================================================================
// Asix Musix (AMX) - js/player.js (File 8)
// Memenuhi fitur: 1 (kontrol + auto-next), 4 (MediaSession), 5 (shuffle),
// 6 (volume diingat), 8 (seek + waktu). Juga menyimpan lagu terakhir (fitur 12).
//
// CATATAN AWAL (baca dulu):
// 1. Modul ini TIDAK menyentuh tampilan. js/ui.js memantau perubahan lewat
//    pantau(fn), lalu fn(jenis, data) menerima jenis berikut:
//      'lagu'          data = lagu yang sedang aktif (atau null)
//      'status'        data = 'main' | 'jeda'
//      'waktu'         data = { posisi, durasi } (detik)
//      'antrean'       data = { sedang, berikutnya[], total }
//      'acak'          data = true | false
//      'volume'        data = 0..1
//      'pesan'         data = teks untuk toast
//      'hampir-habis'  antrean tinggal sedikit; app.js boleh memuat halaman
//                      berikutnya lalu memanggil sambungAntrean(laguBaru)
// 2. Aturan: lagu habis -> lanjut otomatis. Lagu terakhir di antrean ->
//    berhenti dan kembali ke awal. Prev setelah detik ke-3 mengulang lagu
//    itu; sebelum detik ke-3 pindah ke lagu sebelumnya.
// 3. Perlu verifikasi: pemutaran saat layar terkunci dan tombol di
//    notifikasi Android harus dites di HP user.
// 4. Audio gagal dimuat -> coba ambil ulang URL lewat jamendoId (data.js),
//    maksimal 1x per lagu. Jika tetap gagal, lompat ke lagu berikutnya
//    (maksimal 3 kegagalan beruntun).
// =====================================================================

import { MODE_PREVIEW, LOGO } from './firebase-config.js';
import { ambilUrlAudioBaru, perbaruiUrlAudio } from './data.js';
import { ambilPengaturan, simpanPengaturan, simpanTerakhir, ambilTerakhir } from './local-store.js';

const AMBANG_ULANG = 3;       // detik: prev di bawah ini = lagu sebelumnya
const JEDA_SIMPAN = 5000;     // ms: simpan posisi lagu terakhir
const BATAS_GAGAL = 3;        // kegagalan beruntun sebelum berhenti

let audio = null;
let asli = [];                // urutan asli antrean
let daftar = [];              // urutan putar (bisa diacak)
let indeks = -1;
let laguAktif = null;
let playlistAktif = 'semua';
let acak = false;
let status = 'jeda';
let posisiTunda = 0;          // posisi yang diterapkan setelah metadata dimuat
let sudahCobaUlang = false;
let gagalBeruntun = 0;
let adminAktif = false;
let terakhirSimpan = 0;
let sudahMulai = false;

// ---------------------------------------------------------------------
// 1) PEMANTAU (event sederhana)
// ---------------------------------------------------------------------
const pemirsa = new Set();

export function pantau(fn) {
  pemirsa.add(fn);
  return () => pemirsa.delete(fn);
}

function pancar(jenis, data) {
  pemirsa.forEach((fn) => {
    try {
      fn(jenis, data);
    } catch (err) {
      console.error('[AMX] Pemantau pemutar error:', err);
    }
  });
}

// ---------------------------------------------------------------------
// 2) PEMBANTU
// ---------------------------------------------------------------------
export function formatWaktu(detik) {
  const total = Math.max(0, Math.floor(Number(detik) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function posisiSaatIni() {
  return posisiTunda > 0 ? posisiTunda : (audio && audio.currentTime) || 0;
}

function durasiSaatIni() {
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return (laguAktif && Number(laguAktif.duration)) || 0;
}

function acakDaftar(larik) {
  const hasil = [...larik];
  for (let i = hasil.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hasil[i], hasil[j]] = [hasil[j], hasil[i]];
  }
  return hasil;
}

function pancarAntrean() {
  pancar('antrean', ambilAntrean());
}

function gantiLaguDiAntrean(lagu) {
  asli = asli.map((l) => (l.id === lagu.id ? lagu : l));
  daftar = daftar.map((l) => (l.id === lagu.id ? lagu : l));
}

function simpanPosisi(paksa = false) {
  if (!laguAktif) return;
  const sekarang = Date.now();
  if (!paksa && sekarang - terakhirSimpan < JEDA_SIMPAN) return;
  terakhirSimpan = sekarang;
  simpanTerakhir(laguAktif, posisiSaatIni(), playlistAktif);
}

// ---------------------------------------------------------------------
// 3) MEDIASESSION (fitur 4)
// ---------------------------------------------------------------------
function perbaruiMediaSession(lagu) {
  if (!('mediaSession' in navigator)) return;
  try {
    const sampul = lagu.coverUrl
      ? [{ src: lagu.coverUrl, sizes: '512x512' }]
      : [{ src: new URL(LOGO.ikon512, location.href).href, sizes: '512x512', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: lagu.title || '',
      artist: lagu.artist || '',
      album: 'Asix Musix',
      artwork: sampul
    });
  } catch (err) {
    console.error('[AMX] MediaSession metadata gagal:', err);
  }
}

function perbaruiPosisiMedia() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const durasi = durasiSaatIni();
  if (!Number.isFinite(durasi) || durasi <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: durasi,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(posisiSaatIni(), durasi)
    });
  } catch (err) {
    // diabaikan: beberapa browser menolak nilai tertentu
  }
}

function aturMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const aksi = {
    play: () => main(),
    pause: () => jeda(),
    previoustrack: () => sebelumnya(),
    nexttrack: () => berikutnya(),
    seekto: (d) => { if (d && typeof d.seekTime === 'number') geserKe(d.seekTime); }
  };
  Object.entries(aksi).forEach(([nama, fn]) => {
    try {
      navigator.mediaSession.setActionHandler(nama, fn);
    } catch (err) {
      // aksi tidak didukung browser ini
    }
  });
}

// ---------------------------------------------------------------------
// 4) MEMUAT & MEMUTAR LAGU
// ---------------------------------------------------------------------
async function mainAudio() {
  try {
    await audio.play();
  } catch (err) {
    if (err.name === 'NotAllowedError') pancar('pesan', 'Ketuk tombol putar untuk memulai.');
    else if (err.name !== 'AbortError') console.error('[AMX] Gagal memutar:', err);
  }
}

function pesanTanpaAudio() {
  return MODE_PREVIEW ? 'Mode preview: audio belum tersedia.' : 'Audio lagu ini belum tersedia.';
}

function muatLagu(lagu, { putar = true, posisi = 0 } = {}) {
  simpanPosisi(true);
  laguAktif = lagu;
  posisiTunda = posisi;
  sudahCobaUlang = false;
  if (lagu.audioUrl) {
    audio.src = lagu.audioUrl;
  } else {
    audio.removeAttribute('src');
    audio.load();
  }
  perbaruiMediaSession(lagu);
  pancar('lagu', lagu);
  pancarAntrean();
  pancar('waktu', { posisi: posisiSaatIni(), durasi: durasiSaatIni() });
  if (daftar.length - indeks <= 3) pancar('hampir-habis', null);
  if (!lagu.audioUrl) {
    status = 'jeda';
    pancar('status', status);
    if (putar) pancar('pesan', pesanTanpaAudio());
    return;
  }
  if (putar) mainAudio();
  simpanPosisi(true);
}

// ---------------------------------------------------------------------
// 5) KONTROL (fitur 1)
// ---------------------------------------------------------------------
export function main() {
  if (!laguAktif) return;
  if (!audio.getAttribute('src')) {
    pancar('pesan', pesanTanpaAudio());
    return;
  }
  mainAudio();
}

export function jeda() {
  if (audio) audio.pause();
}

export function toggleMain() {
  if (status === 'main') jeda();
  else main();
}

function berhentiDiAkhir() {
  audio.pause();
  posisiTunda = 0;
  try { audio.currentTime = 0; } catch (err) { /* belum ada metadata */ }
  status = 'jeda';
  pancar('status', status);
  pancar('waktu', { posisi: 0, durasi: durasiSaatIni() });
  simpanPosisi(true);
}

export function berikutnya() {
  if (indeks + 1 < daftar.length) {
    indeks += 1;
    muatLagu(daftar[indeks]);
  } else if (laguAktif) {
    berhentiDiAkhir(); // lagu terakhir: berhenti
  }
}

export function sebelumnya() {
  if (!laguAktif) return;
  if (posisiSaatIni() > AMBANG_ULANG || indeks <= 0) {
    geserKe(0);
    return;
  }
  indeks -= 1;
  muatLagu(daftar[indeks]);
}

export function geserKe(detik) {
  if (!audio || !laguAktif) return;
  const durasi = durasiSaatIni();
  let tujuan = Math.max(0, Number(detik) || 0);
  if (durasi > 0) tujuan = Math.min(tujuan, durasi);
  if (audio.readyState > 0) {
    audio.currentTime = tujuan;
    posisiTunda = 0;
  } else {
    posisiTunda = tujuan;
  }
  pancar('waktu', { posisi: tujuan, durasi });
  perbaruiPosisiMedia();
}

// ---------------------------------------------------------------------
// 6) ANTREAN & SHUFFLE (fitur 5)
// ---------------------------------------------------------------------
export function ambilAntrean() {
  return {
    sedang: laguAktif,
    berikutnya: indeks >= 0 ? daftar.slice(indeks + 1) : [],
    total: daftar.length
  };
}

// Mulai memutar dari daftar (contoh: lagu yang tampil di beranda).
// id = lagu yang diketuk. Jika acak menyala, lagu lain diacak.
export function putarDariDaftar(daftarLagu, id, playlist = 'semua') {
  const awal = daftarLagu.find((l) => l.id === id);
  if (!awal) return;
  playlistAktif = playlist;
  asli = [...daftarLagu];
  if (acak) {
    daftar = [awal, ...acakDaftar(asli.filter((l) => l.id !== id))];
    indeks = 0;
  } else {
    daftar = [...asli];
    indeks = daftar.findIndex((l) => l.id === id);
  }
  muatLagu(awal);
}

// Putar lagu pada posisi tertentu di urutan putar (ketuk item di Antrean).
export function putarAntrean(i) {
  if (i < 0 || i >= daftar.length) return;
  indeks = i;
  muatLagu(daftar[indeks]);
}

// Tambah lagu baru ke ujung antrean (misalnya halaman berikutnya dari katalog).
export function sambungAntrean(laguBaru) {
  const ada = new Set(asli.map((l) => l.id));
  const tambahan = laguBaru.filter((l) => !ada.has(l.id));
  if (!tambahan.length) return;
  asli.push(...tambahan);
  daftar.push(...(acak ? acakDaftar(tambahan) : tambahan));
  pancarAntrean();
}

export function setAcak(nyala) {
  acak = Boolean(nyala);
  simpanPengaturan({ shuffle: acak });
  if (laguAktif && daftar.length) {
    if (acak) {
      // Yang sudah diputar tetap di depan, sisanya diacak.
      const sudahDiputar = daftar.slice(0, indeks + 1);
      const id = new Set(sudahDiputar.map((l) => l.id));
      daftar = [...sudahDiputar, ...acakDaftar(asli.filter((l) => !id.has(l.id)))];
    } else {
      daftar = [...asli];
      indeks = Math.max(0, daftar.findIndex((l) => l.id === laguAktif.id));
    }
  }
  pancar('acak', acak);
  pancarAntrean();
}

export function toggleAcak() {
  setAcak(!acak);
  return acak;
}

// ---------------------------------------------------------------------
// 7) VOLUME (fitur 6)
// ---------------------------------------------------------------------
export function setVolume(nilai) {
  const v = Math.min(1, Math.max(0, Number(nilai)));
  if (!Number.isFinite(v)) return;
  audio.volume = v;
  simpanPengaturan({ volume: v });
  pancar('volume', v);
}

// ---------------------------------------------------------------------
// 8) STATUS, PEMULIHAN, ADMIN
// ---------------------------------------------------------------------
export function ambilStatus() {
  return {
    lagu: laguAktif,
    status,
    posisi: posisiSaatIni(),
    durasi: durasiSaatIni(),
    acak,
    volume: audio ? audio.volume : ambilPengaturan().volume,
    indeks,
    total: daftar.length,
    playlist: playlistAktif
  };
}

// Fitur 12: isi mini player dengan lagu terakhir dalam keadaan jeda.
export function pulihkanTerakhir() {
  const data = ambilTerakhir();
  if (!data) return false;
  playlistAktif = data.playlist;
  asli = [data.lagu];
  daftar = [data.lagu];
  indeks = 0;
  muatLagu(data.lagu, { putar: false, posisi: data.posisi });
  return true;
}

// Dipanggil app.js/admin.js: hanya admin yang boleh menyimpan URL audio baru ke Firestore.
export function aturAdmin(ya) {
  adminAktif = Boolean(ya);
}

// ---------------------------------------------------------------------
// 9) INISIALISASI (panggil sekali dari app.js)
// ---------------------------------------------------------------------
export function mulaiPemutar() {
  if (sudahMulai) return;
  audio = document.getElementById('audio');
  if (!audio) {
    console.error('[AMX] Elemen #audio tidak ditemukan di index.html.');
    return;
  }
  sudahMulai = true;

  const pengaturan = ambilPengaturan();
  audio.volume = pengaturan.volume;
  acak = pengaturan.shuffle;
  pancar('volume', audio.volume);
  pancar('acak', acak);

  audio.addEventListener('play', () => {
    status = 'main';
    pancar('status', status);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    perbaruiPosisiMedia();
  });

  audio.addEventListener('pause', () => {
    // 'pause' juga muncul sesaat sebelum 'ended'; abaikan.
    if (audio.ended) return;
    status = 'jeda';
    pancar('status', status);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    simpanPosisi(true);
    perbaruiPosisiMedia();
  });

  audio.addEventListener('playing', () => {
    gagalBeruntun = 0;
  });

  audio.addEventListener('ended', () => berikutnya());

  audio.addEventListener('loadedmetadata', () => {
    if (posisiTunda > 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(posisiTunda, Math.max(0, audio.duration - 1));
    }
    posisiTunda = 0;
    pancar('waktu', { posisi: audio.currentTime, durasi: durasiSaatIni() });
    perbaruiPosisiMedia();
  });

  audio.addEventListener('timeupdate', () => {
    pancar('waktu', { posisi: audio.currentTime, durasi: durasiSaatIni() });
    simpanPosisi(false);
  });

  audio.addEventListener('durationchange', () => {
    pancar('waktu', { posisi: posisiSaatIni(), durasi: durasiSaatIni() });
  });

  audio.addEventListener('seeked', perbaruiPosisiMedia);

  audio.addEventListener('error', async () => {
    const lagu = laguAktif;
    if (!lagu || !audio.getAttribute('src')) return;

    // Langkah 1: ambil ulang URL audio lewat jamendoId (maksimal 1x per lagu).
    if (!sudahCobaUlang) {
      sudahCobaUlang = true;
      const urlBaru = await ambilUrlAudioBaru(lagu);
      if (laguAktif !== lagu) return; // pengguna sudah pindah lagu
      if (urlBaru && urlBaru !== lagu.audioUrl) {
        await perbaruiUrlAudio(lagu.id, urlBaru, adminAktif);
        const diperbarui = { ...lagu, audioUrl: urlBaru };
        gantiLaguDiAntrean(diperbarui);
        laguAktif = diperbarui;
        posisiTunda = audio.currentTime || posisiTunda;
        audio.src = urlBaru;
        mainAudio();
        return;
      }
    }

    // Langkah 2: tetap gagal -> beri tahu, lalu coba lagu berikutnya.
    gagalBeruntun += 1;
    status = 'jeda';
    pancar('status', status);
    pancar('pesan', 'Lagu gagal diputar.');
    if (gagalBeruntun < BATAS_GAGAL && indeks + 1 < daftar.length) berikutnya();
  });

  // Simpan posisi saat app disembunyikan/ditutup.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') simpanPosisi(true);
  });
  window.addEventListener('pagehide', () => simpanPosisi(true));

  aturMediaSession();
}
