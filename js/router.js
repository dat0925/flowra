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
      this._slideMonth('prev');
    });
    document.getElementById('btn-month-next')?.addEventListener('click', () => {
      this._slideMonth('next');
    });

    // 月ナビ（デスクトップ）
    document.getElementById('btn-month-prev-d')?.addEventListener('click', () => {
      this._slideMonth('prev');
    });
    document.getElementById('btn-month-next-d')?.addEventListener('click', () => {
      this._slideMonth('next');
    });

    this._updateMonthLabels();
    this._initCarousel();
  },

  _initCarousel() {
    const carousel = document.getElementById('content-carousel');
    const content  = document.getElementById('page-content');
    if (!carousel || !content) return;

    // ghost パネルを追加（前月・次月のぞき見用）
    ['prev','next'].forEach(side => {
      const g = document.createElement('div');
      g.id = `ghost-${side}`;
      g.className = 'ghost-panel';
      g.innerHTML = '<div class="spinner"></div>';
      carousel.appendChild(g);
    });

    let startX = 0, startY = 0;
    let curX   = 0;
    let active = false;
    let axis   = null; // 'h' | 'v' | null

    const setTransform = (dx, animate) => {
      const ease = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
      content.style.transition          = animate ? ease : 'none';
      ghostPrev().style.transition      = animate ? ease : 'none';
      ghostNext().style.transition      = animate ? ease : 'none';
      content.style.transform           = `translateX(${dx}px)`;
      ghostPrev().style.transform       = `translateX(calc(-100% + ${dx}px))`;
      ghostNext().style.transform       = `translateX(calc(100% + ${dx}px))`;
    };

    const ghostPrev = () => document.getElementById('ghost-prev');
    const ghostNext = () => document.getElementById('ghost-next');

    const reset = (animate) => setTransform(0, animate);

    carousel.addEventListener('touchstart', (e) => {
      // スワイプは記録一覧のみ有効
      if (this.currentPage !== 'records') return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      curX   = 0;
      active = true;
      axis   = null;
      content.style.transition = 'none';
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
      if (!active) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // 軸が決まっていなければ判定（5px 動いたら確定）
      if (!axis) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }

      // 縦スクロールと判定したら一切介入しない
      if (axis === 'v') return;

      // 横スワイプ確定 → 縦スクロールを完全にロック
      e.preventDefault();

      curX = dx;

      // 端の抵抗感（ゴム感）
      const w = carousel.offsetWidth;
      let tx = curX;
      if (Math.abs(tx) > w * 0.5) {
        tx = Math.sign(tx) * (w * 0.5 + (Math.abs(tx) - w * 0.5) * 0.2);
      }

      setTransform(tx, false);
    }, { passive: false }); // preventDefault のために passive: false

    carousel.addEventListener('touchend', (e) => {
      if (!active || axis !== 'h') { active = false; axis = null; return; }
      active = false;
      axis   = null;

      const w = carousel.offsetWidth;
      const threshold = w * 0.28;

      if (curX < -threshold) {
        // → 次月へスライドアウト（左へ）
        content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        ghostNext().style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        content.style.transform     = `translateX(-${w}px)`;
        ghostNext().style.transform = `translateX(0)`;
        setTimeout(() => {
          // 右側から滑り込む準備
          content.style.transition = 'none';
          content.style.transform  = `translateX(${w}px)`;
          ghostPrev().style.transform = 'translateX(-100%)';
          ghostNext().style.transform = 'translateX(100%)';
          MonthState.next();
          this._updateMonthLabels();
          // 2フレーム待ってからスライドイン
          requestAnimationFrame(() => requestAnimationFrame(() => {
            content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
            content.style.transform  = 'translateX(0)';
          }));
        }, 280);
      } else if (curX > threshold) {
        // → 前月へスライドアウト（右へ）
        content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        ghostPrev().style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        content.style.transform     = `translateX(${w}px)`;
        ghostPrev().style.transform = `translateX(0)`;
        setTimeout(() => {
          // 左側から滑り込む準備
          content.style.transition = 'none';
          content.style.transform  = `translateX(-${w}px)`;
          ghostPrev().style.transform = 'translateX(-100%)';
          ghostNext().style.transform = 'translateX(100%)';
          MonthState.prev();
          this._updateMonthLabels();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
            content.style.transform  = 'translateX(0)';
          }));
        }, 280);
      } else {
        reset(true);
      }
      curX = 0;
    }, { passive: true });
  },

  _slideMonth(dir) {
    const content = document.getElementById('page-content');
    const carousel = document.getElementById('content-carousel');
    // 記録一覧以外はアニメーションなしで月変更のみ
    if (!content || !carousel || this.currentPage !== 'records') {
      if (dir === 'next') MonthState.next(); else MonthState.prev();
      this._updateMonthLabels();
      return;
    }
    const w = carousel.offsetWidth;
    const outX = dir === 'next' ? -w : w;
    const inX  = dir === 'next' ?  w : -w;
    content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
    content.style.transform  = `translateX(${outX}px)`;
    setTimeout(() => {
      content.style.transition = 'none';
      content.style.transform  = `translateX(${inX}px)`;
      if (dir === 'next') MonthState.next(); else MonthState.prev();
      this._updateMonthLabels();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        content.style.transform  = 'translateX(0)';
      }));
    }, 280);
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
