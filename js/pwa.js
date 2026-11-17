// js/pwa.js — Pendaftaran service worker + tombol "Pasang aplikasi" (PWA Android/Chrome)
// Dipasang dari app.js lewat mulaiPWA().
// Catatan: sw.js (File 15) harus ada di root repo, sejajar index.html.

import { tampilToast } from './ui.js';

let promptPasang = null; // event beforeinstallprompt yang ditahan

const el = (id) => document.getElementById(id);

function sudahTerpasang() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function tampilkanTombol(tampil) {
  const tombol = el('btn-pasang');
  if (tombol) tombol.classList.toggle('hidden', !tampil);
}

// ---------- Service worker ----------
function daftarkanServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const daftar = async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const baru = reg.installing;
        if (!baru) return;
        baru.addEventListener('statechange', () => {
          // Ada versi baru siap, dan sebelumnya sudah ada versi lama yang aktif
          if (baru.state === 'installed' && navigator.serviceWorker.controller) {
            tampilToast('Versi baru siap. Tutup lalu buka lagi aplikasinya.');
          }
        });
      });
    } catch (e) {
      // Wajar gagal saat sw.js belum ada atau bukan https/localhost
      console.warn('[pwa] service worker tidak terdaftar', e);
    }
  };

  if (document.readyState === 'complete') daftar();
  else window.addEventListener('load', daftar, { once: true });
}

// ---------- Tombol pasang ----------
async function klikPasang() {
  if (!promptPasang) return;
  const p = promptPasang;
  promptPasang = null;
  tampilkanTombol(false);
  try {
    await p.prompt();
    const pilihan = await p.userChoice;
    if (pilihan && pilihan.outcome === 'accepted') tampilToast('Memasang Asix Musix...');
  } catch (e) {
    console.warn('[pwa] pemasangan gagal', e);
    tampilToast('Pemasangan belum berhasil. Coba lewat menu Chrome > Instal aplikasi.');
  }
}

export function mulaiPWA() {
  daftarkanServiceWorker();

  if (sudahTerpasang()) {
    tampilkanTombol(false);
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();       // tahan banner bawaan, pakai tombol sendiri
    promptPasang = e;
    tampilkanTombol(true);
  });

  window.addEventListener('appinstalled', () => {
    promptPasang = null;
    tampilkanTombol(false);
    tampilToast('Asix Musix terpasang');
  });

  const tombol = el('btn-pasang');
  if (tombol) tombol.addEventListener('click', klikPasang);
}
