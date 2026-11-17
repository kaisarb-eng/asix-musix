// js/app.js — Pintu masuk Asix Musix: menyalakan semua modul sesuai urutan
// Urutan wajib: mulaiPemutar() dulu, baru mulaiUI() (mulaiUI sendiri memulihkan lagu terakhir).

import { NAMA_APP, ERROR_INIT, MODE_PREVIEW } from './firebase-config.js';
import { mulaiPemutar } from './player.js';
import { mulaiUI, tampilToast } from './ui.js';
import { mulaiTimer } from './timer.js';
import { mulaiAdmin } from './admin.js';
import { mulaiPWA } from './pwa.js';

// Jalankan satu langkah. Kalau gagal, bagian lain tetap jalan dan pengguna dapat pesan ramah.
async function jalankan(nama, fn) {
  try {
    await fn();
  } catch (e) {
    console.error('[' + nama + '] gagal dimulai', e);
    try { tampilToast('Bagian ' + nama + ' gagal dimulai. Coba muat ulang halaman.'); } catch (e2) { /* abaikan */ }
  }
}

// Jaring pengaman: error tak tertangkap cukup dicatat, toast dibatasi agar tidak spam
let toastErrorTerakhir = 0;
function laporErrorGlobal(alasan) {
  const nama = alasan && alasan.name ? String(alasan.name) : '';
  if (nama === 'AbortError' || nama === 'NotAllowedError') return; // wajar pada audio/popup
  console.error('[app] error tak tertangkap', alasan);
  const sekarang = Date.now();
  if (sekarang - toastErrorTerakhir < 10000) return;
  toastErrorTerakhir = sekarang;
  try { tampilToast('Ada kendala kecil. Coba lagi ya.'); } catch (e) { /* abaikan */ }
}
window.addEventListener('unhandledrejection', (ev) => laporErrorGlobal(ev.reason));
window.addEventListener('error', (ev) => laporErrorGlobal(ev.error));

async function mulai() {
  await jalankan('pemutar', mulaiPemutar);
  await jalankan('tampilan', mulaiUI);
  await jalankan('timer', mulaiTimer);
  await jalankan('admin', mulaiAdmin);
  await jalankan('pemasangan', mulaiPWA);

  if (ERROR_INIT) {
    console.error('[firebase] error inisialisasi', ERROR_INIT);
    tampilToast('Firebase belum bisa dihubungi. Cek firebase-config.js.');
  } else if (MODE_PREVIEW) {
    tampilToast('Mode pratinjau: ' + NAMA_APP + ' memakai data contoh.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
