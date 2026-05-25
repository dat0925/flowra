// ─────────────────────────────────────
//  utils.js  共通ユーティリティ
// ─────────────────────────────────────
import { Sound } from './sound.js';

export function fmt(amount) {
  return Number(amount).toLocaleString('ja-JP');
}

export function showToast(msg, duration = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

export function openModal(contentHTML) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = contentHTML;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();  // モーダルを開く音
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.hidden = true;
  document.body.style.overflow = '';
  Sound.playClose(); // モーダルを閉じる音
}
