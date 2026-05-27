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
  Sound.playOpen();

  // 下スワイプで閉じる
  const sheet = document.getElementById('modal-add-record');
  if (sheet && !sheet._swipeInit) {
    sheet._swipeInit = true;
    let startY = 0;
    let startScrollTop = 0;
    sheet.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      startScrollTop = sheet.scrollTop;
    }, { passive: true });
    sheet.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - startY;
      // スクロール位置が一番上 かつ 60px以上下スワイプで閉じる
      if (startScrollTop === 0 && dy > 60) {
        closeModal();
      }
    }, { passive: true });
  }
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const sheet = document.getElementById('modal-add-record');
  if (sheet) sheet._swipeInit = false;
  // save-barを非表示
  const saveBar = document.getElementById('save-bar');
  if (saveBar) saveBar.hidden = true;
  Sound.playClose();
  if (sheet) {
    sheet.classList.add('closing');
    sheet.addEventListener('animationend', () => {
      sheet.classList.remove('closing');
      overlay.hidden = true;
      document.body.style.overflow = '';
    }, { once: true });
  } else {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }
}
