// js/timer.js — Timer tidur (musik berhenti otomatis setelah 15/25/30/45 menit)
// Tombol Timer menempati slot "Repeat" di layar Now Playing.
// Dipasang dari app.js lewat mulaiTimer().

import { jeda } from './player.js';
import { tampilToast, bukaModal, tutupModal } from './ui.js';

const PILIHAN_MENIT = [15, 25, 30, 45];

let akhirMs = 0;      // kapan timer habis (epoch ms). 0 = timer tidak aktif
let menitAktif = 0;   // durasi yang sedang berjalan (untuk menandai tombol)
let interval = null;  // pembaruan tampilan tiap 1 detik
let timeout = null;   // pemicu tepat waktu (cadangan selain interval)

const el = (id) => document.getElementById(id);

// ---------- Modal (pembungkus aman) ----------
// Perlu verifikasi: bentuk argumen bukaModal/tutupModal di ui.js.
// Pembungkus ini mencoba id lebih dulu, lalu elemen, lalu cadangan class "hidden".
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

// ---------- Format & tampilan ----------
function formatSisa(ms) {
  const detik = Math.max(0, Math.ceil(ms / 1000));
  const menit = Math.floor(detik / 60);
  const sisa = detik % 60;
  return menit + ':' + String(sisa).padStart(2, '0');
}

function perbaruiTampilan() {
  const aktif = akhirMs > 0;
  const sisa = akhirMs - Date.now();

  const lencana = el('np-timer-sisa');
  if (lencana) {
    lencana.textContent = aktif ? formatSisa(sisa) : '';
    lencana.classList.toggle('hidden', !aktif);
  }

  const tombol = el('btn-np-timer');
  if (tombol) tombol.setAttribute('aria-pressed', aktif ? 'true' : 'false');

  const info = el('timer-info');
  if (info) {
    info.textContent = aktif
      ? 'Musik berhenti dalam ' + formatSisa(sisa) + '.'
      : 'Pilih durasi, musik akan berhenti otomatis.';
  }

  const batal = el('btn-timer-batal');
  if (batal) batal.classList.toggle('hidden', !aktif);

  document.querySelectorAll('#modal-timer [data-menit]').forEach((b) => {
    const cocok = aktif && Number(b.dataset.menit) === menitAktif;
    b.setAttribute('aria-pressed', cocok ? 'true' : 'false');
  });
}

// ---------- Logika timer ----------
function hentikanTimer() {
  if (interval) clearInterval(interval);
  if (timeout) clearTimeout(timeout);
  interval = null;
  timeout = null;
  akhirMs = 0;
  menitAktif = 0;
}

function habis() {
  hentikanTimer();
  try { jeda(); } catch (e) { console.error('[timer] gagal menjeda', e); }
  perbaruiTampilan();
  tampilToast('Timer habis, musik dijeda. Selamat istirahat!');
}

function detak() {
  if (akhirMs > 0 && Date.now() >= akhirMs) {
    habis();
    return;
  }
  perbaruiTampilan();
}

function mulaiHitung(menit) {
  if (!PILIHAN_MENIT.includes(menit)) return;
  hentikanTimer();
  menitAktif = menit;
  akhirMs = Date.now() + menit * 60 * 1000;
  interval = setInterval(detak, 1000);
  timeout = setTimeout(habis, menit * 60 * 1000);
  perbaruiTampilan();
  tutupModalAman('modal-timer');
  tampilToast('Timer ' + menit + ' menit dimulai');
}

function batalkan() {
  if (akhirMs === 0) return;
  hentikanTimer();
  perbaruiTampilan();
  tampilToast('Timer dibatalkan');
}

// ---------- Pasang ke halaman ----------
export function mulaiTimer() {
  const tombol = el('btn-np-timer');
  if (tombol) {
    tombol.addEventListener('click', () => {
      perbaruiTampilan();
      bukaModalAman('modal-timer');
    });
  }

  document.querySelectorAll('#modal-timer [data-menit]').forEach((b) => {
    b.addEventListener('click', () => mulaiHitung(Number(b.dataset.menit)));
  });

  const btnBatal = el('btn-timer-batal');
  if (btnBatal) btnBatal.addEventListener('click', batalkan);

  const btnTutup = el('btn-timer-tutup');
  if (btnTutup) btnTutup.addEventListener('click', () => tutupModalAman('modal-timer'));

  // Saat tab kembali aktif, cek ulang (timer browser bisa tertunda di latar belakang)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) detak();
  });

  perbaruiTampilan();
}
