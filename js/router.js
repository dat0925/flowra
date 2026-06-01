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
  goTo(year, month) {
    this.year  = year;
    this.month = month;
    this._emit();
  },
  isCurrentMonth() {
    const now = new Date();
    return this.year === now.getFullYear() && this.month === now.getMonth() + 1;
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

// ── ユーティリティ ────────────────────────────────────
// transitionend + フォールバックタイマーで確実にコールバックを呼ぶ
// ・transitionend が発火しないモバイルブラウザへの対策
// ・done フラグで二重呼び出しを防止
function afterTransition(el, ms, fn) {
  let done = false;
  const run = () => { if (done) return; done = true; fn(); };
  const timer = setTimeout(run, ms + 60);
  el.addEventListener('transitionend', () => { clearTimeout(timer); run(); }, { once: true });
}

// ─────────────────────────────────────────────────────
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
    Sound.playTap();
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

    // 月ラベルタップ → YMピッカー
    ['mobile-month-label', 'desktop-month-label'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        this._showMonthPicker();
      });
    });

    // 今月ボタン
    ['btn-today-month', 'btn-today-month-d'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        const now = new Date();
        this._jumpToMonth(now.getFullYear(), now.getMonth() + 1);
      });
    });
  },

  // ══════════════════════════════════════════════════
  //  カルーセル（スワイプ月切替）
  //
  //  状態機械:
  //    idle  ─touchstart→  dragging
  //    dragging ─閾値超─→  animating（commitSlide）
  //    dragging ─閾値未満→  animating（cancelDrag）
  //    dragging ─cancel─→  idle（goIdle）
  //    animating ─終了─→  idle（goIdle）
  //
  //  【設計の鉄則】
  //  ・idle へ戻るとき必ず content の全インラインスタイルをクリアする
  //    → iOS Safari で transform 残留がコンポジットレイヤーの
  //       hit-test 範囲を overflow:hidden 外まで広げるバグを防ぐ
  //  ・アニメーション完了は setTimeout ではなく afterTransition() で待つ
  //    → transitionend が発火しないケースでもフォールバックで確実に処理
  //  ・ゴーストパネルは CSS にホーム位置を持たないため、
  //    常にインラインで translateX(±w) を明示する
  // ══════════════════════════════════════════════════
  _initCarousel() {
    const carousel = document.getElementById('content-carousel');
    const content  = document.getElementById('page-content');
    if (!carousel || !content) return;

    const EASE = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';

    // ゴーストパネルを生成（page-content より前に挿入 → DOM順で content が前面）
    ['prev', 'next'].forEach(side => {
      const g = document.createElement('div');
      g.id        = `ghost-${side}`;
      g.className = 'ghost-panel';
      const w = carousel.offsetWidth || 400;
      g.style.cssText = `opacity:0;transform:translateX(${side === 'prev' ? -w : w}px);transition:none`;
      carousel.insertBefore(g, content);
    });

    // ── ゴーストへの参照 ──────────────────
    const gp = () => document.getElementById('ghost-prev');
    const gn = () => document.getElementById('ghost-next');

    // ── ゴーストをホームポジションへ ──────
    // ゴーストは CSS にデフォルト位置がないため常にインラインで指定する
    const resetGhosts = () => {
      const w = carousel.offsetWidth;
      const p = gp(), n = gn();
      if (p) p.style.cssText = `opacity:0;transform:translateX(-${w}px);transition:none`;
      if (n) n.style.cssText = `opacity:0;transform:translateX(${w}px);transition:none`;
    };

    // ── 状態オブジェクト ──────────────────
    // phase: 'idle' | 'dragging' | 'animating'
    const sw = { phase: 'idle', startX: 0, startY: 0, curX: 0, axis: null };

    // ── idle へ戻る（必ずここを通る） ───────
    const goIdle = () => {
      sw.phase = 'idle';
      sw.curX  = 0;
      sw.axis  = null;
      // インラインスタイルを完全クリア → コンポジットレイヤーを確実に解放
      content.style.cssText = '';
      // 強制リフロー: iOS Safari がレイヤーのヒットテスト範囲を
      // 即座に再計算するよう促す
      void content.offsetWidth;
      resetGhosts();
      const label = document.getElementById('mobile-month-label');
      if (label) {
        delete label.dataset.dragging;
        label.textContent = MonthState.label();
      }
    };

    // ── ドラッグ中リアルタイム追従 ────────
    const trackDrag = (tx, rawDx, w) => {
      content.style.cssText = `transition:none;transform:translateX(${tx}px)`;
      const label = document.getElementById('mobile-month-label');

      if (rawDx < 0) {
        // 左スワイプ → next ghost が右隣から追従
        const n = gn();
        if (n) n.style.cssText = `opacity:0.78;transform:translateX(${tx + w}px);transition:none`;
        const p = gp(); if (p) p.style.opacity = '0';
        if (label && !label.dataset.dragging) {
          label.dataset.dragging = '1';
          const { month } = MonthState;
          label.textContent = `${month}月 → ${month === 12 ? 1 : month + 1}月`;
        }
      } else if (rawDx > 0) {
        // 右スワイプ → prev ghost が左隣から追従
        const p = gp();
        if (p) p.style.cssText = `opacity:0.78;transform:translateX(${tx - w}px);transition:none`;
        const n = gn(); if (n) n.style.opacity = '0';
        if (label && !label.dataset.dragging) {
          label.dataset.dragging = '1';
          const { month } = MonthState;
          label.textContent = `${month === 1 ? 12 : month - 1}月 ← ${month}月`;
        }
      }
    };

    // ── キャンセル（閾値未満で指を離した） ──
    const cancelDrag = () => {
      sw.phase = 'animating';
      const w = carousel.offsetWidth;
      // ゴーストをホームへアニメーション
      const p = gp(), n = gn();
      if (p) p.style.cssText = `opacity:0;transform:translateX(-${w}px);transition:${EASE}`;
      if (n) n.style.cssText = `opacity:0;transform:translateX(${w}px);transition:${EASE}`;
      // content を中央へ戻すアニメーション → 完了で goIdle
      content.style.cssText = `transition:${EASE};transform:translateX(0)`;
      afterTransition(content, 280, goIdle);
    };

    // ── コミット（閾値超えで指を離した） ───
    const commitSlide = (dir) => {
      sw.phase = 'animating';
      const w = carousel.offsetWidth;
      const label = document.getElementById('mobile-month-label');
      if (label) delete label.dataset.dragging;

      const activeG = dir === 'next' ? gn() : gp();
      const inactG  = dir === 'next' ? gp() : gn();

      // content を画面外へ退場
      const outX = dir === 'next' ? -w : w;
      content.style.cssText = `transition:${EASE};transform:translateX(${outX}px)`;

      // ghost を中央へ入場
      if (activeG) activeG.style.cssText = `opacity:0.78;transform:translateX(0);transition:${EASE}`;
      if (inactG)  inactG.style.opacity = '0';

      // content の退場アニメーション完了後に月更新 → goIdle
      afterTransition(content, 280, () => {
        // ① インラインスタイルをクリア（iOS Safari 対策）→ content が中央に瞬間復帰
        // ② 月状態を更新して再描画
        // ③ ghost をホームポジションへリセット
        // ①②③ はすべて同期的に実行されるため、ブラウザは1フレームでまとめて描画する
        goIdle();
        if (dir === 'next') MonthState.next(); else MonthState.prev();
        this._updateMonthLabels(dir);
      });
    };

    // ── タッチイベント ────────────────────

    carousel.addEventListener('touchstart', (e) => {
      if (this.currentPage !== 'records') return;
      if (sw.phase !== 'idle') return; // アニメーション中の新規タッチは無視
      sw.startX = e.touches[0].clientX;
      sw.startY = e.touches[0].clientY;
      sw.curX   = 0;
      sw.axis   = null;
      sw.phase  = 'dragging';
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
      if (sw.phase !== 'dragging') return;
      const dx = e.touches[0].clientX - sw.startX;
      const dy = e.touches[0].clientY - sw.startY;

      // 12px 動くまでは軸を確定しない
      if (!sw.axis) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        // 横移動が縦の2倍以上のときのみ横スワイプと確定（タップの微ブレ除外）
        sw.axis = Math.abs(dx) > Math.abs(dy) * 2 ? 'h' : 'v';
      }

      if (sw.axis === 'v') {
        // 縦スクロール：スクロール端での iOS バウンスのみ抑制
        const el = document.getElementById('page-content');
        if (el) {
          const atTop    = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault();
        }
        return;
      }

      // 横スワイプ確定
      e.preventDefault();
      sw.curX = dx;

      // ゴム感（端に近づくほど動きが鈍くなる）
      const w = carousel.offsetWidth;
      let tx = sw.curX;
      if (Math.abs(tx) > w * 0.5) {
        tx = Math.sign(tx) * (w * 0.5 + (Math.abs(tx) - w * 0.5) * 0.2);
      }
      trackDrag(tx, dx, w);
    }, { passive: false });

    carousel.addEventListener('touchend', () => {
      if (sw.phase !== 'dragging') return;

      if (sw.axis !== 'h') {
        // 縦スクロール or 軸未確定 → 即 idle へ（ghost も確実にリセット）
        goIdle();
        return;
      }

      const threshold = carousel.offsetWidth * 0.28;
      if      (sw.curX < -threshold) commitSlide('next');
      else if (sw.curX >  threshold) commitSlide('prev');
      else                            cancelDrag();
    }, { passive: true });

    // システム割り込み（通知バナー等）でタッチが中断された場合
    carousel.addEventListener('touchcancel', () => {
      if (sw.phase === 'dragging') goIdle();
    }, { passive: true });
  },

  // ── ボタンによる月切替（< > ボタン） ────────────────────
  // スワイプと同様の状態管理で実装
  _slideMonth(dir) {
    const content = document.getElementById('page-content');
    const carousel = document.getElementById('content-carousel');

    // records 画面以外はアニメーションなしで即切替
    if (!content || !carousel || this.currentPage !== 'records') {
      if (dir === 'next') MonthState.next(); else MonthState.prev();
      this._updateMonthLabels(dir);
      return;
    }

    const EASE = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
    const w    = carousel.offsetWidth;
    const outX = dir === 'next' ? -w :  w;
    const inX  = dir === 'next' ?  w : -w;

    // 退場アニメーション
    content.style.cssText = `transition:${EASE};transform:translateX(${outX}px)`;

    afterTransition(content, 280, () => {
      // 月状態を更新して再描画
      if (dir === 'next') MonthState.next(); else MonthState.prev();
      this._updateMonthLabels(dir);

      // 反対側に瞬間移動（transition なし）
      content.style.cssText = `transition:none;transform:translateX(${inX}px)`;
      void content.offsetWidth; // 強制リフロー（transform を確定させてから次の transition を有効化）

      // 入場アニメーション
      content.style.cssText = `transition:${EASE};transform:translateX(0)`;

      // 入場完了後にインラインスタイルをクリア（iOS Safari 対策）
      afterTransition(content, 280, () => {
        content.style.cssText = '';
      });
    });
  },

  _updateMonthLabels(dir = null) {
    const label = MonthState.label();
    const m = document.getElementById('mobile-month-label');
    const d = document.getElementById('desktop-month-label');
    if (m) m.textContent = label;
    if (d) d.textContent = label;

    // 今月ボタンは今月以外のときだけ表示
    const notCurrent = !MonthState.isCurrentMonth();
    ['btn-today-month', 'btn-today-month-d'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = !notCurrent;
      btn.style.opacity    = notCurrent ? '1'   : '0.35';
      btn.style.cursor     = notCurrent ? 'pointer' : 'default';
      btn.style.pointerEvents = notCurrent ? 'auto' : 'none';
    });

    // body クラスでページ種別を公開（CSS から参照）
    this._syncPageClass();

    // records 画面のときは月が変わったらコンテンツを再描画
    if (this.currentPage === 'records' && dir) {
      const handler = this._pageHandlers['records'];
      if (handler) handler();
    }

    // ghost パネルに隣月データをロード（records 画面のみ）
    if (this.currentPage === 'records') {
      this._loadGhostPanels();
    }
  },

  // 指定年月にジャンプ（スライドなしで即遷移）
  _jumpToMonth(year, month) {
    MonthState.goTo(year, month);
    this._updateMonthLabels();
    // dashboard or records を再描画
    if (this.currentPage === 'dashboard' || this.currentPage === 'records') {
      const handler = this._pageHandlers[this.currentPage];
      if (handler) handler();
    }
  },

  // 年月ピッカーモーダルを表示
  _showMonthPicker() {
    Sound.playOpen();
    const overlay = document.createElement('div');
    overlay.id = 'month-picker-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:700;
      background:rgba(0,0,0,0.45);
      display:flex;align-items:flex-end;justify-content:center;
    `;

    const now    = new Date();
    const curY   = MonthState.year;
    const curM   = MonthState.month;
    const minYear = 2010;
    const maxYear = now.getFullYear() + 1;

    // 年リスト（新しい順）
    const years = [];
    for (let y = maxYear; y >= minYear; y--) years.push(y);

    overlay.innerHTML = `
      <div id="month-picker-sheet" style="
        background:var(--stone);border-radius:20px 20px 0 0;
        width:100%;max-width:480px;padding:0 0 env(safe-area-inset-bottom,16px);
        max-height:80vh;display:flex;flex-direction:column;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:16px 20px 12px;border-bottom:1px solid var(--border);">
          <span style="font-size:15px;font-weight:600;">年月を選択</span>
          <button id="mp-close" style="background:none;border:none;font-size:22px;color:var(--mid);cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="overflow-y:auto;padding:12px 16px 8px;flex:1;">
          ${years.map(y => `
            <div class="mp-year-block" style="margin-bottom:12px;">
              <div style="font-size:12px;color:var(--mid);font-weight:600;margin-bottom:6px;padding-left:4px;">${y}年</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
                ${[1,2,3,4,5,6,7,8,9,10,11,12].map(mo => {
                  const isCur  = y === curY && mo === curM;
                  const isNow  = y === now.getFullYear() && mo === now.getMonth() + 1;
                  const future = y > now.getFullYear() || (y === now.getFullYear() && mo > now.getMonth() + 1);
                  return `<button data-y="${y}" data-m="${mo}"
                    style="padding:8px 4px;border-radius:10px;border:none;cursor:pointer;font-size:13px;
                      background:${isCur ? 'var(--sage)' : 'var(--mist)'};
                      color:${isCur ? '#fff' : future ? 'var(--mid-lt)' : 'var(--ink)'};
                      font-weight:${isCur || isNow ? '700' : '400'};
                      outline:${isNow && !isCur ? '2px solid var(--sage)' : 'none'};
                    ">${mo}月</button>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('button[data-y]');
      if (btn) {
        Sound.playTap();
        this._jumpToMonth(+btn.dataset.y, +btn.dataset.m);
        overlay.remove();
        return;
      }
      if (e.target === overlay || e.target.id === 'mp-close') {
        Sound.playClose();
        overlay.remove();
      }
    });
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

    const gpEl = document.getElementById('ghost-prev');
    const gnEl = document.getElementById('ghost-next');
    if (gpEl) { gpEl.innerHTML = buildGhostHTML(prevTxs, prevY, prevM); gpEl.style.opacity = '0'; }
    if (gnEl) { gnEl.innerHTML = buildGhostHTML(nextTxs, nextY, nextM); gnEl.style.opacity = '0'; }
  },
};
