// =====================================================================
// Asix Musix (AMX) - js/ui.js (File 9)
// Memenuhi fitur: 2 (katalog + chip playlist + infinite scroll),
// 3 (kartu, mini player, Now Playing, Antrean, toast), 10 (kolom cari),
// 11 (hati + filter Favorit), 12 (banner & mini player lagu terakhir).
//
// CATATAN AWAL (baca dulu):
// 1. Semua teks dari data dimasukkan lewat textContent (aman dari XSS).
//    Link sumber/lisensi/cover hanya dipakai jika diawali http(s)://.
// 2. Struktur diambil dari index.html (id dan <template>), gaya dari
//    css/style.css. Modul ini memantau js/player.js lewat pantau().
// 3. Urutan di app.js: mulaiPemutar() lalu mulaiUI(). mulaiUI() sendiri
//    memulihkan lagu terakhir (mini player + banner, keadaan jeda).
// 4. Layar (Now Playing, Antrean, Admin) memakai riwayat browser dengan
//    hash #np, #antrean, #admin supaya tombol Back Android menutupnya.
//    Perlu verifikasi di HP user.
// 5. Dipakai juga oleh timer.js dan admin.js: tampilToast, bukaModal,
//    tutupModal, bukaLayar, tutupLayar, klonKartu, isiKartu, isiCover,
//    urlAman, muatUlangBeranda.
// =====================================================================

import { MODE_PREVIEW, PLAYLISTS } from './firebase-config.js';
import { muatBerikutnya, daftarTermuat, bukaPencarian, bukaFavorit } from './data.js';
import { adalahFavorit, toggleFavorit, pantauFavorit, daftarFavorit, ambilTerakhir } from './local-store.js';
import {
  pantau, formatWaktu, putarDariDaftar, putarAntrean, sambungAntrean, toggleMain, main,
  berikutnya, sebelumnya, geserKe, setVolume, toggleAcak, ambilStatus, ambilAntrean, pulihkanTerakhir
} from './player.js';

const $ = (id) => document.getElementById(id);
const BATAS_ANTREAN_TAMPIL = 100;
const LAYAR = { np: 'layar-np', antrean: 'layar-antrean', admin: 'layar-admin' };

// ---------------------------------------------------------------------
// 1) PEMBANTU UMUM (dipakai modul lain)
// ---------------------------------------------------------------------
export function urlAman(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Pasang gambar cover sebagai latar. Jika kosong/gagal, tampil placeholder.
export function isiCover(el, url) {
  if (!el) return;
  el.dataset.cover = url || '';
  if (!urlAman(url)) {
    el.style.backgroundImage = '';
    el.classList.remove('ada-gambar');
    return;
  }
  el.style.backgroundImage = `url("${url.replace(/["\\\n\r]/g, '')}")`;
  el.classList.add('ada-gambar');
  const uji = new Image();
  uji.onerror = () => {
    if (el.dataset.cover === url) {
      el.style.backgroundImage = '';
      el.classList.remove('ada-gambar');
    }
  };
  uji.src = url;
}

export function tampilToast(teks, ms = 2600) {
  const wadah = $('toast-wadah');
  if (!wadah || !teks) return;
  while (wadah.children.length >= 3) wadah.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'amx-toast';
  el.textContent = String(teks);
  wadah.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function bukaModal(id) {
  const el = $(id);
  if (el) el.classList.remove('hidden');
}

export function tutupModal(id) {
  const el = $(id);
  if (el) el.classList.add('hidden');
}

// Isi kartu dari <template> dengan data lagu (textContent saja).
export function isiKartu(el, lagu) {
  const f = (nama) => el.querySelector(`[data-f="${nama}"]`);
  el.dataset.id = lagu.id;
  if (f('judul')) f('judul').textContent = lagu.title || 'Tanpa judul';
  if (f('artis')) f('artis').textContent = lagu.artist || 'Artis tidak diketahui';
  if (f('lisensi')) f('lisensi').textContent = `${lagu.source || 'Jamendo'} \u00b7 ${lagu.license || 'Lisensi tidak tercatat'}`;
  if (f('durasi')) f('durasi').textContent = lagu.duration > 0 ? formatWaktu(lagu.duration) : '';
  if (f('cover')) isiCover(f('cover'), lagu.coverUrl);
  if (f('hati')) f('hati').setAttribute('aria-pressed', adalahFavorit(lagu.id) ? 'true' : 'false');
  return el;
}

export function klonKartu(idTemplate, lagu) {
  const el = $(idTemplate).content.firstElementChild.cloneNode(true);
  return isiKartu(el, lagu);
}

function semuaKartu(id) {
  return document.querySelectorAll(`.amx-kartu[data-id="${CSS.escape(id)}"]`);
}

// ---------------------------------------------------------------------
// 2) LAYAR (Now Playing, Antrean, Admin) - rute hash + tombol Back
// ---------------------------------------------------------------------
export function bukaLayar(nama) {
  if (!LAYAR[nama] || location.hash === `#${nama}`) return;
  history.pushState({ amx: 1 }, '', `#${nama}`);
  sinkronLayar();
}

export function tutupLayar() {
  if (history.state && history.state.amx) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    sinkronLayar();
  }
}

function layarTerlihat(nama) {
  return !$(LAYAR[nama]).classList.contains('hidden');
}

function sinkronLayar() {
  let hash = location.hash.slice(1);
  if ((hash === 'np' || hash === 'antrean') && !ambilStatus().lagu) {
    history.replaceState(null, '', location.pathname + location.search);
    hash = '';
  }
  const terlihat = {
    np: hash === 'np' || hash === 'antrean',
    antrean: hash === 'antrean',
    admin: hash === 'admin'
  };
  Object.keys(LAYAR).forEach((nama) => $(LAYAR[nama]).classList.toggle('hidden', !terlihat[nama]));
  document.body.style.overflow = hash ? 'hidden' : '';
  if (terlihat.antrean && antreanKotor) renderDaftarAntrean();
}

// ---------------------------------------------------------------------
// 3) BERANDA: chip, pencarian, favorit, daftar, infinite scroll (fitur 2, 10, 11)
// ---------------------------------------------------------------------
const s = {
  playlist: 'semua',
  kata: '',
  favorit: false,
  mode: 'katalog',   // 'katalog' | 'cari' | 'favorit'
  pager: null,
  tampil: [],        // lagu yang sedang tampil di daftar
  memuat: false,
  habis: false,
  galat: false,
  token: 0           // pembatal permintaan lama saat filter berganti
};

function setStatus(teks) {
  $('status-daftar').textContent = teks || '';
}

function buatChip() {
  const wadah = $('chip-playlist');
  PLAYLISTS.forEach((p) => {
    const tombol = document.createElement('button');
    tombol.className = 'amx-chip';
    tombol.dataset.id = p.id;
    tombol.textContent = p.nama;
    wadah.appendChild(tombol);
  });
}

function perbaruiChip() {
  document.querySelectorAll('#chip-playlist .amx-chip').forEach((c) => {
    const aktif = !s.favorit && !s.kata && c.dataset.id === s.playlist;
    c.setAttribute('aria-pressed', aktif ? 'true' : 'false');
  });
  $('btn-favorit').setAttribute('aria-pressed', s.favorit && !s.kata ? 'true' : 'false');
}

function tambahKartu(daftarLagu) {
  const pecahan = document.createDocumentFragment();
  daftarLagu.forEach((l) => pecahan.appendChild(klonKartu('tpl-kartu', l)));
  $('daftar-lagu').appendChild(pecahan);
  s.tampil.push(...daftarLagu);
  const sekarang = ambilStatus().lagu;
  if (sekarang) tandaiSedangMain(sekarang.id);
}

function pesanKosong() {
  if (s.mode === 'cari') return `Tidak ada lagu yang cocok dengan "${s.kata}".`;
  if (s.mode === 'favorit') return 'Belum ada favorit. Ketuk ikon hati pada lagu.';
  return 'Belum ada lagu di playlist ini.';
}

function pesanGalat(err) {
  if (err && err.code === 'failed-precondition') {
    return 'Playlist ini butuh indeks Firestore. Lihat catatan awal data.js. Ketuk untuk coba lagi.';
  }
  return 'Gagal memuat lagu. Ketuk untuk coba lagi.';
}

function cekSentinel() {
  requestAnimationFrame(() => {
    const posisi = $('sentinel').getBoundingClientRect().top;
    if (posisi < window.innerHeight + 400) muatLagi();
  });
}

async function muatLagi() {
  if (s.memuat || s.habis || s.galat) return;
  const token = s.token;
  s.memuat = true;
  if (!s.tampil.length) setStatus('Memuat lagu...');
  try {
    const hasil = s.mode === 'katalog' ? await muatBerikutnya(s.playlist) : await s.pager.berikutnya();
    if (token !== s.token) return;
    const baru = hasil.baru || hasil.lagu || [];
    s.habis = hasil.habis;
    tambahKartu(baru);
    // Setelah buka aplikasi, antrean lagu terakhir ikut diisi dari katalog.
    if (s.mode === 'katalog' && ambilStatus().total <= 1) sambungAntrean(baru);
    setStatus(s.tampil.length ? '' : pesanKosong());
    cekSentinel();
  } catch (err) {
    if (token !== s.token) return;
    console.error('[AMX] Gagal memuat daftar:', err);
    s.galat = true;
    setStatus(pesanGalat(err));
  } finally {
    if (token === s.token) s.memuat = false;
  }
}

function muatUlang() {
  s.token += 1;
  s.memuat = false;
  s.habis = false;
  s.galat = false;
  s.tampil = [];
  s.mode = s.kata ? 'cari' : (s.favorit ? 'favorit' : 'katalog');
  $('daftar-lagu').replaceChildren();
  setStatus('');
  perbaruiChip();

  if (s.mode === 'katalog') {
    const cache = daftarTermuat(s.playlist); // tampil dari memori tanpa baca ulang
    if (cache.length) {
      tambahKartu(cache);
      cekSentinel();
    } else {
      muatLagi();
    }
    return;
  }
  if (s.mode === 'cari') {
    s.pager = bukaPencarian(s.kata);
  } else {
    const ids = daftarFavorit();
    if (!ids.length) {
      s.habis = true;
      setStatus(pesanKosong());
      return;
    }
    s.pager = bukaFavorit(ids);
  }
  muatLagi();
}

export function muatUlangBeranda() {
  muatUlang();
}

function labelPlaylist() {
  return s.mode === 'katalog' ? s.playlist : s.mode;
}

function pasangBeranda() {
  // Chip playlist
  $('chip-playlist').addEventListener('click', (e) => {
    const chip = e.target.closest('.amx-chip');
    if (!chip) return;
    s.playlist = chip.dataset.id;
    s.favorit = false;
    s.kata = '';
    $('input-cari').value = '';
    muatUlang();
  });

  // Filter Favorit
  $('btn-favorit').addEventListener('click', () => {
    s.favorit = !(s.favorit && !s.kata);
    s.kata = '';
    $('input-cari').value = '';
    muatUlang();
  });

  // Pencarian (tunda 350 ms agar hemat baca)
  let tunda = null;
  const terapkanCari = () => {
    const kata = $('input-cari').value.trim();
    if (kata === s.kata) return;
    s.kata = kata;
    muatUlang();
  };
  $('input-cari').addEventListener('input', () => {
    clearTimeout(tunda);
    tunda = setTimeout(terapkanCari, 350);
  });
  $('input-cari').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(tunda);
      terapkanCari();
      e.target.blur();
    }
  });

  // Ketuk status untuk coba lagi
  $('status-daftar').addEventListener('click', () => {
    if (!s.galat) return;
    s.galat = false;
    setStatus('');
    muatLagi();
  });

  // Infinite scroll
  new IntersectionObserver((entri) => {
    if (entri.some((x) => x.isIntersecting)) muatLagi();
  }, { rootMargin: '400px' }).observe($('sentinel'));

  // Ketuk kartu (putar) atau hati (favorit)
  $('daftar-lagu').addEventListener('click', (e) => {
    const kartu = e.target.closest('.amx-kartu');
    if (!kartu) return;
    if (e.target.closest('[data-f="hati"]')) {
      toggleFavorit(kartu.dataset.id);
      return;
    }
    putarDariDaftar(s.tampil, kartu.dataset.id, labelPlaylist());
  });

  $('btn-admin').addEventListener('click', () => bukaLayar('admin'));
  $('btn-admin-tutup').addEventListener('click', tutupLayar);
}

// Lanjutkan antrean dari katalog saat lagu hampir habis (putar tanpa henti).
let sedangMenyambung = false;
async function lanjutkanAntrean() {
  const playlist = ambilStatus().playlist;
  if (sedangMenyambung || !PLAYLISTS.some((p) => p.id === playlist)) return;
  sedangMenyambung = true;
  try {
    const hasil = await muatBerikutnya(playlist);
    if (!hasil.baru.length) return;
    sambungAntrean(hasil.baru);
    if (s.mode === 'katalog' && s.playlist === playlist) tambahKartu(hasil.baru);
  } catch (err) {
    console.error('[AMX] Gagal menyambung antrean:', err);
  } finally {
    sedangMenyambung = false;
  }
}

// ---------------------------------------------------------------------
// 4) PEMUTAR: mini player, Now Playing, Antrean (fitur 3, 12)
// ---------------------------------------------------------------------
let menggeser = false;
let antreanKotor = false;

function tandaiSedangMain(id) {
  document.querySelectorAll('.amx-kartu.sedang-main').forEach((k) => k.classList.remove('sedang-main'));
  if (id) semuaKartu(id).forEach((k) => k.classList.add('sedang-main'));
}

function atasiSumber(el, teks, tautan) {
  el.textContent = teks;
  if (urlAman(tautan)) el.setAttribute('href', tautan);
  else el.removeAttribute('href');
}

function tampilkanLagu(lagu) {
  $('mini-player').classList.toggle('hidden', !lagu);
  if (!lagu) {
    tandaiSedangMain(null);
    return;
  }
  // Mini player
  isiCover($('mini-cover'), lagu.coverUrl);
  $('mini-judul').textContent = lagu.title || 'Tanpa judul';
  $('mini-artis').textContent = lagu.artist || '';
  // Now Playing
  isiCover($('np-cover'), lagu.coverUrl);
  $('np-judul').textContent = lagu.title || 'Tanpa judul';
  $('np-artis').textContent = lagu.artist || '';
  atasiSumber($('np-sumber'), lagu.source || 'Jamendo', lagu.sourceUrl);
  atasiSumber($('np-lisensi'), lagu.license || 'Lisensi tidak tercatat', lagu.licenseUrl);
  $('btn-np-hati').setAttribute('aria-pressed', adalahFavorit(lagu.id) ? 'true' : 'false');
  tandaiSedangMain(lagu.id);
}

function perbaruiWaktu({ posisi, durasi }) {
  const persen = durasi > 0 ? Math.min(100, (posisi / durasi) * 100) : 0;
  $('mini-progres').style.width = `${persen}%`;
  if (menggeser) return;
  const seek = $('np-seek');
  seek.max = String(durasi > 0 ? durasi : 100);
  seek.value = String(posisi);
  seek.style.setProperty('--isi', `${persen}%`);
  $('np-waktu').textContent = formatWaktu(posisi);
  $('np-durasi').textContent = formatWaktu(durasi);
}

function renderAntrean(data) {
  const sedang = data.sedang;
  isiCover($('antrean-cover'), sedang ? sedang.coverUrl : '');
  $('antrean-judul').textContent = sedang ? (sedang.title || 'Tanpa judul') : '';
  $('antrean-artis').textContent = sedang ? (sedang.artist || '') : '';
  $('antrean-jumlah').textContent = `${data.total} lagu`;
  const sisa = data.berikutnya.length;
  $('antrean-label').textContent = sisa > BATAS_ANTREAN_TAMPIL
    ? `Daftar Lagu (${sisa} Selanjutnya, tampil ${BATAS_ANTREAN_TAMPIL})`
    : `Daftar Lagu (${sisa} Selanjutnya)`;
  antreanKotor = true;
  if (layarTerlihat('antrean')) renderDaftarAntrean();
}

function renderDaftarAntrean() {
  antreanKotor = false;
  const data = ambilAntrean();
  const awal = ambilStatus().indeks + 1;
  const pecahan = document.createDocumentFragment();
  data.berikutnya.slice(0, BATAS_ANTREAN_TAMPIL).forEach((l, i) => {
    const el = klonKartu('tpl-antrean', l);
    el.dataset.i = String(awal + i);
    pecahan.appendChild(el);
  });
  $('daftar-antrean').replaceChildren(pecahan);
}

function tanganiPemutar(jenis, data) {
  switch (jenis) {
    case 'lagu':
      tampilkanLagu(data);
      break;
    case 'status':
      ['btn-mini-play', 'btn-np-play', 'btn-antrean-play'].forEach((id) => $(id).setAttribute('data-status', data));
      if (data === 'main') $('banner-lanjut').classList.add('hidden');
      break;
    case 'waktu':
      perbaruiWaktu(data);
      break;
    case 'antrean':
      renderAntrean(data);
      break;
    case 'acak':
      ['btn-np-acak', 'btn-antrean-acak'].forEach((id) => $(id).setAttribute('aria-pressed', data ? 'true' : 'false'));
      break;
    case 'volume':
      $('np-volume').value = String(data);
      $('np-volume').style.setProperty('--isi', `${data * 100}%`);
      break;
    case 'pesan':
      tampilToast(data);
      break;
    case 'hampir-habis':
      lanjutkanAntrean();
      break;
    default:
  }
}

function pasangPemutar() {
  // Mini player
  $('mini-buka').addEventListener('click', () => bukaLayar('np'));
  $('btn-mini-play').addEventListener('click', toggleMain);
  $('btn-mini-next').addEventListener('click', berikutnya);

  // Now Playing
  $('btn-np-tutup').addEventListener('click', tutupLayar);
  $('btn-np-antrean').addEventListener('click', () => bukaLayar('antrean'));
  $('btn-np-play').addEventListener('click', toggleMain);
  $('btn-np-prev').addEventListener('click', sebelumnya);
  $('btn-np-next').addEventListener('click', berikutnya);
  $('btn-np-acak').addEventListener('click', toggleAcak);
  $('btn-np-hati').addEventListener('click', () => {
    const lagu = ambilStatus().lagu;
    if (lagu) toggleFavorit(lagu.id);
  });

  // Seek: pratinjau saat digeser, pindah posisi saat dilepas
  const seek = $('np-seek');
  const selesaiGeser = () => setTimeout(() => { menggeser = false; }, 150);
  seek.addEventListener('input', () => {
    menggeser = true;
    const maks = Number(seek.max) || 1;
    seek.style.setProperty('--isi', `${(Number(seek.value) / maks) * 100}%`);
    $('np-waktu').textContent = formatWaktu(seek.value);
  });
  seek.addEventListener('change', () => {
    geserKe(Number(seek.value));
    selesaiGeser();
  });
  seek.addEventListener('pointerup', selesaiGeser);
  seek.addEventListener('touchend', selesaiGeser);

  // Volume
  $('np-volume').addEventListener('input', (e) => setVolume(e.target.value));

  // Antrean
  $('btn-antrean-tutup').addEventListener('click', tutupLayar);
  $('btn-antrean-play').addEventListener('click', toggleMain);
  $('btn-antrean-acak').addEventListener('click', toggleAcak);
  $('daftar-antrean').addEventListener('click', (e) => {
    const kartu = e.target.closest('.amx-kartu');
    if (!kartu) return;
    if (e.target.closest('[data-f="hati"]')) {
      toggleFavorit(kartu.dataset.id);
      return;
    }
    putarAntrean(Number(kartu.dataset.i));
  });

  // Banner lanjut lagu terakhir (fitur 12)
  $('banner-lanjut').addEventListener('click', () => {
    $('banner-lanjut').classList.add('hidden');
    main();
  });
}

// ---------------------------------------------------------------------
// 5) FAVORIT: sinkronkan hati di semua tempat (fitur 11)
// ---------------------------------------------------------------------
function pasangFavorit() {
  pantauFavorit((id, aktif) => {
    const nilai = aktif ? 'true' : 'false';
    semuaKartu(id).forEach((k) => {
      const hati = k.querySelector('[data-f="hati"]');
      if (hati) hati.setAttribute('aria-pressed', nilai);
    });
    const sekarang = ambilStatus().lagu;
    if (sekarang && sekarang.id === id) $('btn-np-hati').setAttribute('aria-pressed', nilai);

    // Di tampilan Favorit, lagu yang dilepas langsung hilang dari daftar.
    if (!aktif && s.mode === 'favorit') {
      s.tampil = s.tampil.filter((l) => l.id !== id);
      $('daftar-lagu').querySelectorAll(`.amx-kartu[data-id="${CSS.escape(id)}"]`).forEach((k) => k.remove());
      if (!s.tampil.length && s.habis) setStatus(pesanKosong());
    }
  });
}

// ---------------------------------------------------------------------
// 6) INISIALISASI (panggil sekali dari app.js, setelah mulaiPemutar())
// ---------------------------------------------------------------------
let sudahMulai = false;

export function mulaiUI() {
  if (sudahMulai) return;
  sudahMulai = true;

  $('badge-preview').classList.toggle('hidden', !MODE_PREVIEW);
  buatChip();
  pasangBeranda();
  pasangPemutar();
  pasangFavorit();
  pantau(tanganiPemutar);

  // Nilai awal volume/acak (pemutar sudah memancarkannya sebelum UI memantau).
  const awal = ambilStatus();
  tanganiPemutar('volume', awal.volume);
  tanganiPemutar('acak', awal.acak);
  tanganiPemutar('status', 'jeda');

  // Pulihkan lagu terakhir: mini player berisi lagu itu dalam keadaan jeda.
  const terakhir = ambilTerakhir();
  if (terakhir && pulihkanTerakhir()) {
    $('lanjut-judul').textContent = `${terakhir.lagu.title || 'Tanpa judul'} \u00b7 ${terakhir.lagu.artist || ''}`;
    $('banner-lanjut').classList.remove('hidden');
  }

  // Tombol Back/maju browser dan tombol Esc
  window.addEventListener('popstate', sinkronLayar);
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('amx-modal')) tutupModal(e.target.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.querySelector('.amx-modal:not(.hidden)');
    if (modal) tutupModal(modal.id);
    else if (location.hash) tutupLayar();
  });

  muatUlang();
  sinkronLayar();
}
