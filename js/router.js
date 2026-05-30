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
    this._syncPageClass();
    const handler = this._pageHandlers[page];
    if (handler) handler();

    // records 画面に入ったときはゴーストも初期ロード
    if (page === 'records') {
      this._loadGhostPanels();
    }
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
      // 初期位置 -68% / +68%、ドラッグに追従
      ghostPrev().style.transform       = `translateX(calc(-68% + ${dx}px))`;
      ghostNext().style.transform       = `translateX(calc(68% + ${dx}px))`;
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
          ghostPrev().style.transform = 'translateX(-68%)';
          ghostNext().style.transform = 'translateX(68%)';
          MonthState.next();
          this._updateMonthLabels('next');
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
          ghostPrev().style.transform = 'translateX(-68%)';
          ghostNext().style.transform = 'translateX(68%)';
          MonthState.prev();
          this._updateMonthLabels('prev');
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
      this._updateMonthLabels(dir);
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
      this._updateMonthLabels(dir);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        content.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        content.style.transform  = 'translateX(0)';
      }));
    }, 280);
  },

  _updateMonthLabels(dir = null) {
    const label = MonthState.label();
    const m = document.getElementById('mobile-month-label');
    const d = document.getElementById('desktop-month-label');
    if (m) {
      if (dir) {
        // スライド方向に応じたアニメーション
        // next（未来月）→ 左からくる（prevから見ると右へ）
        const cls = dir === 'next' ? 'slide-in-left' : 'slide-in-right';
        m.classList.remove('slide-in-left', 'slide-in-right');
        // forceReflow
        void m.offsetWidth;
        m.textContent = label;
        m.classList.add(cls);
        m.addEventListener('animationend', () => m.classList.remove(cls), { once: true });
      } else {
        m.textContent = label;
      }
    }
    if (d) d.textContent = label;

    // body クラスでページ種別を公開（CSS から参照）
    this._syncPageClass();

    // ghostパネルに隣月データをロード（records画面のみ）
    if (this.currentPage === 'records') {
      this._loadGhostPanels();
    }
  },

  _syncPageClass() {
    document.body.className = document.body.className
      .replace(/\bpage-\S+/g, '').trim();
    document.body.classList.add(`page-${this.currentPage}`);
  },

  // ghost パネルに隣月の実データを描画
  async _loadGhostPanels() {
    const { getCachedTransactions } = await import('./cache.js');
    const fmt = n => Number(n).toLocaleString('ja-JP');
    const w   = ['日','月','火','水','木','金','土'];

    const TX_ICON = {
      income:   { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
      expense:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      transfer: { bg: '#FBF5E6', stroke: '#B8973E', path: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
    };

    const buildGhostHTML = (txs, year, month) => {
      const income  = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
      const expense = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
      const label   = `${year}年${month}月`;

      if (txs.length === 0) {
        return `<div style="padding:16px 20px;">
          <div class="ghost-month-header">${label}</div>
          <div style="color:var(--mid);font-size:12px;padding-top:8px;">記録なし</div>
        </div>`;
      }

      // 日付グループ化（最新5日分 or 15件まで）
      const grouped = {};
      txs.slice(0, 15).forEach(tx => {
        if (!grouped[tx.date]) grouped[tx.date] = [];
        grouped[tx.date].push(tx);
      });

      const rows = Object.entries(grouped).map(([date, items]) => {
        const d   = new Date(date + 'T00:00:00');
        const lbl = `${d.getMonth()+1}月${d.getDate()}日（${w[d.getDay()]}）`;
        const itemsHTML = items.map(t => {
          const ic   = TX_ICON[t.type] || TX_ICON.expense;
          const sign = t.type === 'income' ? '+¥' : t.type === 'expense' ? '−¥' : '¥';
          const cls  = t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : '';
          return `<div class="ghost-tx-item">
            <div class="ghost-tx-icon" style="background:${ic.bg};">
              <svg viewBox="0 0 24 24" style="stroke:${ic.stroke};fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;">${ic.path}</svg>
            </div>
            <div class="ghost-tx-body">
              <div class="ghost-tx-name">${t.memo || '（メモなし）'}</div>
              <div class="ghost-tx-meta">${t.account?.name || ''}</div>
            </div>
            <div class="ghost-tx-amount ${cls}">${sign}${fmt(t.amount)}</div>
          </div>`;
        }).join('');
        return `<div class="ghost-date-label">${lbl}</div>${itemsHTML}`;
      }).join('');

      return `<div style="padding:12px 16px 24px;">
        <div class="ghost-month-header">${label}</div>
        <div class="ghost-summary">
          <div class="ghost-summary-item">
            <div class="ghost-summary-label">収入</div>
            <div class="ghost-summary-amount income">¥${fmt(income)}</div>
          </div>
          <div class="ghost-summary-item">
            <div class="ghost-summary-label">支出</div>
            <div class="ghost-summary-amount expense">¥${fmt(expense)}</div>
          </div>
        </div>
        ${rows}
      </div>`;
    };

    // 前月・次月を計算
    const { year, month } = MonthState;
    const prevY = month === 1  ? year - 1 : year;
    const prevM = month === 1  ? 12 : month - 1;
    const nextY = month === 12 ? year + 1 : year;
    const nextM = month === 12 ? 1  : month + 1;

    const [prevTxs, nextTxs] = await Promise.all([
      getCachedTransactions({ year: prevY, month: prevM }),
      getCachedTransactions({ year: nextY, month: nextM }),
    ]);

    const gp = document.getElementById('ghost-prev');
    const gn = document.getElementById('ghost-next');
    if (gp) gp.innerHTML = buildGhostHTML(prevTxs, prevY, prevM);
    if (gn) gn.innerHTML = buildGhostHTML(nextTxs, nextY, nextM);
  },
};
