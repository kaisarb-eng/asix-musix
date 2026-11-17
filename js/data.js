// =====================================================================
// Asix Musix (AMX) - js/data.js (File 7)
// Memenuhi fitur: 2 (katalog + filter playlist, 20 per halaman),
// 10 (pencarian prefix judul/artis). Juga dipakai fitur 9 dan 15 (admin).
//
// CATATAN AWAL (baca dulu):
// 1. INDEKS KOMPOSIT WAJIB: koleksi songs -> playlists (array-contains)
//    + addedAt (menurun). Tanpa ini, filter playlist (selain "Semua")
//    gagal. Cara buat: jalankan app, pilih satu playlist, buka Console
//    browser (F12). Error Firestore berisi LINK; klik link itu lalu
//    "Create index" dan tunggu beberapa menit sampai statusnya Enabled.
// 2. Pencarian prefix pada titleLower dan artistLower memakai indeks
//    field tunggal otomatis (tidak perlu dibuat). Hanya cocok pada AWAL
//    judul/artis, bukan kata di tengah. Firestore tidak punya pencarian
//    teks penuh.
// 3. Hemat kuota: pagination (limit + startAfter), TANPA onSnapshot,
//    dan cache di memori (lagu dan daftar per playlist).
// 4. Preview-safe: jika MODE_PREVIEW (config belum diisi), semua data
//    diambil dari data-contoh.json tanpa menyentuh Firebase.
// 5. Perlu verifikasi: nama parameter Jamendo untuk ambil ulang audio
//    (id, audioformat) di developer.jamendo.com.
// =====================================================================

import {
  db, fs, MODE_PREVIEW, KOLEKSI_LAGU, UKURAN_HALAMAN, PLAYLISTS,
  JAMENDO_API, JAMENDO_CLIENT_ID, JAMENDO_SIAP
} from './firebase-config.js';

const ID_PLAYLIST_SAH = PLAYLISTS.filter((p) => p.id !== 'semua').map((p) => p.id);

// ---------------------------------------------------------------------
// 1) CACHE MEMORI
// ---------------------------------------------------------------------
const cacheLagu = new Map();   // id -> lagu
const cacheDaftar = new Map(); // id playlist -> { lagu[], kursor, habis, memuat }
let contohMemuat = null;       // janji pemuatan data-contoh.json

export function bersihkanCache() {
  cacheLagu.clear();
  cacheDaftar.clear();
}

// Ubah dokumen mentah jadi objek lagu rapi (+ simpan ke cache).
function normalisasi(id, data) {
  const lagu = {
    ...data,
    id,
    playlists: Array.isArray(data.playlists) ? data.playlists : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    duration: Number(data.duration) || 0,
    addedAtMs: data.addedAt && typeof data.addedAt.toMillis === 'function'
      ? data.addedAt.toMillis()
      : (Date.parse(data.addedAt) || 0)
  };
  cacheLagu.set(id, lagu);
  return lagu;
}

// ---------------------------------------------------------------------
// 2) MODE PREVIEW (data-contoh.json)
// ---------------------------------------------------------------------
async function muatContoh() {
  if (!contohMemuat) {
    contohMemuat = fetch('data-contoh.json')
      .then((res) => (res.ok ? res.json() : { songs: [] }))
      .then((json) => (Array.isArray(json.songs) ? json.songs.slice(0, 3) : []))
      .then((daftar) => daftar.map((d) => normalisasi(d.id, d)))
      .catch((err) => {
        console.error('[AMX] Gagal memuat data-contoh.json:', err);
        return [];
      });
  }
  return contohMemuat;
}

function adaAwalan(lagu, q) {
  return String(lagu.titleLower || '').startsWith(q) || String(lagu.artistLower || '').startsWith(q);
}

function perluFirestore() {
  if (MODE_PREVIEW || !db || !fs) throw new Error('Mode preview: Firebase belum aktif.');
}

// ---------------------------------------------------------------------
// 3) KATALOG PER PLAYLIST (fitur 2) - 20 per halaman, infinite scroll
// ---------------------------------------------------------------------
async function ambilHalaman(playlist, kursor) {
  if (MODE_PREVIEW) {
    const semua = await muatContoh();
    const disaring = playlist === 'semua' ? semua : semua.filter((l) => l.playlists.includes(playlist));
    const mulai = Number(kursor) || 0;
    const potong = disaring.slice(mulai, mulai + UKURAN_HALAMAN);
    const berikut = mulai + potong.length;
    return { lagu: potong, kursorBaru: berikut, habis: berikut >= disaring.length };
  }
  const batas = [fs.orderBy('addedAt', 'desc'), fs.limit(UKURAN_HALAMAN)];
  if (kursor) batas.push(fs.startAfter(kursor));
  const syarat = playlist === 'semua' ? [] : [fs.where('playlists', 'array-contains', playlist)];
  const snap = await fs.getDocs(fs.query(fs.collection(db, KOLEKSI_LAGU), ...syarat, ...batas));
  const lagu = snap.docs.map((d) => normalisasi(d.id, d.data()));
  return {
    lagu,
    kursorBaru: snap.docs.length ? snap.docs[snap.docs.length - 1] : kursor,
    habis: snap.size < UKURAN_HALAMAN
  };
}

// Muat halaman berikutnya untuk playlist. Mengembalikan { baru, habis }.
// Aman dipanggil berulang saat scroll (panggilan ganda digabung).
export function muatBerikutnya(playlist = 'semua') {
  let st = cacheDaftar.get(playlist);
  if (!st) {
    st = { lagu: [], kursor: null, habis: false, memuat: null };
    cacheDaftar.set(playlist, st);
  }
  if (st.habis) return Promise.resolve({ baru: [], habis: true });
  if (st.memuat) return st.memuat;
  st.memuat = (async () => {
    try {
      const hasil = await ambilHalaman(playlist, st.kursor);
      st.kursor = hasil.kursorBaru;
      st.habis = hasil.habis;
      st.lagu.push(...hasil.lagu);
      return { baru: hasil.lagu, habis: st.habis };
    } finally {
      st.memuat = null;
    }
  })();
  return st.memuat;
}

// Semua lagu playlist yang sudah termuat (urutan tampil). Dipakai untuk antrean.
export function daftarTermuat(playlist = 'semua') {
  const st = cacheDaftar.get(playlist);
  return st ? [...st.lagu] : [];
}

export function playlistSudahAdaCache(playlist = 'semua') {
  return cacheDaftar.has(playlist);
}

// Ambil satu lagu berdasarkan ID (cache dulu, baru Firestore).
export async function ambilLagu(id) {
  if (cacheLagu.has(id)) return cacheLagu.get(id);
  if (MODE_PREVIEW) {
    await muatContoh();
    return cacheLagu.get(id) || null;
  }
  const snap = await fs.getDoc(fs.doc(db, KOLEKSI_LAGU, id));
  return snap.exists() ? normalisasi(snap.id, snap.data()) : null;
}

// ---------------------------------------------------------------------
// 4) PENCARIAN PREFIX (fitur 10) - dua query digabung, hasil bertahap
// ---------------------------------------------------------------------
function rapikanKata(kata) {
  return String(kata || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

async function halamanPrefix(bidang, q, kursor) {
  if (MODE_PREVIEW) {
    const semua = (await muatContoh()).filter((l) => String(l[bidang] || '').startsWith(q));
    const mulai = Number(kursor) || 0;
    const potong = semua.slice(mulai, mulai + UKURAN_HALAMAN);
    return { lagu: potong, kursorBaru: mulai + potong.length, habis: mulai + potong.length >= semua.length };
  }
  const batas = [
    fs.where(bidang, '>=', q),
    fs.where(bidang, '<=', q + '\uf8ff'),
    fs.orderBy(bidang),
    fs.limit(UKURAN_HALAMAN)
  ];
  if (kursor) batas.push(fs.startAfter(kursor));
  const snap = await fs.getDocs(fs.query(fs.collection(db, KOLEKSI_LAGU), ...batas));
  return {
    lagu: snap.docs.map((d) => normalisasi(d.id, d.data())),
    kursorBaru: snap.docs.length ? snap.docs[snap.docs.length - 1] : kursor,
    habis: snap.size < UKURAN_HALAMAN
  };
}

// Buka pencarian baru. Pakai: const p = bukaPencarian('piano'); await p.berikutnya();
export function bukaPencarian(kata) {
  const q = rapikanKata(kata);
  const sudahAda = new Set();
  const sumber = ['titleLower', 'artistLower'].map((bidang) => ({ bidang, kursor: null, habis: false }));
  return {
    kata: q,
    async berikutnya() {
      if (!q) return { lagu: [], habis: true };
      const kumpulan = [];
      await Promise.all(sumber.filter((s) => !s.habis).map(async (s) => {
        const h = await halamanPrefix(s.bidang, q, s.kursor);
        s.kursor = h.kursorBaru;
        s.habis = h.habis;
        kumpulan.push(...h.lagu);
      }));
      const baru = kumpulan
        .filter((l) => !sudahAda.has(l.id) && sudahAda.add(l.id))
        .sort((a, b) => String(a.titleLower).localeCompare(String(b.titleLower)));
      return { lagu: baru, habis: sumber.every((s) => s.habis) };
    }
  };
}

// ---------------------------------------------------------------------
// 5) FILTER FAVORIT (fitur 11) - ambil lagu berdasarkan daftar ID
// ---------------------------------------------------------------------
// ids dari local-store.daftarFavorit(). Yang terbaru ditampilkan dulu.
// Lagu yang sudah dihapus admin dilewati.
export function bukaFavorit(ids) {
  const urut = [...ids].reverse();
  let posisi = 0;
  return {
    async berikutnya() {
      const potong = urut.slice(posisi, posisi + UKURAN_HALAMAN);
      posisi += potong.length;
      const hasil = await Promise.all(potong.map((id) => ambilLagu(id).catch(() => null)));
      return { lagu: hasil.filter(Boolean), habis: posisi >= urut.length };
    }
  };
}

// ---------------------------------------------------------------------
// 6) ADMIN: UBAH, HAPUS, SIMPAN (fitur 9 dan 15)
//    Keamanan sebenarnya ada di firestore.rules (tulis hanya ADMIN_EMAIL).
//    Optimistic UI: cache lokal diperbarui, tanpa ambil ulang koleksi.
// ---------------------------------------------------------------------
function rapikanTags(tags) {
  return [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
    .map((t) => t.slice(0, 40)).slice(0, 20);
}

// Ubah playlist dan tag sebuah lagu.
export async function ubahLagu(id, { playlists, tags }) {
  perluFirestore();
  const dataBaru = {
    playlists: (playlists || []).filter((p) => ID_PLAYLIST_SAH.includes(p)),
    tags: rapikanTags(tags)
  };
  await fs.updateDoc(fs.doc(db, KOLEKSI_LAGU, id), dataBaru);
  const lama = cacheLagu.get(id);
  const baru = lama ? { ...lama, ...dataBaru } : null;
  if (baru) {
    cacheLagu.set(id, baru);
    const st = cacheDaftar.get('semua');
    if (st) st.lagu = st.lagu.map((l) => (l.id === id ? baru : l));
  }
  // Daftar playlist lain bisa berubah isinya: buang cache-nya, dimuat ulang saat dibuka.
  [...cacheDaftar.keys()].filter((k) => k !== 'semua').forEach((k) => cacheDaftar.delete(k));
  return baru;
}

// Hapus lagu dari katalog.
export async function hapusLagu(id) {
  perluFirestore();
  await fs.deleteDoc(fs.doc(db, KOLEKSI_LAGU, id));
  cacheLagu.delete(id);
  cacheDaftar.forEach((st) => { st.lagu = st.lagu.filter((l) => l.id !== id); });
}

// Simpan lagu hasil impor Jamendo. ID dokumen jm_{jamendoId} mencegah duplikat.
// Mengembalikan { status: 'baru' | 'sudah-ada', lagu }.
export async function simpanLagu(lagu, emailAdmin) {
  perluFirestore();
  const id = `jm_${lagu.jamendoId}`;
  const ref = fs.doc(db, KOLEKSI_LAGU, id);
  if ((await fs.getDoc(ref)).exists()) return { status: 'sudah-ada', lagu: cacheLagu.get(id) || null };
  const dokumen = {
    title: String(lagu.title || '').slice(0, 200),
    artist: String(lagu.artist || '').slice(0, 200),
    titleLower: String(lagu.title || '').toLowerCase().slice(0, 200),
    artistLower: String(lagu.artist || '').toLowerCase().slice(0, 200),
    coverUrl: String(lagu.coverUrl || ''),
    jamendoId: String(lagu.jamendoId),
    audioUrl: String(lagu.audioUrl || ''),
    duration: Number(lagu.duration) || 0,
    playlists: (lagu.playlists || []).filter((p) => ID_PLAYLIST_SAH.includes(p)),
    tags: rapikanTags(lagu.tags),
    license: String(lagu.license || ''),
    licenseUrl: String(lagu.licenseUrl || ''),
    source: 'Jamendo',
    sourceUrl: String(lagu.sourceUrl || ''),
    addedAt: fs.serverTimestamp(),
    addedBy: String(emailAdmin || '')
  };
  await fs.setDoc(ref, dokumen);
  // Optimistic UI: tampilkan di daftar yang sudah termuat tanpa ambil ulang.
  const lokal = normalisasi(id, { ...dokumen, addedAt: new Date().toISOString() });
  cacheDaftar.forEach((st, kunci) => {
    if (kunci === 'semua' || lokal.playlists.includes(kunci)) st.lagu.unshift(lokal);
  });
  return { status: 'baru', lagu: lokal };
}

// ---------------------------------------------------------------------
// 7) AUDIO GAGAL DIMUAT: ambil ulang URL lewat jamendoId
//    Perlu verifikasi: apakah URL audio Jamendo stabil atau kedaluwarsa,
//    dan nama parameter (id, audioformat) di developer.jamendo.com.
// ---------------------------------------------------------------------
export async function ambilUrlAudioBaru(lagu) {
  if (!JAMENDO_SIAP || !lagu || !lagu.jamendoId) return null;
  const url = `${JAMENDO_API}/tracks/?client_id=${encodeURIComponent(JAMENDO_CLIENT_ID)}`
    + `&format=json&id=${encodeURIComponent(lagu.jamendoId)}&audioformat=mp32`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const audio = json && json.results && json.results[0] && json.results[0].audio;
    return typeof audio === 'string' && audio ? audio : null;
  } catch (err) {
    console.error('[AMX] Gagal mengambil ulang URL audio:', err);
    return null;
  }
}

// Simpan URL audio baru di memori. Ke Firestore hanya jika simpanKeFirestore = true
// (dipanggil player.js hanya untuk admin; non-admin cukup pakai di memori).
export async function perbaruiUrlAudio(id, urlBaru, simpanKeFirestore = false) {
  const lama = cacheLagu.get(id);
  if (lama) cacheLagu.set(id, { ...lama, audioUrl: urlBaru });
  cacheDaftar.forEach((st) => {
    st.lagu = st.lagu.map((l) => (l.id === id ? { ...l, audioUrl: urlBaru } : l));
  });
  if (!simpanKeFirestore || MODE_PREVIEW) return false;
  try {
    await fs.updateDoc(fs.doc(db, KOLEKSI_LAGU, id), { audioUrl: urlBaru });
    return true;
  } catch (err) {
    console.error('[AMX] Gagal memperbarui audioUrl di Firestore:', err);
    return false;
  }
}
