// ─────────────────────────────────────
//  records.js  記録一覧画面
//  キャッシュ優先 + バックグラウンド同期
// ─────────────────────────────────────
import { DB }         from './db.js';
import { MonthState } from './router.js';
import { fmt }        from './utils.js';
import { getCachedTransactions, upsertTransactions, putAccounts } from './cache.js';
import { openEditRecord } from './edit-record.js';

const TX_ICON = {
  income:   { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
  expense:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
  transfer: { bg: '#FBF5E6', stroke: '#B8973E', path: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
};

function txIconSVG(type) {
  const ic = TX_ICON[type] || TX_ICON.expense;
  return `<div class="tx-icon" style="background:${ic.bg};">
    <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}">${ic.path}</svg>
  </div>`;
}

function formatDate(dateStr, showYear = false) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日','月','火','水','木','金','土'];
  const y = showYear ? `${d.getFullYear()}年` : '';
  return `${y}${d.getMonth()+1}月${d.getDate()}日（${w[d.getDay()]}）`;
}

function tagsHTML(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(t => `<span class="tx-tag tx-tag-muted">${t.name}</span>`).join('');
}

// ── 状態（画面遷移後もリセット）──
let currentFilter  = 'all';
let searchQuery    = '';
let _allTx         = [];   // 当月トランザクション
let _searchResults = [];   // 全期間検索結果（タップ用）
let _searchDebounce = null; // デバウンスタイマー
let _searchGen     = 0;    // 競合防止カウンター（古い非同期結果を破棄）

export async function renderRecords({ focusSearch = false } = {}) {
  const content = document.getElementById('page-content');
  const { year, month } = MonthState;

  currentFilter  = 'all';
  searchQuery    = '';
  _searchResults = [];
  _searchGen++;          // 月切替時に進行中の検索を無効化

  // ── STEP 1: キャッシュから即表示 ──
  const cachedTxs = await getCachedTransactions({ year, month });
  if (cachedTxs.length > 0) {
    _allTx = cachedTxs;
    renderShell(cachedTxs, year, month, focusSearch);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // ── STEP 2: バックグラウンドで最新取得 ──
  try {
    const [summary, result, accounts] = await Promise.all([
      DB.getMonthlySummary(year, month),
      DB.getTransactions({ year, month, pageSize: 500 }),
      DB.getAccounts(),
    ]);

    // キャッシュ更新
    await upsertTransactions(result.data);
    await putAccounts(accounts);

    _allTx = result.data;

    // キャッシュなしで初回の場合 or データ更新があった場合に再描画
    // ※ 件数だけでなくIDセットも比較して確実に差分検知
    const cachedIds = new Set(cachedTxs.map(t => t.id));
    const freshIds  = result.data.map(t => t.id);
    const needsUpdate = cachedTxs.length === 0
      || result.data.length !== cachedTxs.length
      || freshIds.some(id => !cachedIds.has(id));
    if (needsUpdate) {
      renderShell(result.data, year, month, focusSearch);
    } else {
      // 差分なし: サマリーバーだけ静かに更新
      updateSummaryBar(summary);
    }

  } catch (e) {
    if (cachedTxs.length === 0) {
      content.innerHTML = `<div class="empty-state">
        <div class="empty-state-title">読み込みエラー</div>
        <div class="empty-state-sub">${e.message}</div>
      </div>`;
    }
    // キャッシュがあれば古いデータのまま表示継続（エラー無視）
  }
}

function renderShell(transactions, year, month, focusSearch = false) {
  const content = document.getElementById('page-content');
  const income  = transactions.filter(t=>t.type==='income' ).reduce((s,t)=>s+t.amount,0);
  const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const balance = income - expense;

  // stickyが正しく機能するようpadding-topを0に（stickyヘッダー自身がpadding-topを持つ）
  content.style.paddingTop = '0';

  content.innerHTML = `
    <div id="records-sticky">
      <div class="records-summary-bar" id="records-summary">
        <div class="rsb-item">
          <div class="rsb-label">収入</div>
          <div class="rsb-amount income">¥${fmt(income)}</div>
        </div>
        <div class="rsb-divider"></div>
        <div class="rsb-item">
          <div class="rsb-label">支出</div>
          <div class="rsb-amount expense">¥${fmt(expense)}</div>
        </div>
        <div class="rsb-divider"></div>
        <div class="rsb-item">
          <div class="rsb-label">収支</div>
          <div class="rsb-amount ${balance>=0?'income':'expense'}">${balance>=0?'+':'−'}¥${fmt(Math.abs(balance))}</div>
        </div>
      </div>
      <div class="records-filter-bar" id="records-filter-bar" style="flex-direction:column;gap:0;padding:0;">
        <!-- 1行目：フィルタータブ -->
        <div class="filter-tabs" id="filter-tabs" style="padding:4px 12px;border-bottom:none;">
          <button class="filter-tab active" data-filter="all">すべて</button>
          <button class="filter-tab" data-filter="expense">支出</button>
          <button class="filter-tab" data-filter="income">収入</button>
          <button class="filter-tab" data-filter="transfer">振替</button>
        </div>
        <!-- 2行目：検索窓＋集計ボタン -->
        <div id="records-search-row" style="display:flex;align-items:center;gap:8px;padding:4px 12px 6px;">
          <div class="search-wrap" style="flex:1;min-width:0;">
            <svg viewBox="0 0 24 24" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="search-input" placeholder="メモ・口座・タグで検索" id="records-search">
            <button id="btn-search-clear" hidden
              style="background:none;border:none;padding:0 4px;cursor:pointer;color:var(--mid);
                display:flex;align-items:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div id="search-count-badge" hidden
            style="font-size:12px;font-weight:600;color:var(--sage);background:var(--sage-bg);
              border-radius:8px;padding:3px 8px;white-space:nowrap;flex-shrink:0;">
          </div>
          <button id="btn-summary-sheet"
            style="flex-shrink:0;padding:6px 12px;border-radius:10px;border:1.5px solid var(--sage);
              background:var(--sage-bg);color:var(--sage-dk);font-size:11px;font-weight:700;
              cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/>
            </svg>
            集計
          </button>
          </button>
        </div>
      </div>
    </div>

    <div id="records-list"></div>`;

  renderList();

  // スクロールで影を付ける
  const pageContent = document.getElementById('page-content');
  const stickyEl    = document.getElementById('records-sticky');
  if (pageContent && stickyEl) {
    // 月切り替え時にscrolledクラスを強制リセット
    stickyEl.classList.remove('scrolled');
    // 既存リスナーを外すためにページ固有のキーで管理
    if (pageContent._recordsScrollHandler) {
      pageContent.removeEventListener('scroll', pageContent._recordsScrollHandler);
    }
    const onScroll = () => {
      stickyEl.classList.toggle('scrolled', pageContent.scrollTop > 4);
    };
    pageContent._recordsScrollHandler = onScroll;
    pageContent.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── イベントデリゲーション（1回だけ登録・_allTxを都度参照） ──
  // 個別登録はrenderListのたびに重複するためここで一元管理
  const listElDelegate = document.getElementById('records-list');
  listElDelegate?.addEventListener('click', e => {
    const item = e.target.closest('.tx-item[data-tx-id]');
    if (!item) return;
    // 検索中は_searchResults、当月表示は_allTxから探す
    const pool = searchQuery.trim() ? _searchResults : _allTx;
    const tx = pool.find(t => t.id === item.dataset.txId);
    if (tx) openEditRecord(tx, () => {
      import('./router.js').then(({ MonthState: ms }) => {
        DB.getTransactions({ year: ms.year, month: ms.month, pageSize: 500 })
          .then(r => { _allTx = r.data; renderList(); })
          .catch(() => {});
      });
    });
  });

  document.getElementById('filter-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    requestAnimationFrame(() => renderList());
  });

  const searchInput = document.getElementById('records-search');
  const clearBtn    = document.getElementById('btn-search-clear');

  // 集計シートを開く
  // 480px以上で1行レイアウトに切り替え
  const applyFilterLayout = () => {
    const bar = document.getElementById('records-filter-bar');
    const tabs = document.getElementById('filter-tabs');
    const row = document.getElementById('records-search-row');
    if (!bar || !tabs || !row) return;
    if (window.innerWidth >= 480) {
      bar.style.flexDirection = 'row';
      bar.style.alignItems = 'center';
      bar.style.gap = '8px';
      bar.style.padding = '4px 12px 6px';
      tabs.style.padding = '0';
      row.style.padding = '0';
      row.style.flex = '1';
    } else {
      bar.style.flexDirection = 'column';
      bar.style.alignItems = '';
      bar.style.gap = '0';
      bar.style.padding = '0';
      tabs.style.padding = '4px 12px';
      row.style.padding = '4px 12px 6px';
      row.style.flex = '';
    }
  };
  applyFilterLayout();
  window.addEventListener('resize', applyFilterLayout);

  document.getElementById('btn-summary-sheet')?.addEventListener('click', () => {
    import('./summary-sheet.js').then(({ openSummarySheet }) => openSummarySheet());
  });

  // focusSearchフラグ：描画直後にキーボードを出す
  if (focusSearch && searchInput) {
    searchInput.focus();
  }

  searchInput?.addEventListener('input', e => {
    searchQuery = e.target.value;
    if (clearBtn) clearBtn.hidden = !searchQuery;
    // 件数バッジは検索中は非表示
    const badge = document.getElementById('search-count-badge');
    if (badge) badge.hidden = true;
    clearTimeout(_searchDebounce);
    if (searchQuery.trim()) {
      _searchDebounce = setTimeout(() => renderList(), 300);
    } else {
      renderList();
    }
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    _searchResults = [];
    clearBtn.hidden = true;
    const badge = document.getElementById('search-count-badge');
    if (badge) badge.hidden = true;
    renderList();
  });
}

function updateSummaryBar(summary) {
  const income  = document.querySelector('#records-summary .rsb-amount.income');
  const expense = document.querySelector('#records-summary .rsb-amount.expense');
  if (income)  income.textContent  = `¥${fmt(summary.income)}`;
  if (expense) expense.textContent = `¥${fmt(summary.expense)}`;
}

// リスト部分だけ更新（フィルター・検索変更時）
// 検索語がある場合は全期間モード（Supabase直接検索）
async function renderList() {
  const listEl = document.getElementById('records-list');
  if (!listEl) return;

  const q          = searchQuery.trim().toLowerCase();
  const isGlobal   = q.length > 0;
  const myGen      = ++_searchGen;

  // ── データ取得 ──────────────────────────
  let filtered;

  if (isGlobal) {
    // 全期間: Supabase直接検索（IndexedDBは使わない）
    listEl.innerHTML = '<div class="spinner"></div>';
    try {
      const results = await DB.searchTransactions(q, currentFilter);
      if (myGen !== _searchGen) return;
      _searchResults = results;
      filtered = results;
    } catch (e) {
      if (myGen !== _searchGen) return;
      listEl.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="empty-state-title">検索に失敗しました</div>
        <div class="empty-state-sub">${e.message}</div>
      </div>`;
      return;
    }
  } else {
    // 当月: 従来通りキャッシュから
    filtered = _allTx.filter(tx => {
      return currentFilter === 'all' || tx.type === currentFilter;
    });
  }

  // ── サマリーバー更新 ────────────────────
  if (isGlobal) {
    const income  = filtered.filter(t=>t.type==='income' ).reduce((s,t)=>s+t.amount,0);
    const expense = filtered.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const summaryEl = document.getElementById('records-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="rsb-item">
          <div class="rsb-label">収入計</div>
          <div class="rsb-amount income">¥${fmt(income)}</div>
        </div>
        <div class="rsb-divider"></div>
        <div class="rsb-item">
          <div class="rsb-label">支出計</div>
          <div class="rsb-amount expense">¥${fmt(expense)}</div>
        </div>`;
      // 件数バッジを検索ボックス横に表示
      const badge = document.getElementById('search-count-badge');
      if (badge) {
        badge.textContent = `${filtered.length.toLocaleString()}件`;
        badge.hidden = false;
      }
    }
  }

  // ── 空状態 ──────────────────────────────
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div class="empty-state-title">${isGlobal ? '見つかりませんでした' : '記録がありません'}</div>
      <div class="empty-state-sub">${isGlobal ? 'メモ・口座・タグ名で検索できます' : '＋ボタンから記録を追加してください'}</div>
    </div>`;
    return;
  }

  // ── 日付グループ化 ──────────────────────
  const grouped = {};
  filtered.forEach(tx => {
    if (!grouped[tx.date]) grouped[tx.date] = [];
    grouped[tx.date].push(tx);
  });

  listEl.innerHTML = `
    <div class="panel">
      ${Object.entries(grouped).map(([date, txs]) => `
        <div class="tx-date-label">
          <span>${formatDate(date, isGlobal)}</span>
          ${(() => {
            const dayExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
            return dayExpense > 0
              ? '<span style="font-size:11px;color:var(--mid-lt);font-weight:400;">支出 ¥' + dayExpense.toLocaleString('ja-JP') + '</span>'
              : '';
          })()}
        </div>
        ${txs.map(tx => {
          const sign = tx.type==='income' ? '+¥' : tx.type==='expense' ? '−¥' : '¥';
          const acctName = tx.type==='transfer'
            ? `${tx.account?.name||''} → ${tx.to_account?.name||''}`
            : tx.account?.name || '';
          const validTags = (tx.tags || []).filter(t => t);
          return `
            <div class="tx-item" data-tx-id="${tx.id}" style="cursor:pointer;">
              ${txIconSVG(tx.type)}
              <div class="tx-body">
                <div class="tx-name">${tx.memo || '（メモなし）'}</div>
                <div class="tx-meta">
                  ${validTags.length > 0
                    ? `<span class="tx-tag tx-tag-primary">${validTags[0].name}</span><span class="tx-acct" style="color:var(--mid-lt);">${acctName}</span>`
                    : `<span class="tx-acct">${acctName}</span>`
                  }
                  ${tx.is_unsettled ? '<span class="unsettled-dot"></span><span style="font-size:11px;color:var(--gold);font-weight:500;">未精算</span>' : ''}
                </div>
              </div>
              <div class="tx-right">
                <div class="tx-amount ${tx.type}">
                  <span class="tx-currency">${sign}</span>${fmt(tx.amount)}
                </div>
              </div>
            </div>`;
        }).join('')}
      `).join('')}
    </div>`;

  // クリックはrenderShellのイベントデリゲーションで処理
}

// 保存後に_allTxに追加してリストを差し込む（再描画なし）
export function patchAddRecord(tx) {
  _allTx = [tx, ..._allTx];

  const listEl = document.getElementById('records-list');
  if (!listEl) return;

  // パネルがなければ再描画
  const panel = listEl.querySelector('.panel');
  if (!panel) {
    renderRecords();
    return;
  }

  const today = new Date(tx.date + 'T00:00:00');
  const w = ['日','月','火','水','木','金','土'];
  const dateLabel = `${today.getMonth()+1}月${today.getDate()}日（${w[today.getDay()]}）`;
  const sign = tx.type==='income' ? '+¥' : tx.type==='expense' ? '−¥' : '¥';
  const TX_ICON = {
    income:   { bg:'#EEF5F1', stroke:'#4A7C59', path:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
    expense:  { bg:'#F0EDE8', stroke:'#7A9485', path:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
    transfer: { bg:'#FBF5E6', stroke:'#B8973E', path:'<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
  };
  const ic = TX_ICON[tx.type] || TX_ICON.expense;
  const acctName = tx.type === 'transfer'
    ? `${tx.account?.name || tx._acctName || ''} → ${tx.to_account?.name || ''}`
    : tx.account?.name || tx._acctName || '';

  // タグ表示（renderListと同じロジック）
  const validTags = (tx.tags || []).filter(t => t);
  const metaHTML = validTags.length > 0
    ? `<span class="tx-tag tx-tag-primary">${validTags[0].name}</span><span class="tx-acct" style="color:var(--mid-lt);">${acctName}</span>`
    : `<span class="tx-acct">${acctName}</span>`;

  const newRow = document.createElement('div');
  newRow.innerHTML = `
    <div class="tx-date-label">${dateLabel}</div>
    <div class="tx-item" data-tx-id="${tx.id}" style="cursor:pointer;">
      <div class="tx-icon" style="background:${ic.bg};">
        <svg viewBox="0 0 24 24" style="stroke:${ic.stroke};fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;">${ic.path}</svg>
      </div>
      <div class="tx-body">
        <div class="tx-name">${tx.memo || '（メモなし）'}</div>
        <div class="tx-meta">${metaHTML}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${tx.type}">
          <span class="tx-currency">${sign}</span>${Number(tx.amount).toLocaleString('ja-JP')}
        </div>
      </div>
    </div>`;

  panel.prepend(newRow);

  // クリックイベントを付与
  const txItem = newRow.querySelector('.tx-item[data-tx-id]');
  if (txItem) {
    txItem.addEventListener('click', () => {
      import('./edit-record.js').then(({ openEditRecord }) => {
        openEditRecord(tx, () => {
          import('./db.js').then(({ DB }) => {
            const { MonthState } = import('./router.js');
            renderRecords();
          });
        });
      });
    });
  }

  // サマリーバーの差分更新
  if (tx.type === 'income') {
    const el = document.querySelector('.rsb-amount.income');
    if (el) el.textContent = '¥' + ((parseInt(el.textContent.replace(/[¥,]/g,''),10)||0) + tx.amount).toLocaleString('ja-JP');
  }
  if (tx.type === 'expense') {
    const el = document.querySelector('.rsb-amount.expense');
    if (el) el.textContent = '¥' + ((parseInt(el.textContent.replace(/[¥,]/g,''),10)||0) + tx.amount).toLocaleString('ja-JP');
  }
}
