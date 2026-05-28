// ─────────────────────────────────────
//  router.js  画面遷移・月ナビ
// ─────────────────────────────────────
import { Sound } from './sound.js';

// 現在の月（グローバル状態）
export const MonthState = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth() + 1,

  prev() {
    if (this.month === 1) { this.year--; this.month = 12; }
    else this.month--;
    this._emit();
  },
  next() {
    const now = new Date();
    if (this.year === now.getFullYear() && this.month === now.getMonth() + 1) return;
    if (this.month === 12) { this.year++; this.month = 1; }
    else this.month++;
    this._emit();
  },
  label() {
    return `${this.year}年${this.month}月`;
  },
  _listeners: [],
  onChange(fn) { this._listeners.push(fn); },
  _emit() { this._listeners.forEach(fn => fn(this.year, this.month)); }
};

// ページ名 → タイトルマッピング
const PAGE_TITLES = {
  dashboard: 'ホーム',
  records:   '記録一覧',
  accounts:  '口座管理',
  settings:  '設定',
};

export const Router = {
  currentPage: 'dashboard',
  _pageHandlers: {},

  // 画面ハンドラ登録
  register(page, fn) {
    this._pageHandlers[page] = fn;
  },

  // 画面遷移
  navigate(page) {
    this.currentPage = page;
    Sound.playTap(); // 画面遷移音
    // ページ遷移時にsave-barを確実に非表示
    const saveBar = document.getElementById('save-bar');
    if (saveBar) saveBar.hidden = true;

    // サイドバーのアクティブ状態
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    // ボトムナビのアクティブ状態
    document.querySelectorAll('.b-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    // トップバータイトル
    const titleEl = document.getElementById('topbar-title');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;

    // コンテンツ描画
    const content = document.getElementById('page-content');
    if (content) {
      content.innerHTML = '<div class="spinner"></div>';
      content.scrollTop = 0;
    }
    const handler = this._pageHandlers[page];
    if (handler) handler();
  },

  // 初期化（ナビクリックのバインド）
  init() {
    // サイドバー
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });
    // ボトムナビ
    document.querySelectorAll('.b-tab[data-page]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });

    // 月ナビ（モバイル）
    document.getElementById('btn-month-prev')?.addEventListener('click', () => {
      MonthState.prev();
      this._updateMonthLabels();
    });
    document.getElementById('btn-month-next')?.addEventListener('click', () => {
      MonthState.next();
      this._updateMonthLabels();
    });

    // スワイプで月移動（モバイルヘッダー全体）
    const mobileHeader = document.getElementById('mobile-header');
    if (mobileHeader) {
      let _touchStartX = 0;
      let _touchStartY = 0;
      mobileHeader.addEventListener('touchstart', (e) => {
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
      }, { passive: true });
      mobileHeader.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - _touchStartX;
        const dy = e.changedTouches[0].clientY - _touchStartY;
        // 横方向が主体（縦ズレが横移動より小さい）かつ40px以上スワイプ
        if (Math.abs(dx) > 40 && Math.abs(dy) < Math.abs(dx) * 0.6) {
          if (dx < 0) {
            // 左スワイプ → 次の月
            MonthState.next();
          } else {
            // 右スワイプ → 前の月
            MonthState.prev();
          }
          this._updateMonthLabels();
        }
      }, { passive: true });
    }
    // 月ナビ（デスクトップ）
    document.getElementById('btn-month-prev-d')?.addEventListener('click', () => {
      MonthState.prev();
      this._updateMonthLabels();
    });
    document.getElementById('btn-month-next-d')?.addEventListener('click', () => {
      MonthState.next();
      this._updateMonthLabels();
    });

    this._updateMonthLabels();
  },

  _updateMonthLabels() {
    const label = MonthState.label();
    const m = document.getElementById('mobile-month-label');
    const d = document.getElementById('desktop-month-label');
    if (m) {
      m.style.transition = 'opacity 0.15s';
      m.style.opacity = '0';
      setTimeout(() => { m.textContent = label; m.style.opacity = '1'; }, 150);
    }
    if (d) d.textContent = label;
  }
};
