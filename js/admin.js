// js/admin.js — Layar admin: login Google, kelola lagu (edit/hapus), impor lagu dari Jamendo
// Dipasang dari app.js lewat mulaiAdmin().
//
// Catatan kuota Firestore: daftar Kelola memakai cache dari data.js (lagu yang sudah dimuat
// di beranda tidak dibaca ulang). Impor 20 lagu = sekitar 20-40 operasi, jauh di bawah kuota harian gratis.
// Pencarian Jamendo tidak memakai Firestore sama sekali.

import {
  ADMIN_SIAP, FIREBASE_SIAP, MODE_PREVIEW, PLAYLISTS,
  JAMENDO_API, JAMENDO_CLIENT_ID, JAMENDO_SIAP,
  auth, au, adalahAdmin,
} from './firebase-config.js';
import { muatBerikutnya, daftarTermuat, ubahLagu, hapusLagu, simpanLagu } from './data.js';
import { aturAdmin, jeda } from './player.js';
import { tampilToast, bukaModal, tutupModal, muatUlangBeranda, isiCover } from './ui.js';

const JUMLAH_HASIL = 20;
const MAKS_TAG = 10;

// ---------- Status ----------
let adminAktif = false;
let emailAdmin = '';
let kelolaDimuat = false;
let kelolaHabis = false;
let sedangMuat = false;
let sedangCari = false;
let sedangSimpan = false;

const petaLagu = new Map();   // id lagu -> objek lagu (untuk daftar Kelola)
const idTampil = new Set();   // id lagu yang sudah ada barisnya di daftar Kelola
let barisImpor = [];          // hasil pencarian Jamendo: [{ akar, cek, lagu, tombol }]
let resolverKonfirmasi = null;

const el = (id) => document.getElementById(id);

// ---------- Helper umum ----------
function tampil(id, ya) {
  const e = el(id);
  if (e) e.classList.toggle('hidden', !ya);
}

function isiTeks(id, teks) {
  const e = el(id);
  if (e) e.textContent = teks;
}

function urlHttps(u) {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' ? x.href : '';
  } catch (e) {
    return '';
  }
}

function bagian(akar, nama) {
  const sel = '[data-f="' + nama + '"]';
  return akar.matches(sel) ? akar : akar.querySelector(sel);
}

function klonTemplate(idTpl) {
  const t = el(idTpl);
  if (!t || !t.content || !t.content.firstElementChild) return null;
  return t.content.firstElementChild.cloneNode(true);
}

function namaPlaylist(id) {
  const p = PLAYLISTS.find((x) => x.id === id);
  return p ? p.nama : id;
}

function pesanError(e) {
  const kode = e && e.code ? String(e.code) : '';
  if (kode.includes('permission-denied')) return 'Ditolak oleh aturan Firestore. Pastikan login pakai email admin dan rules sudah dipublish.';
  if (kode.includes('unavailable') || (e && e.name === 'AbortError')) return 'Koneksi bermasalah. Coba lagi sebentar.';
  if (kode.includes('failed-precondition')) return 'Firestore butuh indeks. Buka Console dan klik link indeks di pesan error.';
  return (e && e.message) ? String(e.message).slice(0, 140) : 'Terjadi kesalahan. Coba lagi.';
}

// ---------- Modal (pembungkus aman) ----------
// Perlu verifikasi: bentuk argumen bukaModal/tutupModal di ui.js.
function bukaModalAman(id) {
  const m = el(id);
  if (!m) return;
  try { bukaModal(id); } catch (e) { /* coba cara lain */ }
  if (m.classList.contains('hidden')) {
    try { bukaModal(m); } catch (e) { /* coba cara lain */ }
  }
  if (m.classList.contains('hidden')) m.classList.remove('hidden');
}

function tutupModalAman(id) {
  const m = el(id);
  if (!m) return;
  try { tutupModal(id); } catch (e) { /* lanjut cadangan */ }
  m.classList.add('hidden');
}

// ---------- Konfirmasi (modal-konfirmasi) ----------
function konfirmasi(teks) {
  return new Promise((resolve) => {
    if (resolverKonfirmasi) resolverKonfirmasi(false); // konfirmasi lama dianggap batal
    resolverKonfirmasi = resolve;
    isiTeks('konfirmasi-teks', teks);
    bukaModalAman('modal-konfirmasi');
  });
}

function jawabKonfirmasi(ya) {
  const r = resolverKonfirmasi;
  resolverKonfirmasi = null;
  tutupModalAman('modal-konfirmasi');
  if (r) r(ya);
}

// ---------- Pilihan playlist (checkbox) ----------
function daftarPilihanPlaylist() {
  return PLAYLISTS.filter((p) => p.id !== 'semua');
}

function gambarPilihanPlaylist(wadah, terpilih) {
  if (!wadah) return;
  const pilih = new Set(terpilih || []);
  wadah.textContent = '';
  daftarPilihanPlaylist().forEach((p) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'amx-chip';
    chip.dataset.id = p.id;
    chip.textContent = p.nama;
    chip.setAttribute('aria-pressed', pilih.has(p.id) ? 'true' : 'false');
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
    wadah.appendChild(chip);
  });
}

function ambilPilihanPlaylist(wadah) {
  if (!wadah) return [];
  return Array.from(wadah.querySelectorAll('.amx-chip[aria-pressed="true"]')).map((c) => c.dataset.id);
}

function bacaTags(teks) {
  const hasil = [];
  String(teks || '').split(',').forEach((t) => {
    const bersih = t.trim().toLowerCase().slice(0, 30);
    if (bersih && !hasil.includes(bersih)) hasil.push(bersih);
  });
  return hasil.slice(0, MAKS_TAG);
}

// =====================================================================
// LOGIN
// =====================================================================
function tampilPesan(teks) {
  const e = el('admin-pesan');
  if (!e) return;
  e.textContent = teks || '';
  e.classList.toggle('hidden', !teks);
}

function terapkanStatus(user) {
  const admin = !!user && user.emailVerified === true && adalahAdmin(user.email);

  if (user && !admin) {
    // Login berhasil tapi bukan admin: keluarkan lagi
    tampilPesan('Akun ini bukan admin Asix Musix.');
    au.signOut(auth).catch(() => {});
  }

  adminAktif = admin;
  emailAdmin = admin ? user.email : '';

  tampil('btn-admin', admin);
  tampil('admin-masuk', !admin);
  tampil('admin-isi', admin);
  isiTeks('admin-email', emailAdmin);
  try { aturAdmin(admin); } catch (e) { console.warn('[admin] aturAdmin gagal', e); }

  if (admin) {
    tampilPesan('');
  } else {
    hentikanPratinjau();
    resetKelola();
    resetImpor();
  }
}

async function masuk() {
  const tombol = el('btn-admin-masuk');
  if (tombol) tombol.disabled = true;
  tampilPesan('');
  try {
    const provider = new au.GoogleAuthProvider();
    await au.signInWithPopup(auth, provider);
    // Hasil akhir ditangani terapkanStatus lewat onAuthStateChanged
    if (adminAktif) pastikanKelola();
  } catch (e) {
    const kode = e && e.code ? String(e.code) : '';
    if (kode.includes('popup-closed') || kode.includes('cancelled-popup')) {
      // Pengguna menutup popup, tidak perlu pesan
    } else if (kode.includes('popup-blocked')) {
      tampilPesan('Popup diblokir browser. Izinkan popup lalu coba lagi.');
    } else if (kode.includes('unauthorized-domain')) {
      tampilPesan('Domain ini belum ada di Authorized domains Firebase (Authentication > Settings).');
    } else {
      tampilPesan('Login gagal. Coba lagi.');
      console.error('[admin] login gagal', e);
    }
  } finally {
    if (tombol) tombol.disabled = false;
  }
}

async function keluar() {
  try {
    await au.signOut(auth);
    tampilToast('Keluar dari admin');
  } catch (e) {
    tampilToast('Gagal keluar. Coba lagi.');
  }
}

// =====================================================================
// KELOLA LAGU
// =====================================================================
function resetKelola() {
  kelolaDimuat = false;
  kelolaHabis = false;
  sedangMuat = false;
  petaLagu.clear();
  idTampil.clear();
  const daftar = el('daftar-admin');
  if (daftar) daftar.textContent = '';
  isiTeks('admin-status', '');
}

function perbaruiStatusKelola() {
  const jumlah = idTampil.size;
  let teks;
  if (jumlah === 0) teks = kelolaHabis ? 'Belum ada lagu. Impor dulu lewat tab Impor.' : '';
  else teks = jumlah + ' lagu dimuat' + (kelolaHabis ? ' (semua sudah tampil)' : '');
  isiTeks('admin-status', teks);
  tampil('btn-admin-muat', !kelolaHabis && kelolaDimuat);
}

function isiBarisLagu(akar, lagu) {
  const j = bagian(akar, 'judul');
  const a = bagian(akar, 'artis');
  const p = bagian(akar, 'playlist');
  if (j) j.textContent = lagu.title || '(tanpa judul)';
  if (a) a.textContent = lagu.artist || '';
  if (p) {
    const nama = (lagu.playlists || []).map(namaPlaylist);
    p.textContent = nama.length ? nama.join(', ') : 'Belum ada playlist';
  }
}

function tambahBarisLagu(lagu, diAwal) {
  if (!lagu || !lagu.id || idTampil.has(lagu.id)) return;
  const daftar = el('daftar-admin');
  const akar = klonTemplate('tpl-admin-lagu');
  if (!daftar || !akar) return;

  akar.dataset.id = lagu.id;
  isiBarisLagu(akar, lagu);

  const ubah = bagian(akar, 'ubah');
  const hapus = bagian(akar, 'hapus');
  if (ubah) ubah.addEventListener('click', () => bukaEdit(lagu.id));
  if (hapus) hapus.addEventListener('click', () => hapusDenganKonfirmasi(lagu.id));

  petaLagu.set(lagu.id, lagu);
  idTampil.add(lagu.id);
  if (diAwal) daftar.prepend(akar);
  else daftar.appendChild(akar);
}

function barisDariId(id) {
  const daftar = el('daftar-admin');
  if (!daftar) return null;
  return Array.from(daftar.children).find((c) => c.dataset && c.dataset.id === id) || null;
}

async function muatKelola() {
  if (sedangMuat || !adminAktif) return;
  sedangMuat = true;
  const btnMuat = el('btn-admin-muat');
  if (btnMuat) btnMuat.disabled = true;
  isiTeks('admin-status', 'Memuat lagu...');
  try {
    if (!kelolaDimuat) {
      // Tampilkan dulu lagu yang sudah ada di cache (dari beranda)
      let cache = [];
      try {
        const hasilCache = daftarTermuat('semua');
        if (Array.isArray(hasilCache)) cache = hasilCache;
      } catch (e) { /* abaikan, lanjut muat dari Firestore */ }
      cache.forEach((l) => tambahBarisLagu(l, false));
    }
    if (idTampil.size === 0 || kelolaDimuat) {
      const hasil = await muatBerikutnya('semua');
      const baru = hasil && Array.isArray(hasil.baru) ? hasil.baru : [];
      baru.forEach((l) => tambahBarisLagu(l, false));
      kelolaHabis = !!(hasil && hasil.habis);
    }
    kelolaDimuat = true;
  } catch (e) {
    console.error('[admin] muat kelola gagal', e);
    tampilToast(pesanError(e));
  } finally {
    sedangMuat = false;
    if (btnMuat) btnMuat.disabled = false;
    perbaruiStatusKelola();
  }
}

function pastikanKelola() {
  if (adminAktif && !kelolaDimuat) muatKelola();
}

// ---------- Edit ----------
let idSedangEdit = null;

function bukaEdit(id) {
  const lagu = petaLagu.get(id);
  if (!lagu) return;
  idSedangEdit = id;

  const judul = el('edit-judul');
  if (judul) {
    if ('value' in judul) { judul.value = lagu.title || ''; judul.readOnly = true; }
    else judul.textContent = lagu.title || '';
  }
  gambarPilihanPlaylist(el('edit-playlist'), lagu.playlists || []);
  const tags = el('edit-tags');
  if (tags) tags.value = (lagu.tags || []).join(', ');
  bukaModalAman('modal-edit');
}

async function simpanEdit() {
  const id = idSedangEdit;
  const lagu = id ? petaLagu.get(id) : null;
  if (!lagu) return;

  const playlists = ambilPilihanPlaylist(el('edit-playlist'));
  const tags = bacaTags(el('edit-tags') ? el('edit-tags').value : '');
  if (playlists.length === 0) {
    tampilToast('Pilih minimal 1 playlist');
    return;
  }

  const tombol = el('btn-edit-simpan');
  if (tombol) tombol.disabled = true;
  try {
    await ubahLagu(id, { playlists, tags });
    lagu.playlists = playlists;
    lagu.tags = tags;
    const baris = barisDariId(id);
    if (baris) isiBarisLagu(baris, lagu);
    tutupModalAman('modal-edit');
    idSedangEdit = null;
    tampilToast('Perubahan tersimpan');
  } catch (e) {
    console.error('[admin] ubah lagu gagal', e);
    tampilToast(pesanError(e));
  } finally {
    if (tombol) tombol.disabled = false;
  }
}

// ---------- Hapus ----------
async function hapusDenganKonfirmasi(id) {
  const lagu = petaLagu.get(id);
  if (!lagu) return;
  const ya = await konfirmasi('Hapus "' + (lagu.title || 'lagu ini') + '" dari Asix Musix? Lagu hilang dari semua playlist.');
  if (!ya) return;
  try {
    await hapusLagu(id);
    const baris = barisDariId(id);
    if (baris) baris.remove();
    petaLagu.delete(id);
    idTampil.delete(id);
    perbaruiStatusKelola();
    tampilToast('Lagu dihapus');
  } catch (e) {
    console.error('[admin] hapus lagu gagal', e);
    tampilToast(pesanError(e));
  }
}

// =====================================================================
// IMPOR DARI JAMENDO
// =====================================================================
let audioPratinjau = null;
let tombolPratinjau = null;

function tandaiTombolPratinjau(tombol, main) {
  if (!tombol) return;
  tombol.setAttribute('aria-pressed', main ? 'true' : 'false');
  tombol.dataset.status = main ? 'main' : 'jeda';
  tombol.setAttribute('aria-label', main ? 'Jeda pratinjau' : 'Putar pratinjau');
}

function hentikanPratinjau() {
  const a = audioPratinjau;
  const t = tombolPratinjau;
  audioPratinjau = null;   // di-null dulu agar event error/ended dari pembersihan diabaikan
  tombolPratinjau = null;
  if (a) {
    try {
      a.pause();
      a.removeAttribute('src');
      a.load();
    } catch (e) { /* abaikan */ }
  }
  tandaiTombolPratinjau(t, false);
}

function togglePratinjau(tombol, url) {
  if (tombolPratinjau === tombol) {
    hentikanPratinjau();
    return;
  }
  hentikanPratinjau();
  try { jeda(); } catch (e) { /* abaikan */ }

  const a = new Audio();
  a.preload = 'none';
  a.src = url;
  audioPratinjau = a;
  tombolPratinjau = tombol;
  tandaiTombolPratinjau(tombol, true);

  a.addEventListener('ended', () => { if (audioPratinjau === a) hentikanPratinjau(); });
  a.addEventListener('error', () => {
    if (audioPratinjau === a) {
      hentikanPratinjau();
      tampilToast('Pratinjau tidak bisa diputar');
    }
  });
  const janji = a.play();
  if (janji && janji.catch) {
    janji.catch((e) => {
      if (audioPratinjau !== a || (e && e.name === 'AbortError')) return;
      hentikanPratinjau();
      tampilToast('Pratinjau tidak bisa diputar');
    });
  }
}

function namaLisensi(url) {
  const u = String(url || '');
  const m = /creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/i.exec(u);
  if (m) return 'CC ' + m[1].toUpperCase() + ' ' + m[2];
  if (/publicdomain|zero/i.test(u)) return 'CC0';
  return u ? 'Creative Commons' : 'Lisensi tidak diketahui';
}

function bacaTagCari(teks) {
  const kata = String(teks || '').toLowerCase().split(/[\s,+]+/)
    .map((k) => k.replace(/[^a-z0-9-]/g, '').slice(0, 30))
    .filter(Boolean);
  return Array.from(new Set(kata)).slice(0, 3);
}

async function ambilJamendo(kata) {
  const dasar = String(JAMENDO_API).replace(/\/+$/, '');
  const param = new URLSearchParams({
    client_id: JAMENDO_CLIENT_ID,
    format: 'json',
    limit: String(JUMLAH_HASIL),
    tags: kata.join(' '),            // spasi -> "+" di URL, sesuai format tag Jamendo
    audioformat: 'mp32',
    vocalinstrumental: 'instrumental',
    imagesize: '300',
    order: 'popularity_total',
  });
  const ac = new AbortController();
  const batas = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(dasar + '/tracks/?' + param.toString(), { signal: ac.signal });
    if (!res.ok) throw new Error('Jamendo membalas HTTP ' + res.status);
    const data = await res.json();
    const h = data && data.headers;
    if (!h || h.status !== 'success') {
      throw new Error((h && h.error_message) || 'Jamendo menolak permintaan');
    }
    return Array.isArray(data.results) ? data.results : [];
  } finally {
    clearTimeout(batas);
  }
}

function dariTrack(t) {
  const id = String(t.id);
  return {
    title: String(t.name || 'Tanpa judul'),
    artist: String(t.artist_name || 'Tidak diketahui'),
    coverUrl: urlHttps(t.image) || urlHttps(t.album_image) || '',
    jamendoId: id,
    audioUrl: urlHttps(t.audio),
    duration: Number(t.duration) || 0,
    license: namaLisensi(t.license_ccurl),
    licenseUrl: urlHttps(t.license_ccurl),
    sourceUrl: urlHttps(t.shareurl) || ('https://www.jamendo.com/track/' + encodeURIComponent(id)),
  };
}

function resetImpor() {
  barisImpor = [];
  const wadah = el('impor-hasil');
  if (wadah) wadah.textContent = '';
  tampil('impor-simpan-wadah', false);
  isiTeks('impor-status', '');
}

function perbaruiStatusImpor(tambahan) {
  const dipilih = barisImpor.filter((b) => b.cek && b.cek.checked && !b.cek.disabled).length;
  let teks = barisImpor.length + ' hasil, ' + dipilih + ' dipilih. Pilih playlist, lalu tekan Simpan.';
  if (tambahan) teks += ' ' + tambahan;
  isiTeks('impor-status', teks);
}

function renderHasilImpor(daftarTrack) {
  const wadah = el('impor-hasil');
  if (!wadah) return;
  wadah.textContent = '';
  barisImpor = [];
  const frag = document.createDocumentFragment();

  daftarTrack.forEach((t) => {
    const lagu = dariTrack(t);
    if (!lagu.audioUrl) return; // tanpa URL audio tidak bisa diputar
    const akar = klonTemplate('tpl-hasil-jamendo');
    if (!akar) return;

    const judul = bagian(akar, 'judul');
    const artis = bagian(akar, 'artis');
    const lisensi = bagian(akar, 'lisensi');
    const cek = bagian(akar, 'cek');
    const pratinjau = bagian(akar, 'pratinjau');
    if (judul) judul.textContent = lagu.title;
    if (artis) artis.textContent = lagu.artist;
    if (lisensi) lisensi.textContent = lagu.license;
    isiCover(bagian(akar, 'cover'), lagu.coverUrl);
    if (cek) {
      cek.checked = true;
      cek.addEventListener('change', () => perbaruiStatusImpor());
    }
    if (pratinjau) {
      tandaiTombolPratinjau(pratinjau, false);
      pratinjau.addEventListener('click', () => togglePratinjau(pratinjau, lagu.audioUrl));
    }

    barisImpor.push({ akar, cek, lagu, tombol: pratinjau });
    frag.appendChild(akar);
  });

  wadah.appendChild(frag);
  tampil('impor-simpan-wadah', barisImpor.length > 0);
}

async function cariJamendo() {
  if (sedangCari) return;
  const kata = bacaTagCari(el('impor-tag') ? el('impor-tag').value : '');
  if (kata.length === 0) {
    tampilToast('Isi tag dulu, contoh: lofi');
    return;
  }
  if (!JAMENDO_SIAP) {
    isiTeks('impor-status', 'JAMENDO_CLIENT_ID belum diisi di firebase-config.js.');
    return;
  }

  sedangCari = true;
  hentikanPratinjau();
  resetImpor();
  isiTeks('impor-status', 'Mencari lagu "' + kata.join(' ') + '" di Jamendo...');
  try {
    const hasil = await ambilJamendo(kata);
    renderHasilImpor(hasil);
    if (barisImpor.length === 0) {
      isiTeks('impor-status', 'Tidak ada hasil. Coba tag lain, misalnya piano, guitar, ambient.');
    } else {
      const adaNC = barisImpor.some((b) => /-NC/i.test(b.lagu.license));
      perbaruiStatusImpor(adaNC ? 'Catatan: lisensi NC hanya untuk pemakaian non-komersial.' : '');
    }
  } catch (e) {
    console.error('[admin] cari Jamendo gagal', e);
    const pesan = (e && e.name === 'AbortError') ? 'Jamendo terlalu lama membalas. Coba lagi.' : 'Pencarian gagal: ' + pesanError(e);
    isiTeks('impor-status', pesan);
  } finally {
    sedangCari = false;
  }
}

async function simpanImpor() {
  if (sedangSimpan || !adminAktif) return;
  const terpilih = barisImpor.filter((b) => b.cek && b.cek.checked && !b.cek.disabled);
  const playlists = ambilPilihanPlaylist(el('impor-playlist'));
  if (terpilih.length === 0) {
    tampilToast('Belum ada lagu yang dipilih');
    return;
  }
  if (playlists.length === 0) {
    tampilToast('Pilih minimal 1 playlist');
    return;
  }

  const tags = bacaTagCari(el('impor-tag') ? el('impor-tag').value : '');
  sedangSimpan = true;
  hentikanPratinjau();
  const tombol = el('btn-impor-simpan');
  if (tombol) tombol.disabled = true;

  let baru = 0;
  let sudahAda = 0;
  let gagal = 0;
  try {
    for (let i = 0; i < terpilih.length; i++) {
      const b = terpilih[i];
      isiTeks('impor-status', 'Menyimpan ' + (i + 1) + ' dari ' + terpilih.length + '...');
      try {
        const lagu = Object.assign({}, b.lagu, { playlists, tags });
        const res = await simpanLagu(lagu, emailAdmin);
        if (res && res.status === 'sudah-ada') sudahAda++;
        else baru++;
        if (res && res.status !== 'sudah-ada' && res.lagu && kelolaDimuat) tambahBarisLagu(res.lagu, true);
        if (b.cek) { b.cek.checked = false; b.cek.disabled = true; }
        b.akar.classList.add('opacity-50');
      } catch (e) {
        gagal++;
        console.error('[admin] simpan lagu gagal', e);
        if (e && String(e.code || '').includes('permission-denied')) {
          tampilToast(pesanError(e));
          break; // semua sisanya pasti ditolak juga
        }
      }
    }
  } finally {
    sedangSimpan = false;
    if (tombol) tombol.disabled = false;
  }

  let ringkas = 'Selesai: ' + baru + ' lagu baru';
  if (sudahAda) ringkas += ', ' + sudahAda + ' sudah ada';
  if (gagal) ringkas += ', ' + gagal + ' gagal';
  isiTeks('impor-status', ringkas + '.');
  tampilToast(ringkas);
  if (baru > 0) {
    perbaruiStatusKelola();
    try { muatUlangBeranda(); } catch (e) { /* abaikan */ }
  }
}

// =====================================================================
// TAB (Kelola / Impor)
// =====================================================================
function pilihSeg(nama) {
  document.querySelectorAll('[data-seg]').forEach((b) => {
    const aktif = b.dataset.seg === nama;
    b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
    b.setAttribute('aria-selected', aktif ? 'true' : 'false');
  });
  tampil('panel-kelola', nama === 'kelola');
  tampil('panel-impor', nama === 'impor');
  if (nama === 'kelola') pastikanKelola();
  else hentikanPratinjau();
}

// =====================================================================
// PEMASANGAN
// =====================================================================
export function mulaiAdmin() {
  const tombolMasuk = el('btn-admin-masuk');
  const siap = FIREBASE_SIAP && !MODE_PREVIEW && auth && au;

  // Pasang tab dan form dulu (tidak butuh Firebase)
  document.querySelectorAll('[data-seg]').forEach((b) => {
    b.addEventListener('click', () => pilihSeg(b.dataset.seg));
  });
  gambarPilihanPlaylist(el('impor-playlist'), []);

  if (!siap) {
    tampil('btn-admin', false);
    tampil('admin-masuk', true);
    tampil('admin-isi', false);
    tampilPesan('Mode pratinjau: Firebase belum diisi, jadi fitur admin belum aktif.');
    if (tombolMasuk) tombolMasuk.disabled = true;
    return;
  }
  if (!ADMIN_SIAP) {
    tampilPesan('ADMIN_EMAIL belum diisi di firebase-config.js.');
    if (tombolMasuk) tombolMasuk.disabled = true;
    return;
  }

  if (tombolMasuk) tombolMasuk.addEventListener('click', masuk);
  const tombolKeluar = el('btn-admin-keluar');
  if (tombolKeluar) tombolKeluar.addEventListener('click', keluar);

  // Edit
  const edSimpan = el('btn-edit-simpan');
  if (edSimpan) edSimpan.addEventListener('click', simpanEdit);
  const edBatal = el('btn-edit-batal');
  if (edBatal) edBatal.addEventListener('click', () => {
    tutupModalAman('modal-edit');
    idSedangEdit = null;
  });

  // Konfirmasi
  const ya = el('btn-konfirmasi-ya');
  if (ya) ya.addEventListener('click', () => jawabKonfirmasi(true));
  const tidak = el('btn-konfirmasi-tidak');
  if (tidak) tidak.addEventListener('click', () => jawabKonfirmasi(false));

  // Kelola
  const muat = el('btn-admin-muat');
  if (muat) muat.addEventListener('click', muatKelola);

  // Impor
  const form = el('form-impor');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      cariJamendo();
    });
  }
  const simpan = el('btn-impor-simpan');
  if (simpan) simpan.addEventListener('click', simpanImpor);

  // Muat daftar Kelola hanya saat layar admin dibuka (hemat baca Firestore)
  const btnAdmin = el('btn-admin');
  if (btnAdmin) btnAdmin.addEventListener('click', () => setTimeout(pastikanKelola, 0));
  const saatRuteBerubah = () => {
    if (location.hash === '#admin') pastikanKelola();
    else hentikanPratinjau();
  };
  window.addEventListener('hashchange', saatRuteBerubah);
  window.addEventListener('popstate', saatRuteBerubah);

  pilihSeg('kelola');
  au.onAuthStateChanged(auth, (user) => {
    terapkanStatus(user);
    if (adminAktif && location.hash === '#admin') pastikanKelola();
  });
}
