// sw.js — Service worker Asix Musix (cache app shell, BUKAN cache audio)
//
// Letakkan di ROOT repo, sejajar index.html, supaya cakupannya seluruh aplikasi.
// Setiap kali lo deploy perubahan file, naikkan CACHE_VERSI (v1 -> v2) agar cache lama dibuang.
//
// Aturan singkat:
// - File milik sendiri (HTML/CSS/JS/ikon): jaringan dulu, kalau lambat/offline pakai cache.
// - Tailwind, Google Fonts, Firebase SDK (gstatic): cache setelah pernah dimuat sekali.
// - Audio, Firestore, Jamendo, Google login: TIDAK disentuh sama sekali (langsung ke jaringan).

const CACHE_VERSI = 'v1';
const CACHE = 'amx-shell-' + CACHE_VERSI;
const BATAS_JARINGAN_MS = 4000;

// File inti yang disimpan saat pemasangan. Yang gagal diambil dilewati, tidak membatalkan pemasangan.
const FILE_INTI = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/firebase-config.js',
  './js/local-store.js',
  './js/data.js',
  './js/player.js',
  './js/ui.js',
  './js/timer.js',
  './js/admin.js',
  './js/pwa.js',
  './js/app.js',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// Sumber luar yang boleh di-cache (hanya setelah pernah berhasil dimuat)
function bolehCacheLuar(url) {
  if (url.hostname === 'cdn.tailwindcss.com') return true;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return true;
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return true;
  return false;
}

// ---------- Pemasangan & pembersihan ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(FILE_INTI.map((f) => cache.add(f)))
    )
  );
  // Sengaja TIDAK skipWaiting: versi baru aktif saat aplikasi ditutup lalu dibuka lagi,
  // supaya satu sesi tidak mencampur file lama dan baru.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((daftar) =>
      Promise.all(
        daftar
          .filter((k) => k.startsWith('amx-shell-') && k !== CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- Strategi ----------
function batasWaktu(ms) {
  return new Promise((_, tolak) => setTimeout(() => tolak(new Error('lambat')), ms));
}

function bolehSimpan(res) {
  return res && (res.ok || res.type === 'opaque');
}

// Jaringan dulu; kalau gagal atau lebih dari 4 detik, pakai cache bila ada.
async function jaringanDulu(event, request) {
  const cache = await caches.open(CACHE);
  const jaringan = fetch(request).then((res) => {
    if (bolehSimpan(res)) event.waitUntil(cache.put(request, res.clone()));
    return res;
  });
  jaringan.catch(() => {}); // cegah peringatan jika hasilnya sudah tidak ditunggu

  try {
    return await Promise.race([jaringan, batasWaktu(BATAS_JARINGAN_MS)]);
  } catch (e) {
    const tersimpan = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (tersimpan) return tersimpan;
    if (request.mode === 'navigate') {
      const beranda = (await cache.match('./index.html')) || (await cache.match('./'));
      if (beranda) return beranda;
    }
    return jaringan; // tidak ada cache: tunggu jaringan apa adanya
  }
}

// Cache dulu (untuk sumber luar yang versinya sudah dikunci di URL).
async function cacheDulu(event, request) {
  const cache = await caches.open(CACHE);
  const tersimpan = await cache.match(request);
  if (tersimpan) return tersimpan;
  const res = await fetch(request);
  if (bolehSimpan(res)) event.waitUntil(cache.put(request, res.clone()));
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Hanya GET biasa. Permintaan Range (audio) dan media dibiarkan langsung ke jaringan.
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;
  if (request.destination === 'audio' || request.destination === 'video') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    event.respondWith(jaringanDulu(event, request));
    return;
  }

  if (bolehCacheLuar(url)) {
    event.respondWith(cacheDulu(event, request));
  }
  // Selain itu (Firestore, Jamendo, login Google, dll.) tidak ditangani service worker.
});
